import type { AgentStreamEvent } from "./types";

type AgentWorkspaceProps = {
  activeFile: string;
  connected: boolean;
  events: AgentStreamEvent[];
  lastError: string | null;
  projectId?: string;
  sendMessage: (
    content: string,
    context: { projectId?: string; activeFile?: string },
  ) => void;
};

export function AgentWorkspace({
  activeFile,
  connected,
  events,
  lastError,
  projectId,
  sendMessage,
}: AgentWorkspaceProps) {
  const message = events
    .filter((event) => event.type === "message_delta")
    .map((event) => event.delta)
    .join("");
  const toolEvents = events.filter(
    (event) => event.type === "tool_call_started" || event.type === "tool_call_finished",
  );

  return (
    <main className="agent-workspace">
      <div className="agent-header">
        <div>
          <h2>数据分析 Agent</h2>
          <p>Kernel: Python 3.11 · Tools: EDA 基础工具 · GPU: 未启用</p>
        </div>
        <button
          disabled={!connected || !projectId}
          onClick={() =>
            sendMessage(`分析 ${activeFile} 的缺失值和相关性`, { projectId, activeFile })
          }
        >
          发送示例分析请求
        </button>
      </div>

      {lastError ? <div className="inline-alert">{lastError}</div> : null}

      <div className="message-card user-message">
        <span className="message-label">User</span>
        分析 {activeFile} 的缺失值、字段类型和相关性。
      </div>
      <div className="message-card agent-message">
        <span className="message-label">Agent</span>
        {message || "点击示例分析请求后，这里会流式显示 Agent 回复。"}
      </div>
      <div className="tool-strip">
        {toolEvents.length === 0 ? (
          <span className="tool-chip muted">等待工具调用</span>
        ) : (
          toolEvents.map((event, index) => (
            <span key={`${event.type}-${index}`} className="tool-chip">
              {event.type === "tool_call_started" ? event.tool : event.status}
            </span>
          ))
        )}
      </div>
    </main>
  );
}
