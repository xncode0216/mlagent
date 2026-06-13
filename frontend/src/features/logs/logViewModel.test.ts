import { describe, expect, it } from "vitest";

import type { AgentStreamEvent, Artifact } from "../chat/types";
import {
  buildLogRecords,
  buildTaskSummaries,
  buildTraceSummaries,
  filterLogRecords,
  formatEventMessage,
} from "./logViewModel";

const artifact: Artifact = {
  id: "artifact-1",
  project_id: "project-1",
  session_id: "session-1",
  type: "model",
  name: "model.json",
  path: "models/model.json",
  metadata: {},
  created_at: "2026-05-24T00:00:00Z",
};

const events: AgentStreamEvent[] = [
  { type: "message_delta", message_id: "message-1", delta: "hello", trace_id: "trace-a" },
  { type: "tool_call_started", call_id: "call-1", tool: "train_sklearn", args: { target: "Churn" }, trace_id: "trace-a" },
  { type: "artifact_created", artifact, trace_id: "trace-a" },
  { type: "tool_call_finished", call_id: "call-1", status: "error", error: "GPU timeout", duration_ms: 1250, trace_id: "trace-a" },
  { type: "task_progress", task_id: "train-session-1", progress: 0.4, label: "训练中", trace_id: "trace-a" },
  { type: "task_progress", task_id: "train-session-1", progress: 1, label: "完成", trace_id: "trace-a" },
  {
    type: "rules_matched",
    matched_rules: [{ lesson_id: "lesson-1", score: 0.91, recommendation: "检查目标列", reason: "历史任务命中" }],
    prompt_snippet: "训练 churn 模型",
    trace_id: "trace-b",
  },
  { type: "kernel_output", stream: "stderr", text: "warning: missing values", trace_id: "trace-b" },
];

describe("log view model", () => {
  it("formats rules matched events and includes them in search text", () => {
    const ruleEvent = events.find((event) => event.type === "rules_matched");
    expect(ruleEvent).toBeDefined();
    expect(formatEventMessage(ruleEvent!)).toContain("命中 1 条经验规则");

    const records = buildLogRecords(events);

    expect(filterLogRecords(records, { level: "ALL", query: "历史任务命中" })).toHaveLength(1);
  });

  it("builds trace summaries with errors, artifacts, tools, and duration", () => {
    const records = buildLogRecords(events);

    expect(buildTraceSummaries(records)[0]).toMatchObject({
      traceId: "trace-a",
      events: 5,
      tools: 1,
      artifacts: 1,
      errors: 1,
      durationMs: 1250,
    });
  });

  it("builds task summaries from progress events", () => {
    const records = buildLogRecords(events);

    expect(buildTaskSummaries(records)).toEqual([
      {
        taskId: "train-session-1",
        label: "完成",
        progress: 1,
        events: 2,
        traceIds: ["trace-a"],
      },
    ]);
  });

  it("filters by level, error focus, trace, task, and query", () => {
    const records = buildLogRecords(events);

    expect(filterLogRecords(records, { level: "ERROR", query: "" }).map((record) => record.message)).toEqual([
      "工具调用失败",
    ]);
    expect(filterLogRecords(records, { level: "ALL", query: "", errorsOnly: true })).toHaveLength(1);
    expect(filterLogRecords(records, { level: "ALL", query: "", traceId: "trace-b" })).toHaveLength(2);
    expect(filterLogRecords(records, { level: "ALL", query: "", taskId: "train-session-1" })).toHaveLength(2);
    expect(filterLogRecords(records, { level: "ALL", query: "gpu timeout" })).toHaveLength(1);
  });
  it("formats and searches structured agent command events", () => {
    const records = buildLogRecords([
      {
        type: "agent_command",
        task_id: "train-session-1",
        trace_id: "trace-command",
        command: {
          intent: "train",
          dataset_path: "data/customer_churn.csv",
          target_column: "churn",
          missing_context: [],
          risk_level: "medium",
          planned_steps: ["train"],
          proposed_tools: ["train_sklearn"],
        },
        resolved_context: {
          preprocessing_plan_path: "results/session-1/preprocessing_plan.json",
        },
      },
    ]);

    expect(records[0]).toMatchObject({
      level: "INFO",
      message: "Agent command: train",
      taskId: "train-session-1",
    });
    expect(filterLogRecords(records, { level: "ALL", query: "preprocessing_plan" })).toHaveLength(1);
  });
});
