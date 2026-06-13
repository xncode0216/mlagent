import type { AgentStreamEvent } from "./types";

export type ToolActivityStatus = "idle" | "running" | "success" | "error";

export type ToolActivitySummary = {
  id: string;
  label: string;
  status: ToolActivityStatus;
  count: number;
  detail?: string;
  durationMs?: number;
};

type InternalToolSummary = ToolActivitySummary & {
  callIds: Set<string>;
  firstIndex: number;
  lastIndex: number;
};

function normalizeToolLabel(label?: string) {
  const normalized = label?.trim();
  return normalized || "tool_call";
}

function createSummary(label: string, index: number): InternalToolSummary {
  return {
    id: label,
    label,
    status: "running",
    count: 0,
    callIds: new Set<string>(),
    firstIndex: index,
    lastIndex: index,
  };
}

export function buildToolActivitySummaries(
  events: AgentStreamEvent[],
  fallbackTools: string[],
  limit = 6,
): ToolActivitySummary[] {
  const toolEvents = events.filter(
    (event) => event.type === "tool_call_started" || event.type === "tool_started" || event.type === "tool_call_finished",
  );

  if (toolEvents.length === 0) {
    return fallbackTools.slice(0, limit).map((tool) => ({
      id: `fallback-${tool}`,
      label: tool,
      status: "idle",
      count: 0,
    }));
  }

  const labelsByCallId = new Map<string, string>();
  const summaries = new Map<string, InternalToolSummary>();

  function upsert(label: string, callId: string, index: number) {
    const key = normalizeToolLabel(label);
    const summary = summaries.get(key) ?? createSummary(key, index);
    summary.lastIndex = index;
    if (!summary.callIds.has(callId)) {
      summary.callIds.add(callId);
      summary.count += 1;
    }
    summaries.set(key, summary);
    return summary;
  }

  toolEvents.forEach((event, index) => {
    if (event.type === "tool_call_started" || event.type === "tool_started") {
      labelsByCallId.set(event.call_id, event.tool);
      const summary = upsert(event.tool, event.call_id, index);
      summary.status = "running";
      summary.detail = undefined;
      summary.durationMs = undefined;
      return;
    }

    const label = labelsByCallId.get(event.call_id) ?? event.result_ref ?? event.status;
    const summary = upsert(label, event.call_id, index);
    summary.status = event.status;
    summary.detail = event.error ?? event.result_ref;
    summary.durationMs = event.duration_ms;
  });

  return [...summaries.values()]
    .sort((left, right) => left.lastIndex - right.lastIndex || left.firstIndex - right.firstIndex)
    .slice(-limit)
    .map((summary) => ({
      id: summary.id,
      label: summary.label,
      status: summary.status,
      count: summary.count,
      detail: summary.detail,
      durationMs: summary.durationMs,
    }));
}
