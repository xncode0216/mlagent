import { useEffect, useRef, useState } from "react";

import type { AgentStreamEvent } from "./types";

type MessageContext = {
  projectId?: string;
  activeFile?: string;
};

export function useAgentStream(sessionId: string) {
  const socketRef = useRef<WebSocket | null>(null);
  const [events, setEvents] = useState<AgentStreamEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    const socket = new WebSocket(`ws://127.0.0.1:8000/ws/sessions/${sessionId}`);
    socketRef.current = socket;
    socket.onopen = () => {
      setConnected(true);
      setLastError(null);
    };
    socket.onerror = () => setLastError("WebSocket 连接失败，请确认后端服务已启动。");
    socket.onclose = () => setConnected(false);
    socket.onmessage = (message) => {
      try {
        setEvents((current) => [...current, JSON.parse(message.data) as AgentStreamEvent]);
      } catch {
        setLastError("收到无法解析的 Agent 事件。");
      }
    };
    return () => socket.close();
  }, [sessionId]);

  function sendMessage(content: string, context: MessageContext) {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setLastError("WebSocket 尚未连接，消息没有发送。");
      return;
    }

    socket.send(
      JSON.stringify({
        type: "user_message",
        content,
        context: {
          project_id: context.projectId,
          active_file: context.activeFile,
        },
      }),
    );
  }

  return { connected, events, lastError, sendMessage };
}
