import { useEffect, useRef, useState } from "react";

import type { AgentStreamEvent } from "./types";

type MessageContext = {
  projectId?: string;
  activeFile?: string;
  experimentId?: string | null;
  mode?: string;
  preprocessingPlanPath?: string | null;
  targetColumn?: string;
  trainingDatasetPath?: string;
};

type ApprovalResponse = {
  approvalId: string;
  decision: "execute" | "revise" | string;
  context: MessageContext;
};

type ResumeStepRequest = {
  stage: string;
  context: MessageContext;
};

function wireContext(context: MessageContext) {
  return {
    project_id: context.projectId,
    active_file: context.activeFile,
    experiment_id: context.experimentId,
    mode: context.mode,
    preprocessing_plan_path: context.preprocessingPlanPath,
    target_column: context.targetColumn,
    training_dataset_path: context.trainingDatasetPath,
  };
}

/**
 * `sessionId` 为 null 表示会话尚未就绪。此时刻意不建立连接：先前的占位会话会让
 * 消息真的发出去并被后端执行，而会话切换又会清空事件流，响应就此丢失且界面无提示。
 * 不连接则表现为"未连接"，composer 会如实拒绝发送并保留输入。
 */
export function useAgentStream(sessionId: string | null) {
  const socketRef = useRef<WebSocket | null>(null);
  const [events, setEvents] = useState<AgentStreamEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    setEvents([]);
    if (!sessionId) {
      socketRef.current = null;
      setConnected(false);
      return;
    }
    const socket = new WebSocket(`ws://127.0.0.1:8000/ws/sessions/${sessionId}`);
    socketRef.current = socket;
    socket.onopen = () => {
      setConnected(true);
      setLastError(null);
    };
    socket.onerror = () => setLastError("WebSocket connection failed. Confirm the backend service is running.");
    socket.onclose = () => setConnected(false);
    socket.onmessage = (message) => {
      try {
        setEvents((current) => [...current, JSON.parse(message.data) as AgentStreamEvent]);
      } catch {
        setLastError("Received an Agent event that could not be parsed.");
      }
    };
    return () => socket.close();
  }, [sessionId]);

  function sendSocketPayload(payload: Record<string, unknown>, errorMessage: string) {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setLastError(errorMessage);
      return;
    }
    socket.send(JSON.stringify(payload));
  }

  function sendMessage(content: string, context: MessageContext) {
    sendSocketPayload(
      {
        type: "user_message",
        content,
        context: wireContext(context),
      },
      "WebSocket is not connected; the message was not sent.",
    );
  }

  function sendApprovalResponse({ approvalId, decision, context }: ApprovalResponse) {
    sendSocketPayload(
      {
        type: "approval_response",
        approval_id: approvalId,
        decision,
        context: wireContext(context),
      },
      "WebSocket is not connected; the approval response was not sent.",
    );
  }

  function sendResumeStep({ stage, context }: ResumeStepRequest) {
    sendSocketPayload(
      {
        type: "resume_step",
        stage,
        context: wireContext(context),
      },
      "WebSocket is not connected; the step was not resumed.",
    );
  }

  return { connected, events, lastError, sendApprovalResponse, sendMessage, sendResumeStep };
}
