import type { AgentStreamEvent } from "../chat/types";

export type LogLevel = "ALL" | "INFO" | "TOOL" | "WARN" | "ERROR";
export type ConcreteLogLevel = Exclude<LogLevel, "ALL">;

export type LogRecord = {
  event: AgentStreamEvent;
  index: number;
  level: ConcreteLogLevel;
  message: string;
  detail: string;
  traceId: string;
  taskId: string;
  duration: string;
  searchableText: string;
};

export type TraceSummary = {
  traceId: string;
  events: number;
  tools: number;
  artifacts: number;
  errors: number;
  durationMs: number;
};

export type TaskSummary = {
  taskId: string;
  label: string;
  progress: number;
  events: number;
  traceIds: string[];
};

export type LogFilters = {
  level: LogLevel;
  query: string;
  traceId?: string | null;
  taskId?: string | null;
  errorsOnly?: boolean;
};

export function formatEventMessage(event: AgentStreamEvent) {
  switch (event.type) {
    case "message_delta":
      return "Agent 正在流式输出回复";
    case "agent_command":
      return `Agent command: ${event.command.intent}`;
    case "tool_call_started":
    case "tool_started":
      return `开始调用工具 ${event.tool}`;
    case "tool_call_finished":
      return `工具调用${event.status === "success" ? "完成" : "失败"}${event.result_ref ? ` · ${event.result_ref}` : ""}`;
    case "kernel_output":
      return event.text;
    case "artifact_created":
      return `生成产物 ${event.artifact.name}`;
    case "task_progress":
      return `${Math.round(event.progress * 100)}% · ${event.label}`;
    case "stage_started":
      return `${event.stage} started${event.label ? ` - ${event.label}` : ""}`;
    case "stage_completed":
      return `${event.stage} completed${event.label ? ` - ${event.label}` : ""}`;
    case "approval_required":
      return `Approval required: ${event.title}`;
    case "approval_resolved":
      return `Approval ${event.decision}: ${event.approval_id}`;
    case "component_requested":
      return `Component requested: ${event.title ?? event.component}`;
    case "step_failed":
      return `Step failed: ${event.label}`;
    case "step_completed":
      return `Step completed: ${event.label}`;
    case "task_resumed":
      return `Task resumed${event.label ? ` - ${event.label}` : ""}`;
    case "lesson_extracted":
      return `抽取经验 ${event.lesson_id}，置信度 ${Math.round(event.confidence * 100)}%`;
    case "rules_matched":
      return `命中 ${event.matched_rules.length} 条经验规则 · ${event.prompt_snippet}`;
    case "error":
      return event.message;
  }
}

export function eventLevel(event: AgentStreamEvent): ConcreteLogLevel {
  if (event.type === "error" || event.type === "step_failed") return "ERROR";
  if (event.type === "approval_required") return "WARN";
  if (event.type === "kernel_output" && event.stream === "stderr") return "WARN";
  if (event.type === "tool_call_finished" && event.status === "error") return "ERROR";
  if (event.type === "tool_call_started" || event.type === "tool_started" || event.type === "tool_call_finished") return "TOOL";
  return "INFO";
}

export function eventDetail(event: AgentStreamEvent) {
  if (event.type === "agent_command") return JSON.stringify(event.command, null, 2);
  if (event.type === "tool_call_started") return JSON.stringify(event.args, null, 2);
  if (event.type === "tool_started") return JSON.stringify(event.args ?? {}, null, 2);
  if (event.type === "tool_call_finished" && event.error) return event.error;
  if (event.type === "error") return `${event.code}: ${event.message}`;
  if (event.type === "approval_required") return event.description ?? event.artifact_path ?? "";
  if (event.type === "approval_resolved") return event.resolved_at ?? "";
  if (event.type === "component_requested") return event.artifact_path ?? JSON.stringify(event.props ?? {}, null, 2);
  if (event.type === "step_failed") return event.error;
  if (event.type === "kernel_output" && event.stream === "stderr") return event.text;
  if (event.type === "rules_matched" && event.matched_rules.length > 0) {
    return JSON.stringify(event.matched_rules, null, 2);
  }
  return "";
}

export function formatDuration(event: AgentStreamEvent) {
  if (event.type !== "tool_call_finished" || typeof event.duration_ms !== "number") return "";
  return `${event.duration_ms.toFixed(0)}ms`;
}

export function formatTrace(event: AgentStreamEvent) {
  return event.trace_id ? `trace ${event.trace_id.slice(0, 8)}` : "";
}

export function eventTaskId(event: AgentStreamEvent) {
  return "task_id" in event && typeof event.task_id === "string" ? event.task_id : "";
}

export function buildLogRecords(events: AgentStreamEvent[]): LogRecord[] {
  return events
    .map((event, index) => {
      const level = eventLevel(event);
      const message = formatEventMessage(event);
      const detail = eventDetail(event);
      const traceId = event.trace_id ?? "";
      const taskId = eventTaskId(event);
      const duration = formatDuration(event);
      const searchableText = [
        event.type,
        level,
        traceId,
        taskId,
        message,
        detail,
        event.type === "tool_call_started" || event.type === "tool_started" || event.type === "tool_call_finished"
          ? event.call_id
          : "",
        event.type === "agent_command" ? JSON.stringify(event.resolved_context ?? {}) : "",
      ]
        .join(" ")
        .toLowerCase();

      return { event, index, level, message, detail, traceId, taskId, duration, searchableText };
    })
    .filter((record) => record.event.type !== "message_delta");
}

export function filterLogRecords(records: LogRecord[], filters: LogFilters) {
  const normalizedQuery = filters.query.trim().toLowerCase();

  return records.filter((record) => {
    if (filters.level !== "ALL" && record.level !== filters.level) return false;
    if (filters.errorsOnly && record.level !== "ERROR") return false;
    if (filters.traceId && record.traceId !== filters.traceId) return false;
    if (filters.taskId && record.taskId !== filters.taskId) return false;
    if (normalizedQuery && !record.searchableText.includes(normalizedQuery)) return false;
    return true;
  });
}

export function buildTraceSummaries(records: LogRecord[]): TraceSummary[] {
  const traces = new Map<string, TraceSummary>();

  for (const record of records) {
    if (!record.traceId) continue;
    const summary =
      traces.get(record.traceId) ??
      {
        traceId: record.traceId,
        events: 0,
        tools: 0,
        artifacts: 0,
        errors: 0,
        durationMs: 0,
      };

    summary.events += 1;
    if (record.event.type === "tool_call_started" || record.event.type === "tool_started") summary.tools += 1;
    if (record.event.type === "artifact_created") summary.artifacts += 1;
    if (record.level === "ERROR") summary.errors += 1;
    if (record.event.type === "tool_call_finished" && typeof record.event.duration_ms === "number") {
      summary.durationMs += record.event.duration_ms;
    }
    traces.set(record.traceId, summary);
  }

  return [...traces.values()].sort((left, right) => right.errors - left.errors || right.events - left.events);
}

export function buildTaskSummaries(records: LogRecord[]): TaskSummary[] {
  const tasks = new Map<string, TaskSummary>();

  for (const record of records) {
    if (record.event.type !== "task_progress") continue;
    const summary =
      tasks.get(record.event.task_id) ??
      {
        taskId: record.event.task_id,
        label: record.event.label,
        progress: 0,
        events: 0,
        traceIds: [],
      };

    summary.label = record.event.label;
    summary.progress = Math.max(summary.progress, record.event.progress);
    summary.events += 1;
    if (record.traceId && !summary.traceIds.includes(record.traceId)) summary.traceIds.push(record.traceId);
    tasks.set(record.event.task_id, summary);
  }

  return [...tasks.values()].sort((left, right) => right.progress - left.progress || right.events - left.events);
}
