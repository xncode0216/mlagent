import { describe, expect, it } from "vitest";

import type { AgentStreamEvent } from "./types";
import { buildToolActivitySummaries } from "./toolActivity";

describe("tool activity summaries", () => {
  it("uses the static tool list before any live tool events arrive", () => {
    expect(buildToolActivitySummaries([], ["load_data()", "profile_dataset()"])).toEqual([
      { id: "fallback-load_data()", label: "load_data()", status: "idle", count: 0 },
      { id: "fallback-profile_dataset()", label: "profile_dataset()", status: "idle", count: 0 },
    ]);
  });

  it("collapses repeated started and finished events into one status chip", () => {
    const events: AgentStreamEvent[] = [
      { type: "tool_call_started", call_id: "call-1", tool: "profile_dataset", args: {} },
      { type: "tool_call_finished", call_id: "call-1", status: "error", error: "backend failed" },
      { type: "tool_call_started", call_id: "call-2", tool: "profile_dataset", args: {} },
      { type: "tool_call_finished", call_id: "call-2", status: "error", error: "backend failed again" },
    ];

    expect(buildToolActivitySummaries(events, [])).toEqual([
      {
        id: "profile_dataset",
        label: "profile_dataset",
        status: "error",
        count: 2,
        detail: "backend failed again",
      },
    ]);
  });

  it("keeps the started tool label for a finished event instead of rendering a separate error chip", () => {
    const events: AgentStreamEvent[] = [
      { type: "tool_call_started", call_id: "call-1", tool: "train_sklearn", args: {} },
      { type: "tool_call_finished", call_id: "call-1", status: "success", result_ref: "metrics.json" },
    ];

    expect(buildToolActivitySummaries(events, [])).toEqual([
      {
        id: "train_sklearn",
        label: "train_sklearn",
        status: "success",
        count: 1,
        detail: "metrics.json",
      },
    ]);
  });
});
