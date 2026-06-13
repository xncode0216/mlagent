import { describe, expect, it } from "vitest";

import type { KnowledgeGraphNode } from "../../lib/api";
import { buildGraphEvidenceItems } from "./graphEvidence";

describe("buildGraphEvidenceItems", () => {
  it("formats stable provenance metadata before raw evidence", () => {
    const node: KnowledgeGraphNode = {
      id: "rule_lesson-1",
      label: "Missing values",
      type: "rule",
      properties: {
        provenance: {
          kind: "lesson",
          source_type: "analysis_session",
          source_id: "session-1",
          evidence: {
            column: "age",
            missing_ratio: 0.047,
          },
        },
      },
    };

    expect(buildGraphEvidenceItems(node)).toEqual([
      { label: "来源类型", value: "analysis_session" },
      { label: "来源 ID", value: "session-1" },
      { label: "证据: column", value: "age" },
      { label: "证据: missing_ratio", value: "0.047" },
    ]);
  });

  it("shows experiment artifact paths when available", () => {
    const node: KnowledgeGraphNode = {
      id: "exp_run-1",
      label: "SKLEARN",
      type: "experiment",
      properties: {
        provenance: {
          kind: "experiment_run",
          experiment_id: "run-1",
          dataset_path: "data/customer_churn.csv",
          metrics_path: "results/run-1.metrics.json",
          model_path: "models/run-1.model.json",
        },
      },
    };

    expect(buildGraphEvidenceItems(node)).toEqual([
      {
        action: { type: "experiment", experimentId: "run-1" },
        label: "实验 ID",
        value: "run-1",
      },
      {
        action: { type: "file", path: "data/customer_churn.csv" },
        label: "数据集",
        value: "data/customer_churn.csv",
      },
      {
        action: { type: "file", path: "results/run-1.metrics.json" },
        label: "指标产物",
        value: "results/run-1.metrics.json",
      },
      {
        action: { type: "file", path: "models/run-1.model.json" },
        label: "模型产物",
        value: "models/run-1.model.json",
      },
    ]);
  });

  it("makes dataset column provenance navigable to the source dataset", () => {
    const node: KnowledgeGraphNode = {
      id: "col_age",
      label: "age",
      type: "column",
      properties: {
        provenance: {
          kind: "dataset_column",
          dataset_paths: ["data/customer_churn.csv"],
          column: "age",
        },
      },
    };

    expect(buildGraphEvidenceItems(node)).toEqual([
      {
        action: { type: "file", path: "data/customer_churn.csv" },
        label: "数据集",
        value: "data/customer_churn.csv",
      },
      { label: "字段", value: "age" },
    ]);
  });

  it("keeps each dataset column source path independently navigable", () => {
    const node: KnowledgeGraphNode = {
      id: "col_customerID",
      label: "customerID",
      type: "column",
      properties: {
        provenance: {
          kind: "dataset_column",
          dataset_paths: ["data/raw.csv", "results/cleaned.csv"],
          column: "customerID",
        },
      },
    };

    expect(buildGraphEvidenceItems(node)).toEqual([
      { action: { type: "file", path: "data/raw.csv" }, label: "数据集", value: "data/raw.csv" },
      { action: { type: "file", path: "results/cleaned.csv" }, label: "数据集", value: "results/cleaned.csv" },
      { label: "字段", value: "customerID" },
    ]);
  });
});
