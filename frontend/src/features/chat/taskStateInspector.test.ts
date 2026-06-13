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
      title: "Train failure inspector",
      datasetPath: "data/train_retry.csv",
      planPath: "results/session-1/preprocessing_plan.json",
    });
    expect(inspection?.facts).toEqual(
      expect.arrayContaining([
        { label: "Dataset", value: "data/train_retry.csv" },
        { label: "Target", value: "churn" },
        { label: "Engine", value: "sklearn" },
        { label: "GPU", value: "Not requested" },
        { label: "Retries", value: "2" },
        { label: "Last error", value: "Target column was not found" },
        { label: "Repair", value: "Check saved training inputs before retrying." },
        { label: "Stale check", value: "Confirm dataset and plan are still current." },
        { label: "Resume", value: "Retry saved sklearn training." },
        { label: "Regenerate", value: "Regenerate preprocessing first." },
        { label: "Abandon", value: "Clear saved training state." },
        {
          label: "Stale artifacts",
          value: "data/train_retry.csv, results/session-1/preprocessing_plan.json",
        },
        { label: "Related logs", value: "2" },
        { label: "Latest log", value: "Training execution failed" },
      ]),
    );
    expect(inspection?.facts.find((fact) => fact.label === "Resume")?.value).toBe("Retry saved sklearn training.");
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
        { label: "Dataset", value: "data/raw.csv" },
        { label: "Plan", value: "results/session-1/preprocessing_plan.json" },
        { label: "Last error", value: "Plan target missing" },
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
      title: "Evaluate failure inspector",
      datasetPath: "data/customer_churn.csv",
      planPath: "results/eval-session/missing_metrics.json",
    });
    expect(inspection?.facts).toEqual(
      expect.arrayContaining([
        { label: "Experiment", value: "exp-eval-retry" },
        { label: "Metrics", value: "results/eval-session/missing_metrics.json" },
        { label: "Last error", value: "Metrics artifact not found" },
      ]),
    );
    expect(inspection?.facts.find((fact) => fact.label === "Resume")?.value).toContain("rerun evaluation");
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
      title: "Export failure inspector",
      planPath: "results/export-session/model_evaluation_report.md",
    });
    expect(inspection?.facts).toEqual(
      expect.arrayContaining([
        { label: "Experiment", value: "exp-export" },
        { label: "Report", value: "results/export-session/model_evaluation_report.md" },
        { label: "Last error", value: "Evaluation Report Artifact not found" },
      ]),
    );
    expect(inspection?.facts.find((fact) => fact.label === "Resume")?.value).toContain("rerun export");
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
      title: "Learn failure inspector",
    });
    expect(inspection?.facts).toEqual(
      expect.arrayContaining([
        { label: "Source", value: "learn-session" },
        { label: "Retries", value: "1" },
        { label: "Last error", value: "Session not found for lesson extraction" },
      ]),
    );
    expect(inspection?.facts.find((fact) => fact.label === "Resume")?.value).toContain("rerun lesson extraction");
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
