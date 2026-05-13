import type { AgentStreamEvent } from "../chat/types";

type LogPanelProps = {
  events: AgentStreamEvent[];
};

export function LogPanel({ events }: LogPanelProps) {
  return (
    <div className="log-panel">
      <div className="panel-title">执行日志</div>
      <div className="log-list">
        {events.length === 0 ? (
          <div className="empty-state">等待 Agent 事件...</div>
        ) : (
          events.map((event, index) => (
            <div className="log-row" key={`${event.type}-${index}`}>
              <span className="log-level">{event.type}</span>
              <span className="log-message">{JSON.stringify(event)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
