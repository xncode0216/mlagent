import { useEffect, useMemo, useRef, useState } from "react";

import { sessionLogDownloadUrl } from "../../lib/api";
import type { AgentStreamEvent } from "../chat/types";

type LogPanelProps = {
  events: AgentStreamEvent[];
  sessionId?: string;
};

type LogLevel = "ALL" | "INFO" | "TOOL" | "WARN" | "ERROR";

type TraceSummary = {
  traceId: string;
  events: number;
  tools: number;
  artifacts: number;
  errors: number;
  durationMs: number;
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
  if (event.type === "tool_call_finished" && event.status === "error") return "ERROR";
  if (event.type === "tool_call_started" || event.type === "tool_call_finished") return "TOOL";
  return "INFO";
}

function eventDetail(event: AgentStreamEvent) {
  if (event.type === "tool_call_finished" && event.error) return event.error;
  if (event.type === "error") return `${event.code}: ${event.message}`;
  if (event.type === "kernel_output" && event.stream === "stderr") return event.text;
  return "";
}

function formatDuration(event: AgentStreamEvent) {
  if (event.type !== "tool_call_finished" || typeof event.duration_ms !== "number") return "";
  return `${event.duration_ms.toFixed(0)}ms`;
}

function formatTrace(event: AgentStreamEvent) {
  return event.trace_id ? `trace ${event.trace_id.slice(0, 8)}` : "";
}

export function LogPanel({ events, sessionId }: LogPanelProps) {
  const [levelFilter, setLevelFilter] = useState<LogLevel>("ALL");
  const [query, setQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const displayEvents = useMemo(
    () =>
      events
        .filter((event) => event.type !== "message_delta")
        .filter((event) => levelFilter === "ALL" || eventLevel(event) === levelFilter)
        .filter((event) => {
          if (!normalizedQuery) return true;
          const searchable =
            `${event.type} ${event.trace_id ?? ""} ${eventLevel(event)} ${formatEventMessage(event)} ${eventDetail(event)}`.toLowerCase();
          return searchable.includes(normalizedQuery);
        }),
    [events, levelFilter, normalizedQuery],
  );
  const traceSummaries = useMemo(() => {
    const traces = new Map<string, TraceSummary>();
    for (const event of displayEvents) {
      if (!event.trace_id) continue;
      const summary =
        traces.get(event.trace_id) ??
        {
          traceId: event.trace_id,
          events: 0,
          tools: 0,
          artifacts: 0,
          errors: 0,
          durationMs: 0,
        };
      summary.events += 1;
      if (event.type === "tool_call_started") summary.tools += 1;
      if (event.type === "artifact_created") summary.artifacts += 1;
      if (eventLevel(event) === "ERROR") summary.errors += 1;
      if (event.type === "tool_call_finished" && typeof event.duration_ms === "number") {
        summary.durationMs += event.duration_ms;
      }
      traces.set(event.trace_id, summary);
    }
    return [...traces.values()].sort((left, right) => right.events - left.events);
  }, [displayEvents]);

  useEffect(() => {
    if (!autoScroll || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [autoScroll, displayEvents.length]);

  return (
    <div className="log-panel">
      <div className="log-toolbar">
        <div className="panel-title">执行日志</div>
        <div className="log-toolbar-actions">
          <span>{displayEvents.length} 条事件</span>
          {sessionId ? (
            <a className="log-download" download={`${sessionId}.jsonl`} href={sessionLogDownloadUrl(sessionId)}>
              导出 JSONL
            </a>
          ) : null}
        </div>
      </div>
      {traceSummaries.length > 0 ? (
        <div className="trace-summary-list">
          {traceSummaries.slice(0, 4).map((trace) => (
            <div className="trace-summary" key={trace.traceId}>
              <span className="trace-id">trace {trace.traceId.slice(0, 8)}</span>
              <span>{trace.events} 事件</span>
              <span>{trace.tools} 工具</span>
              <span>{trace.artifacts} 产物</span>
              <span className={trace.errors > 0 ? "trace-error" : ""}>{trace.errors} 错误</span>
              <span>{trace.durationMs.toFixed(0)}ms</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="log-controls">
        <input
          aria-label="搜索日志"
          placeholder="搜索日志、工具、错误..."
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select aria-label="日志级别" value={levelFilter} onChange={(event) => setLevelFilter(event.target.value as LogLevel)}>
          <option value="ALL">全部</option>
          <option value="INFO">INFO</option>
          <option value="TOOL">TOOL</option>
          <option value="WARN">WARN</option>
          <option value="ERROR">ERROR</option>
        </select>
        <label className="log-toggle">
          <input checked={autoScroll} type="checkbox" onChange={(event) => setAutoScroll(event.target.checked)} />
          自动滚动
        </label>
      </div>
      <div className="log-list" ref={listRef}>
        {displayEvents.length === 0 ? (
          <div className="empty-state">等待 Agent 事件。执行分析、训练或经验抽取后，这里会显示工具链路、Kernel 输出和产物事件。</div>
        ) : (
          displayEvents.map((event, index) => {
            const detail = eventDetail(event);
            return (
              <div className={`log-row ${detail ? "with-detail" : ""}`} key={`${event.type}-${index}`}>
                <span className={`log-level ${eventLevel(event).toLowerCase()}`}>{eventLevel(event)}</span>
                <span className="log-message">
                  {formatEventMessage(event)}
                  <span className="log-meta">
                    {[formatTrace(event), formatDuration(event)].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {detail ? (
                  <details className="log-detail">
                    <summary>详情</summary>
                    <pre>{detail}</pre>
                  </details>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
