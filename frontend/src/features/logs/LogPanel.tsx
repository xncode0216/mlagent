import type { AgentStreamEvent } from "../chat/types";

type LogPanelProps = {
  events: AgentStreamEvent[];
};

function formatEventMessage(event: AgentStreamEvent) {
  switch (event.type) {
    case "message_delta":
      return "Agent 正在流式输出回复";
    case "tool_call_started":
      return `开始调用工具 ${event.tool}`;
    case "tool_call_finished":
      return `工具调用${event.status === "success" ? "完成" : "失败"}${event.result_ref ? `：${event.result_ref}` : ""}`;
    case "kernel_output":
      return event.text;
    case "artifact_created":
      return `生成产物 ${event.artifact.name}`;
    case "task_progress":
      return `${Math.round(event.progress * 100)}% · ${event.label}`;
    case "lesson_extracted":
      return `抽取经验 ${event.lesson_id}，置信度 ${Math.round(event.confidence * 100)}%`;
    case "error":
      return event.message;
  }
}

function eventLevel(event: AgentStreamEvent) {
  if (event.type === "error") return "ERROR";
  if (event.type === "kernel_output" && event.stream === "stderr") return "WARN";
  if (event.type === "tool_call_started" || event.type === "tool_call_finished") return "TOOL";
  return "INFO";
}

export function LogPanel({ events }: LogPanelProps) {
  const displayEvents = events.filter((event) => event.type !== "message_delta");

  return (
    <div className="log-panel">
      <div className="log-toolbar">
        <div className="panel-title">执行日志</div>
        <span>{displayEvents.length} 条事件</span>
      </div>
      <div className="log-list">
        {displayEvents.length === 0 ? (
          <div className="empty-state">等待 Agent 事件。执行分析、训练或经验抽取后，这里会显示工具链路、Kernel 输出和产物事件。</div>
        ) : (
          displayEvents.map((event, index) => (
            <div className="log-row" key={`${event.type}-${index}`}>
              <span className={`log-level ${eventLevel(event).toLowerCase()}`}>{eventLevel(event)}</span>
              <span className="log-message">{formatEventMessage(event)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
