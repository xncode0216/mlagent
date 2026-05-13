import type { AgentStreamEvent } from "./types";

type AgentWorkspaceProps = {
  events: AgentStreamEvent[];
  sendMessage: (content: string, activeFile: string) => void;
};

export function AgentWorkspace({ events, sendMessage }: AgentWorkspaceProps) {
  const message = events
    .filter((event) => event.type === "message_delta")
    .map((event) => event.delta)
    .join("");

  return (
    <main className="agent-workspace">
      <div className="agent-header">
        <div>
          <h2>数据分析 Agent</h2>
          <p>Kernel: Python 3.11 · Tools: 20 · GPU: 未启用</p>
        </div>
        <button onClick={() => sendMessage("分析缺失值", "data/customer_churn.csv")}>
          发送示例分析请求
        </button>
      </div>
      <div className="message-card user-message">分析 customer_churn.csv 的缺失值和相关性。</div>
      <div className="message-card agent-message">
        {message || "启动后点击示例请求，这里会流式显示 Agent 回复。"}
      </div>
      <div className="tool-strip">
        {events
          .filter(
            (event) => event.type === "tool_call_started" || event.type === "tool_call_finished",
          )
          .map((event, index) => (
            <span key={`${event.type}-${index}`} className="tool-chip">
              {event.type === "tool_call_started" ? event.tool : event.status}
            </span>
          ))}
      </div>
    </main>
  );
}
