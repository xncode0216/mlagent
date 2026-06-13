import { describe, expect, it } from "vitest";

import type { AgentStreamEvent, Artifact } from "./types";
import { deriveWorkflowState } from "./workflowState";

function artifact(partial: Partial<Artifact> & Pick<Artifact, "name" | "path">): Artifact {
  return {
    id: partial.id ?? partial.path,
    project_id: partial.project_id ?? "project-1",
    session_id: partial.session_id ?? "session-1",
    type: partial.type ?? "dataframe",
    name: partial.name,
    path: partial.path,
    metadata: partial.metadata ?? {},
    created_at: partial.created_at ?? "2026-05-28T00:00:00Z",
  };
}

describe("workflow state", () => {
  it("starts in the default analysis stage with the active file", () => {
    const state = deriveWorkflowState([], "analysis", "data/churn.csv");

    expect(state.currentStage).toMatchObject({
      id: "ingest",
      status: "active",
      detail: "Active file: data/churn.csv",
    });
    expect(state.nextAction).toContain("ingest");
  });

  it("turns a generated preprocessing plan into an approval checkpoint", () => {
    const events: AgentStreamEvent[] = [
      {
        type: "artifact_created",
        artifact: artifact({
          name: "preprocessing_plan.json",
          path: "results/session-1/preprocessing_plan.json",
          metadata: { feature_columns: ["tenure"], drop_columns: ["customer_id"] },
        }),
      },
    ];

    const state = deriveWorkflowState(events, "analysis", "data/churn.csv");

    expect(state.currentStage).toMatchObject({
      id: "transform",
      status: "blocked",
    });
    expect(state.approval).toMatchObject({
      stage: "transform",
      title: "Review and execute preprocessing plan",
    });
    expect(state.component).toMatchObject({
      kind: "preprocessing_plan",
      artifactPath: "results/session-1/preprocessing_plan.json",
    });
    expect(state.nextAction).toContain("Review approval checkpoint");
  });

  it("moves to training after the planned dataset is created", () => {
    const events: AgentStreamEvent[] = [
      {
        type: "artifact_created",
        artifact: artifact({
          name: "preprocessing_plan.json",
          path: "results/session-1/preprocessing_plan.json",
        }),
      },
      {
        type: "stage_completed",
        task_id: "session-1",
        stage: "transform",
        label: "Preprocessing plan executed",
      },
      {
        type: "artifact_created",
        artifact: artifact({
          name: "churn_planned.csv",
          path: "results/session-1/churn_planned.csv",
        }),
      },
    ];

    const state = deriveWorkflowState(events, "analysis", "results/session-1/churn_planned.csv");

    expect(state.currentStage).toMatchObject({
      id: "train",
      status: "active",
    });
    expect(state.approval).toBeNull();
    expect(state.latestArtifact).toMatchObject({
      stage: "transform",
      path: "results/session-1/churn_planned.csv",
    });
    expect(state.nextAction).toContain("Use the planned dataset");
  });

  it("keeps planned datasets ahead of preprocessing plan metadata and learning side effects", () => {
    const events: AgentStreamEvent[] = [
      {
        type: "artifact_created",
        artifact: artifact({
          name: "preprocessing_plan.json",
          path: "results/session-1/preprocessing_plan.json",
        }),
      },
      {
        type: "stage_completed",
        task_id: "session-1",
        stage: "transform",
        label: "Transform executed",
      },
      {
        type: "artifact_created",
        artifact: artifact({
          name: "customer_churn_planned.csv",
          path: "results/session-1/customer_churn_planned.csv",
          metadata: {
            preprocessing_plan_path: "results/session-1/preprocessing_plan.json",
          },
        }),
      },
      {
        type: "component_requested",
        task_id: "session-1",
        stage: "train",
        component: "training_config",
        title: "Configure sklearn training",
        artifact_path: "results/session-1/customer_churn_planned.csv",
      },
      {
        type: "lesson_extracted",
        lesson_id: "lesson-1",
        confidence: 0.8,
      },
    ];

    const state = deriveWorkflowState(events, "analysis", "data/churn.csv");

    expect(state.currentStage).toMatchObject({
      id: "train",
      status: "active",
    });
    expect(state.approval).toBeNull();
    expect(state.nextAction).toContain("Use the planned dataset");
  });

  it("clears the approval checkpoint when the task resumes after approval", () => {
    const events: AgentStreamEvent[] = [
      {
        type: "approval_required",
        task_id: "session-1",
        approval_id: "session-1-preprocessing-plan",
        stage: "transform",
        title: "Approve preprocessing transform",
      },
      {
        type: "approval_resolved",
        task_id: "session-1",
        approval_id: "session-1-preprocessing-plan",
        stage: "transform",
        decision: "execute",
      },
      {
        type: "task_resumed",
        task_id: "session-1",
        stage: "transform",
        label: "Approval granted; executing preprocessing plan",
      },
    ];

    const state = deriveWorkflowState(events, "analysis", "data/churn.csv");

    expect(state.approval).toBeNull();
    expect(state.currentStage).toMatchObject({
      id: "transform",
      status: "active",
    });
    expect(state.nextAction).toContain("Continue the transform");
  });

  it("does not recreate a synthetic approval after the user requests a plan revision", () => {
    const events: AgentStreamEvent[] = [
      {
        type: "artifact_created",
        artifact: artifact({
          name: "preprocessing_plan.json",
          path: "results/session-1/preprocessing_plan.json",
        }),
      },
      {
        type: "approval_required",
        task_id: "session-1",
        approval_id: "session-1-preprocessing-plan",
        stage: "transform",
        title: "Approve preprocessing transform",
      },
      {
        type: "approval_resolved",
        task_id: "session-1",
        approval_id: "session-1-preprocessing-plan",
        stage: "transform",
        decision: "revise",
      },
      {
        type: "step_failed",
        task_id: "session-1",
        stage: "transform",
        label: "Preprocessing plan needs revision",
        error: "Approval was not granted",
        retryable: false,
      },
    ];

    const state = deriveWorkflowState(events, "analysis", "data/churn.csv");

    expect(state.approval).toBeNull();
    expect(state.currentStage).toMatchObject({
      id: "transform",
      status: "failed",
      detail: "Approval was not granted",
    });
    expect(state.nextAction).toContain("Resolve");
  });

  it("keeps a failed transform as the current stage even when later learn events exist", () => {
    const events: AgentStreamEvent[] = [
      {
        type: "step_failed",
        task_id: "session-1",
        stage: "transform",
        label: "Preprocessing plan needs revision",
        error: "Approval was not granted",
      },
      {
        type: "rules_matched",
        matched_rules: [],
        prompt_snippet: "",
      },
    ];

    const state = deriveWorkflowState(events, "analysis", "data/churn.csv");

    expect(state.currentStage).toMatchObject({
      id: "transform",
      status: "failed",
    });
  });

  it("keeps a retryable transform failure current after failure progress events", () => {
    const events: AgentStreamEvent[] = [
      {
        type: "artifact_created",
        artifact: artifact({
          name: "preprocessing_plan.json",
          path: "results/session-1/preprocessing_plan.json",
        }),
      },
      {
        type: "step_failed",
        task_id: "session-1",
        stage: "transform",
        label: "Preprocessing plan execution failed",
        error: "Target column from preprocessing plan was not found in the dataset",
        retryable: true,
        resume_stage: "transform",
      },
      {
        type: "task_progress",
        task_id: "session-1",
        progress: 0.55,
        label: "Preprocessing execution failed",
      },
    ];

    const state = deriveWorkflowState(events, "analysis", "data/churn.csv");

    expect(state.approval).toBeNull();
    expect(state.currentStage).toMatchObject({
      id: "transform",
      status: "failed",
      retryable: true,
      resumeStage: "transform",
    });
    expect(state.nextAction).toContain("Retry or resume");
  });

  it("understands explicit typed events from the future orchestrator", () => {
    const events: AgentStreamEvent[] = [
      {
        type: "stage_started",
        task_id: "task-1",
        stage: "profile",
        label: "Inspecting dataset quality",
      },
      {
        type: "tool_started",
        call_id: "call-1",
        tool: "data_quality_profile",
        task_id: "task-1",
        stage: "profile",
      },
      {
        type: "component_requested",
        task_id: "task-1",
        stage: "profile",
        component: "data_quality",
        artifact_path: "results/task-1/data_quality_profile.json",
      },
    ];

    const state = deriveWorkflowState(events, "analysis", "data/churn.csv");

    expect(state.currentStage).toMatchObject({
      id: "profile",
      status: "active",
    });
    expect(state.component).toMatchObject({
      kind: "data_quality",
      title: "Data quality review",
    });
  });

  it("marks iterate active when the orchestrator requests an iteration proposal", () => {
    const events: AgentStreamEvent[] = [
      {
        type: "component_requested",
        task_id: "session-1",
        stage: "iterate",
        component: "iteration_proposal",
        title: "Review follow-up experiment proposal",
        artifact_path: "results/session-1/metrics.json",
      },
    ];

    const state = deriveWorkflowState(events, "machine-learning", "results/session-1/model_evaluation_report.md");

    expect(state.currentStage).toMatchObject({
      id: "iterate",
      status: "active",
    });
    expect(state.component).toEqual({
      stage: "iterate",
      kind: "iteration_proposal",
      title: "Review follow-up experiment proposal",
      artifactPath: "results/session-1/metrics.json",
    });
  });

  it("keeps failures visible as the current workflow state", () => {
    const state = deriveWorkflowState(
      [{ type: "step_failed", task_id: "task-1", stage: "train", label: "Train sklearn", error: "GPU timeout" }],
      "machine-learning",
      "results/session-1/churn_planned.csv",
    );

    expect(state.currentStage).toMatchObject({
      id: "train",
      status: "failed",
      detail: "GPU timeout",
    });
    expect(state.nextAction).toContain("Resolve");
  });

  it("preserves retry metadata when a generic error follows a retryable training failure", () => {
    const state = deriveWorkflowState(
      [
        {
          type: "step_failed",
          task_id: "manual-training",
          stage: "train",
          label: "sklearn training failed",
          error: "Target column was not found",
          retryable: true,
          resume_stage: "train",
        },
        { type: "error", code: "training_failed", message: "sklearn training failed" },
      ],
      "machine-learning",
      "data/train_retry.csv",
    );

    expect(state.currentStage).toMatchObject({
      id: "train",
      status: "failed",
      retryable: true,
      resumeStage: "train",
    });
    expect(state.nextAction).toContain("Retry or resume");
  });

  it("uses structured agent command events to show the interpreted workflow step", () => {
    const state = deriveWorkflowState(
      [
        {
          type: "agent_command",
          task_id: "train-session",
          command: {
            intent: "train",
            dataset_path: "data/churn.csv",
            target_column: "churn",
            missing_context: [],
            risk_level: "medium",
            planned_steps: ["train"],
            proposed_tools: ["train_sklearn"],
            component_requests: ["training_config"],
          },
        },
      ],
      "machine-learning",
      "data/churn.csv",
    );

    expect(state.currentStage).toMatchObject({
      id: "train",
      status: "active",
      detail: "Command: train",
    });
  });

  it("uses evaluate command events to activate the report review step", () => {
    const state = deriveWorkflowState(
      [
        {
          type: "agent_command",
          task_id: "evaluate-session",
          command: {
            intent: "evaluate",
            dataset_path: "data/churn.csv",
            target_column: "churn",
            selected_run_id: "exp-eval-intent",
            selected_artifacts: ["results/eval-intent/model_evaluation_report.md"],
            missing_context: [],
            risk_level: "low",
            planned_steps: ["evaluate"],
            proposed_tools: ["model_comparison", "evaluation_report"],
            component_requests: ["model_comparison", "evaluation_report"],
          },
          resolved_context: {
            experiment_id: "exp-eval-intent",
            evaluation_report_path: "results/eval-intent/model_evaluation_report.md",
          },
        },
      ],
      "machine-learning",
      "results/eval-intent/model_evaluation_report.md",
    );

    expect(state.currentStage).toMatchObject({
      id: "evaluate",
      status: "active",
      detail: "Command: evaluate",
    });
  });

  it("blocks command stages when required context is missing", () => {
    const state = deriveWorkflowState(
      [
        {
          type: "agent_command",
          task_id: "evaluate-ambiguous-session",
          command: {
            intent: "evaluate",
            selected_run_id: null,
            selected_artifacts: [],
            missing_context: ["experiment_id"],
            risk_level: "medium",
            planned_steps: ["evaluate"],
            proposed_tools: ["model_comparison", "evaluation_report"],
            approval_required: true,
            component_requests: ["model_comparison", "evaluation_report"],
            candidate_runs: [{ experiment_id: "candidate-a" }, { experiment_id: "candidate-b" }],
          },
          resolved_context: {
            candidate_runs: [{ experiment_id: "candidate-a" }, { experiment_id: "candidate-b" }],
          },
        },
      ],
      "machine-learning",
      "README.md",
    );

    expect(state.currentStage).toMatchObject({
      id: "evaluate",
      status: "blocked",
      detail: "Missing context: experiment_id",
    });
  });

  it("uses active-file context to keep selected-report evaluation unambiguous", () => {
    const state = deriveWorkflowState(
      [
        {
          type: "agent_command",
          task_id: "evaluate-report-session",
          command: {
            intent: "evaluate",
            dataset_path: "data/churn.csv",
            target_column: "churn",
            selected_run_id: "exp-from-report",
            selected_artifacts: ["results/report/model_evaluation_report.md"],
            missing_context: [],
            risk_level: "low",
            planned_steps: ["evaluate"],
            proposed_tools: ["model_comparison", "evaluation_report"],
            component_requests: ["model_comparison", "evaluation_report"],
          },
        },
      ],
      "machine-learning",
      "results/report/model_evaluation_report.md",
    );

    expect(state.currentStage).toMatchObject({
      id: "evaluate",
      status: "active",
      detail: "Command: evaluate",
    });
  });

  it("uses latest-run commands to keep explicit latest requests active", () => {
    const state = deriveWorkflowState(
      [
        {
          type: "agent_command",
          task_id: "evaluate-latest-session",
          command: {
            intent: "evaluate",
            dataset_path: "data/latest.csv",
            target_column: "target",
            selected_run_id: "latest-run",
            selected_artifacts: ["results/latest/metrics.json"],
            missing_context: [],
            risk_level: "low",
            planned_steps: ["evaluate"],
            proposed_tools: ["model_comparison", "evaluation_report"],
            component_requests: ["model_comparison", "evaluation_report"],
          },
        },
      ],
      "machine-learning",
      "data/latest.csv",
    );

    expect(state.currentStage).toMatchObject({
      id: "evaluate",
      status: "active",
      detail: "Command: evaluate",
    });
  });

  it("uses diagnose command events to activate the error analysis step", () => {
    const state = deriveWorkflowState(
      [
        {
          type: "agent_command",
          task_id: "diagnose-session",
          command: {
            intent: "diagnose",
            dataset_path: "data/churn.csv",
            target_column: "churn",
            selected_run_id: "exp-diagnose-intent",
            selected_artifacts: [
              "results/diagnose-intent/metrics.json",
              "models/exp-diagnose-intent.json",
              "results/diagnose-intent/prediction_samples.json",
            ],
            missing_context: [],
            risk_level: "low",
            planned_steps: ["diagnose"],
            proposed_tools: ["error_analysis", "prediction_samples"],
            component_requests: ["error_analysis", "prediction_samples"],
            diagnosis_summary: {
              worst_class: "yes",
              main_confusion: "yes -> no",
              error_count: 5,
            },
          },
          resolved_context: {
            experiment_id: "exp-diagnose-intent",
            prediction_samples_path: "results/diagnose-intent/prediction_samples.json",
          },
        },
      ],
      "machine-learning",
      "results/diagnose-intent/model_evaluation_report.md",
    );

    expect(state.currentStage).toMatchObject({
      id: "diagnose",
      status: "active",
      detail: "Command: diagnose",
    });
  });

  it("uses export command events to activate the reproducible handoff step", () => {
    const state = deriveWorkflowState(
      [
        {
          type: "agent_command",
          task_id: "export-session",
          command: {
            intent: "export",
            dataset_path: "data/churn.csv",
            target_column: "churn",
            selected_run_id: "exp-export-intent",
            selected_artifacts: [
              "results/export-intent/model_evaluation_report.md",
              "exports/export-intent/exp-export-intent_handoff_bundle.zip",
            ],
            missing_context: [],
            risk_level: "medium",
            planned_steps: ["export"],
            proposed_tools: ["evaluation_report", "export_bundle"],
            component_requests: ["evaluation_report", "export_bundle"],
            bundle_ready: true,
            missing_required_artifacts: [],
          },
          resolved_context: {
            experiment_id: "exp-export-intent",
            export_bundle_path: "exports/export-intent/exp-export-intent_handoff_bundle.zip",
          },
        },
      ],
      "machine-learning",
      "results/export-intent/model_evaluation_report.md",
    );

    expect(state.currentStage).toMatchObject({
      id: "export",
      status: "active",
      detail: "Command: export",
    });
  });

  it("uses learn command events to activate the rule review step", () => {
    const state = deriveWorkflowState(
      [
        {
          type: "agent_command",
          task_id: "learn-session",
          command: {
            intent: "learn",
            selected_artifacts: ["results/learn-intent/missing.json"],
            missing_context: [],
            risk_level: "high",
            planned_steps: ["learn"],
            proposed_tools: ["lesson_review"],
            approval_required: true,
            component_requests: ["lesson_review"],
            source_session_id: "learn-session",
            source_event_count: 1,
            candidate_count: 1,
            high_confidence_count: 0,
            has_extractable_candidates: true,
          },
          resolved_context: {
            source_session_id: "learn-session",
            source_artifacts: ["results/learn-intent/missing.json"],
          },
        },
      ],
      "machine-learning",
      "results/learn-intent/missing.json",
    );

    expect(state.currentStage).toMatchObject({
      id: "learn",
      status: "active",
      detail: "Command: learn",
    });
  });
});
