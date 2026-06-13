import { describe, expect, it } from "vitest";

import {
  taskStateToEvent,
  taskStatesToEvents,
  trainingContextFromTaskStates,
  type DurableTaskState,
} from "./taskStateEvents";

describe("task state events", () => {
  it("maps failed sklearn training state to a retryable train failure event", () => {
    const event = taskStateToEvent({
      session_id: "session-1",
      stage: "train",
      status: "failed",
      engine: "sklearn",
      retry_count: 1,
      last_error: "Target column was not found",
    });

    expect(event).toEqual({
      type: "step_failed",
      task_id: "session-1",
      stage: "train",
      label: "sklearn training failed",
      error: "Target column was not found",
      retryable: true,
      resume_stage: "train",
      retry_count: 1,
    });
  });

  it("maps failed evaluation report state to a retryable evaluate failure event", () => {
    const event = taskStateToEvent({
      session_id: "session-1",
      stage: "evaluate",
      status: "failed",
      experiment_id: "exp-eval-retry",
      metrics_path: "results/session-1/missing_metrics.json",
      retry_count: 0,
      last_error: "Metrics artifact not found",
    });

    expect(event).toEqual({
      type: "step_failed",
      task_id: "session-1",
      stage: "evaluate",
      label: "evaluation report failed",
      error: "Metrics artifact not found",
      retryable: true,
      resume_stage: "evaluate",
      retry_count: 0,
    });
  });

  it("maps failed export and learn states to retryable events", () => {
    expect(
      taskStateToEvent({
        session_id: "session-1",
        stage: "export",
        status: "failed",
        experiment_id: "exp-export",
        report_path: "results/session-1/model_evaluation_report.md",
        last_error: "Evaluation Report Artifact not found",
      }),
    ).toMatchObject({
      type: "step_failed",
      task_id: "session-1",
      stage: "export",
      label: "export bundle failed",
      retryable: true,
      resume_stage: "export",
    });
    expect(
      taskStateToEvent({
        session_id: "session-1",
        stage: "learn",
        status: "failed",
        source_id: "session-1",
        last_error: "Session not found for lesson extraction",
      }),
    ).toMatchObject({
      type: "step_failed",
      task_id: "session-1",
      stage: "learn",
      label: "lesson extraction failed",
      retryable: true,
      resume_stage: "learn",
    });
  });

  it("ignores completed, unknown, and incomplete task states", () => {
    const states: DurableTaskState[] = [
      { session_id: "session-1", stage: "train", status: "completed" },
      { session_id: "session-1", stage: "unknown", status: "failed" },
      { session_id: "session-1", status: "failed" },
    ];

    expect(taskStatesToEvents(states)).toEqual([]);
  });

  it("extracts training card context from failed train state", () => {
    expect(
      trainingContextFromTaskStates([
        {
          session_id: "session-1",
          stage: "train",
          status: "failed",
          dataset_path: "data/customer_churn.csv",
          target_column: "churn",
          preprocessing_plan_path: "results/session-1/preprocessing_plan.json",
          retry_count: 2,
          last_error: "GPU timeout",
        },
      ]),
    ).toEqual({
      trainingDatasetPath: "data/customer_churn.csv",
      targetColumn: "churn",
      preprocessingPlanPath: "results/session-1/preprocessing_plan.json",
      retryCount: 2,
      lastError: "GPU timeout",
    });
  });
});
