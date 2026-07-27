import { describe, expect, it } from "vitest";

import type { WorkflowStageId } from "../chat/types";
import { inspectorTabForStage, inspectorTabForWorkflow } from "./inspectorContext";

function workflow(currentStage: WorkflowStageId, latestArtifactStage?: WorkflowStageId) {
  return {
    currentStage: { id: currentStage },
    latestArtifact: latestArtifactStage
      ? { name: "artifact", path: "results/a.json", stage: latestArtifactStage }
      : null,
  };
}

describe("inspector tab follows the workflow stage", () => {
  it("keeps data-shaped stages on the data inspector", () => {
    expect(inspectorTabForStage("ingest")).toBe("data");
    expect(inspectorTabForStage("profile")).toBe("data");
    expect(inspectorTabForStage("clean")).toBe("data");
    expect(inspectorTabForStage("transform")).toBe("data");
  });

  it("moves model-shaped stages to the training inspector", () => {
    expect(inspectorTabForStage("train")).toBe("training");
    expect(inspectorTabForStage("evaluate")).toBe("training");
    expect(inspectorTabForStage("diagnose")).toBe("training");
    expect(inspectorTabForStage("iterate")).toBe("training");
    expect(inspectorTabForStage("export")).toBe("training");
  });

  it("sends lesson extraction to the logs inspector", () => {
    // 沉淀阶段没有独立的检查器视图，其证据是事件流本身
    expect(inspectorTabForStage("learn")).toBe("logs");
  });
});

describe("inspector target for a workflow snapshot", () => {
  // currentStage 表达的是"需要用户注意的阶段"（失败/待审批优先），并不等于
  // "刚刚产出了什么"。检查器要带用户去看最新产物，因此以产物阶段为准。
  it("follows the newest artifact rather than a pending earlier stage", () => {
    expect(inspectorTabForWorkflow(workflow("transform", "train"))).toBe("training");
  });

  it("falls back to the current stage before any artifact exists", () => {
    expect(inspectorTabForWorkflow(workflow("profile"))).toBe("data");
  });

  it("returns to the data inspector when the newest artifact is a dataset", () => {
    expect(inspectorTabForWorkflow(workflow("train", "transform"))).toBe("data");
  });
});
