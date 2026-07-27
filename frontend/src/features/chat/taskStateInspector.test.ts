import { describe, expect, it } from "vitest";

import { buildTaskStateInspection } from "./taskStateInspector";
import type { AgentStreamEvent } from "./types";
import type { DurableTaskState } from "./taskStateEvents";

describe("task state inspector", () => {
  it("summarizes failed sklearn state with saved inputs and related logs", () => {
    const state: DurableTaskState = {
      session_id: "session-1",
      stage: "train",
      status: "failed",
      dataset_path: "data/train_retry.csv",
      target_column: "churn",
      engine: "sklearn",
      use_gpu: false,
      preprocessing_plan_path: "results/session-1/preprocessing_plan.json",
      retry_count: 2,
      last_error: "Target column was not found",
      repair_hint: "Check saved training inputs before retrying.",
      stale_check: "Confirm dataset and plan are still current.",
      resume_action: "Retry saved sklearn training.",
      regenerate_action: "Regenerate preprocessing first.",
      abandon_action: "Clear saved training state.",
      stale_artifact_paths: ["data/train_retry.csv", "results/session-1/preprocessing_plan.json"],
      updated_at: "2026-06-01T12:00:00Z",
    };
    const events: AgentStreamEvent[] = [
      {
        type: "step_failed",
        task_id: "session-1",
        stage: "train",
        label: "sklearn training failed",
        error: "Target column was not found",
        retryable: true,
      },
      {
        type: "task_progress",
        task_id: "session-1",
        progress: 0.4,
        label: "Training execution failed",
      },
    ];

    const inspection = buildTaskStateInspection([state], events, "train");

    expect(inspection).toMatchObject({
      stage: "train",
      taskId: "session-1",
      title: "训练 失败检查器",
      datasetPath: "data/train_retry.csv",
      planPath: "results/session-1/preprocessing_plan.json",
    });
    expect(inspection?.facts).toEqual(
      expect.arrayContaining([
        { label: "数据集", value: "data/train_retry.csv" },
        { label: "目标列", value: "churn" },
        { label: "引擎", value: "sklearn" },
        { label: "GPU", value: "未请求" },
        { label: "重试次数", value: "2" },
        { label: "最近错误", value: "Target column was not found" },
        { label: "修复", value: "Check saved training inputs before retrying." },
        { label: "陈旧检查", value: "Confirm dataset and plan are still current." },
        { label: "恢复", value: "Retry saved sklearn training." },
        { label: "重新生成", value: "Regenerate preprocessing first." },
        { label: "放弃", value: "Clear saved training state." },
        {
          label: "陈旧产物",
          value: "data/train_retry.csv, results/session-1/preprocessing_plan.json",
        },
        { label: "相关日志", value: "2" },
        { label: "最新日志", value: "Training execution failed" },
      ]),
    );
    expect(inspection?.facts.find((fact) => fact.label === "恢复")?.value).toBe("Retry saved sklearn training.");
  });

  it("prefers the requested failed stage and supports transform state field names", () => {
    const states: DurableTaskState[] = [
      {
        session_id: "session-1",
        stage: "train",
        status: "failed",
        dataset_path: "data/train.csv",
        updated_at: "2026-06-01T12:05:00Z",
      },
      {
        session_id: "session-1",
        stage: "transform",
        status: "failed",
        active_file: "data/raw.csv",
        plan_path: "results/session-1/preprocessing_plan.json",
        last_error: "Plan target missing",
        updated_at: "2026-06-01T12:00:00Z",
      },
    ];

    const inspection = buildTaskStateInspection(states, [], "transform");

    expect(inspection).toMatchObject({
      stage: "transform",
      datasetPath: "data/raw.csv",
      planPath: "results/session-1/preprocessing_plan.json",
    });
    expect(inspection?.facts).toEqual(
      expect.arrayContaining([
        { label: "数据集", value: "data/raw.csv" },
        { label: "计划", value: "results/session-1/preprocessing_plan.json" },
        { label: "最近错误", value: "Plan target missing" },
      ]),
    );
  });

  it("summarizes failed evaluation report state with experiment and metrics context", () => {
    const inspection = buildTaskStateInspection(
      [
        {
          session_id: "eval-session",
          stage: "evaluate",
          status: "failed",
          experiment_id: "exp-eval-retry",
          dataset_path: "data/customer_churn.csv",
          target_column: "churn",
          engine: "sklearn",
          metrics_path: "results/eval-session/missing_metrics.json",
          model_path: "models/model.pkl",
          retry_count: 1,
          last_error: "Metrics artifact not found",
        },
      ],
      [
        {
          type: "step_failed",
          task_id: "eval-session",
          stage: "evaluate",
          label: "Evaluation report generation failed",
          error: "Metrics artifact not found",
          retryable: true,
        },
      ],
      "evaluate",
    );

    expect(inspection).toMatchObject({
      stage: "evaluate",
      taskId: "eval-session",
      title: "评估 失败检查器",
      datasetPath: "data/customer_churn.csv",
      planPath: "results/eval-session/missing_metrics.json",
    });
    expect(inspection?.facts).toEqual(
      expect.arrayContaining([
        { label: "实验", value: "exp-eval-retry" },
        { label: "指标", value: "results/eval-session/missing_metrics.json" },
        { label: "最近错误", value: "Metrics artifact not found" },
      ]),
    );
    expect(inspection?.facts.find((fact) => fact.label === "恢复")?.value).toContain("重新运行评估");
  });

  it("summarizes failed export state with report artifact context", () => {
    const inspection = buildTaskStateInspection(
      [
        {
          session_id: "export-session",
          stage: "export",
          status: "failed",
          experiment_id: "exp-export",
          report_path: "results/export-session/model_evaluation_report.md",
          metrics_path: "results/export-session/sklearn_training_metrics.json",
          last_error: "Evaluation Report Artifact not found",
        },
      ],
      [],
      "export",
    );

    expect(inspection).toMatchObject({
      stage: "export",
      taskId: "export-session",
      title: "导出 失败检查器",
      planPath: "results/export-session/model_evaluation_report.md",
    });
    expect(inspection?.facts).toEqual(
      expect.arrayContaining([
        { label: "实验", value: "exp-export" },
        { label: "报告", value: "results/export-session/model_evaluation_report.md" },
        { label: "最近错误", value: "Evaluation Report Artifact not found" },
      ]),
    );
    expect(inspection?.facts.find((fact) => fact.label === "恢复")?.value).toContain("重新运行导出");
  });

  it("summarizes failed learning state with source evidence context", () => {
    const inspection = buildTaskStateInspection(
      [
        {
          session_id: "learn-session",
          stage: "learn",
          status: "failed",
          source_type: "session",
          source_id: "learn-session",
          retry_count: 1,
          last_error: "Session not found for lesson extraction",
        },
      ],
      [],
      "learn",
    );

    expect(inspection).toMatchObject({
      stage: "learn",
      taskId: "learn-session",
      title: "沉淀 失败检查器",
    });
    expect(inspection?.facts).toEqual(
      expect.arrayContaining([
        { label: "来源", value: "learn-session" },
        { label: "重试次数", value: "1" },
        { label: "最近错误", value: "Session not found for lesson extraction" },
      ]),
    );
    expect(inspection?.facts.find((fact) => fact.label === "恢复")?.value).toContain("重新运行经验提取");
  });

  it("returns null when there is no failed workflow task state", () => {
    expect(
      buildTaskStateInspection([
        { session_id: "session-1", stage: "train", status: "completed" },
        { session_id: "session-1", stage: "unknown", status: "failed" },
      ], []),
    ).toBeNull();
  });
});
