import { useEffect, useMemo, useRef, useState } from "react";

import { sessionLogDownloadUrl } from "../../lib/api";
import type { AgentStreamEvent } from "../chat/types";
import {
  buildLogRecords,
  buildTaskSummaries,
  buildTraceSummaries,
  filterLogRecords,
  formatTrace,
  type LogLevel,
} from "./logViewModel";

type LogPanelProps = {
  events: AgentStreamEvent[];
  focusedTaskId?: string | null;
  focusedTraceId?: string | null;
  sessionId?: string;
};

export function LogPanel({ events, focusedTaskId, focusedTraceId, sessionId }: LogPanelProps) {
  const [levelFilter, setLevelFilter] = useState<LogLevel>("ALL");
  const [query, setQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [traceFilter, setTraceFilter] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const records = useMemo(() => buildLogRecords(events), [events]);
  const displayEvents = useMemo(
    () =>
      filterLogRecords(records, {
        errorsOnly,
        level: levelFilter,
        query,
        taskId: taskFilter,
        traceId: traceFilter,
      }),
    [errorsOnly, levelFilter, query, records, taskFilter, traceFilter],
  );
  const traceSummaries = useMemo(() => buildTraceSummaries(records), [records]);
  const taskSummaries = useMemo(() => buildTaskSummaries(records), [records]);
  const selectedRecord = displayEvents.find((record) => record.index === selectedIndex) ?? displayEvents[0] ?? null;
  const errorCount = records.filter((record) => record.level === "ERROR").length;
  const hasActiveFilters = Boolean(errorsOnly || levelFilter !== "ALL" || query.trim() || traceFilter || taskFilter);

  useEffect(() => {
    if (!autoScroll || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [autoScroll, displayEvents.length]);

  useEffect(() => {
    if (focusedTaskId) setTaskFilter(focusedTaskId);
  }, [focusedTaskId]);

  // 从消息回溯而来：只保留产生该回复的那次执行
  useEffect(() => {
    if (focusedTraceId) setTraceFilter(focusedTraceId);
  }, [focusedTraceId]);

  useEffect(() => {
    if (selectedIndex == null) return;
    if (!displayEvents.some((record) => record.index === selectedIndex)) {
      setSelectedIndex(displayEvents[0]?.index ?? null);
    }
  }, [displayEvents, selectedIndex]);

  function clearFilters() {
    setErrorsOnly(false);
    setLevelFilter("ALL");
    setQuery("");
    setTraceFilter(null);
    setTaskFilter(null);
  }

  return (
    <div className="log-panel">
      <div className="log-toolbar">
        <div className="panel-title">执行日志</div>
        <div className="log-toolbar-actions">
          <span>
            {displayEvents.length} / {records.length} 条事件
          </span>
          {sessionId ? (
            <a className="log-download" download={`${sessionId}.jsonl`} href={sessionLogDownloadUrl(sessionId)}>
              导出 JSONL
            </a>
          ) : null}
        </div>
      </div>

      <div className="log-overview" aria-label="日志概览">
        <span>{traceSummaries.length} traces</span>
        <span>{taskSummaries.length} tasks</span>
        <button className={errorsOnly ? "active" : ""} type="button" onClick={() => setErrorsOnly((value) => !value)}>
          {errorCount} errors
        </button>
        {hasActiveFilters ? (
          <button type="button" onClick={clearFilters}>
            清除过滤
          </button>
        ) : null}
      </div>

      {traceSummaries.length > 0 ? (
        <div className="trace-summary-list" aria-label="Trace 摘要">
          {traceSummaries.slice(0, 4).map((trace) => (
            <button
              aria-pressed={traceFilter === trace.traceId}
              className={`trace-summary ${traceFilter === trace.traceId ? "active" : ""}`}
              key={trace.traceId}
              type="button"
              onClick={() => setTraceFilter((current) => (current === trace.traceId ? null : trace.traceId))}
            >
              <span className="trace-id">trace {trace.traceId.slice(0, 8)}</span>
              <span>{trace.events} 事件</span>
              <span>{trace.tools} 工具</span>
              <span>{trace.artifacts} 产物</span>
              <span className={trace.errors > 0 ? "trace-error" : ""}>{trace.errors} 错误</span>
              <span>{trace.durationMs.toFixed(0)}ms</span>
            </button>
          ))}
        </div>
      ) : null}

      {taskSummaries.length > 0 ? (
        <div className="task-summary-list" aria-label="任务进度摘要">
          {taskSummaries.slice(0, 3).map((task) => (
            <button
              aria-pressed={taskFilter === task.taskId}
              className={`task-summary ${taskFilter === task.taskId ? "active" : ""}`}
              key={task.taskId}
              type="button"
              onClick={() => setTaskFilter((current) => (current === task.taskId ? null : task.taskId))}
            >
              <span>{Math.round(task.progress * 100)}%</span>
              <strong>{task.label}</strong>
              <small>{task.taskId.slice(0, 12)}</small>
            </button>
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

      {selectedRecord ? (
        <div className="log-inspector" aria-label="选中事件详情">
          <div>
            <strong>{selectedRecord.level}</strong>
            <span>{selectedRecord.message}</span>
          </div>
          <small>
            {[
              selectedRecord.event.type,
              selectedRecord.traceId ? `trace ${selectedRecord.traceId}` : "",
              selectedRecord.taskId ? `task ${selectedRecord.taskId}` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </small>
          <pre>{selectedRecord.detail || JSON.stringify(selectedRecord.event, null, 2)}</pre>
        </div>
      ) : null}

      <div className="log-list" ref={listRef}>
        {displayEvents.length === 0 ? (
          <div className="empty-state">等待 Agent 事件。执行分析、训练或经验抽取后，这里会显示工具链路、Kernel 输出和产物事件。</div>
        ) : (
          displayEvents.map((record) => {
            const detail = record.detail;
            return (
              <article
                className={`log-row ${detail ? "with-detail" : ""} ${selectedRecord?.index === record.index ? "selected" : ""}`}
                key={`${record.event.type}-${record.index}`}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedIndex(record.index)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") setSelectedIndex(record.index);
                }}
              >
                <span className={`log-level ${record.level.toLowerCase()}`}>{record.level}</span>
                <span className="log-message">
                  {record.message}
                  <span className="log-meta">{[formatTrace(record.event), record.duration].filter(Boolean).join(" · ")}</span>
                </span>
                {detail ? (
                  <details className="log-detail">
                    <summary>详情</summary>
                    <pre>{detail}</pre>
                  </details>
                ) : null}
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
