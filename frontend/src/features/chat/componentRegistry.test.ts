import { describe, expect, it } from "vitest";

import { buildCockpitComponentCards } from "./componentRegistry";
import type { AgentStreamEvent, Artifact } from "./types";
import { deriveWorkflowState } from "./workflowState";

function artifact(partial: Partial<Artifact> & Pick<Artifact, "name" | "path">): Artifact {
  return {
    id: partial.id ?? partial.path,
    project_id: "project-1",
    session_id: "session-1",
    type: partial.type ?? "dataframe",
    name: partial.name,
    path: partial.path,
    metadata: partial.metadata ?? {},
    created_at: "2026-05-28T00:00:00Z",
  };
}

function cards(events: AgentStreamEvent[], activeFile = "data/churn.csv") {
  return buildCockpitComponentCards({
    activeFile,
    events,
    mode: "analysis",
    projectId: "project-1",
    suggestedTargetColumn: "churn",
    trainingDatasetPath: activeFile,
    workflow: deriveWorkflowState(events, "analysis", activeFile),
  });
}

describe("cockpit component registry", () => {
  it("uses orchestrator ingest props for a dataset summary card", () => {
    const events: AgentStreamEvent[] = [
      {
        type: "component_requested",
        task_id: "session-1",
        stage: "ingest",
        component: "dataset_summary",
        title: "Registered active dataset",
        artifact_path: "results/session-1/dataset_registry_entry.json",
        props: {
          dataset_path: "data/customer_churn.csv",
          registry_path: "results/session-1/dataset_registry_entry.json",
          dataset_version_id: "csv-customer_churn-session-1",
          row_count: 3,
          column_count: 4,
          columns: ["customer_id", "age", "monthly_charges", "churn"],
          sample_strategy: "full_csv_scan",
        },
      },
    ];
    const result = buildCockpitComponentCards({
      activeFile: "data/customer_churn.csv",
      events,
      mode: "analysis",
      projectId: "project-1",
      trainingDatasetPath: "data/customer_churn.csv",
      workflow: deriveWorkflowState(events, "analysis", "data/customer_churn.csv"),
    });

    const summaryCard = result.find((card) => card.id === "dataset-summary");

    expect(summaryCard).toMatchObject({
      kind: "dataset_summary",
      stage: "ingest",
      title: "Dataset registered",
      status: "ready",
      artifactPath: "results/session-1/dataset_registry_entry.json",
      facts: expect.arrayContaining([
        { label: "Dataset", value: "data/customer_churn.csv" },
        { label: "Version", value: "csv-customer_churn-session-1" },
        { label: "Shape", value: "3 rows x 4 columns" },
        { label: "Sample", value: "full_csv_scan" },
        { label: "Columns", value: "customer_id, age, monthly_charges, churn" },
      ]),
    });
    expect(summaryCard?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "open_artifact",
          label: "Open Registry",
          payload: { path: "results/session-1/dataset_registry_entry.json" },
        }),
        expect.objectContaining({
          id: "generate_profile",
          label: "Generate Profile",
        }),
      ]),
    );
  });

  it("shows a data quality card with profile and plan actions before artifacts exist", () => {
    const result = cards([]);
    const dataQualityCard = result.find((card) => card.id === "data-quality");

    expect(dataQualityCard).toMatchObject({
      id: "data-quality",
      kind: "data_quality",
      status: "ready",
    });
    expect(dataQualityCard?.actions.map((action) => action.id)).toEqual([
      "generate_profile",
      "generate_preprocessing_plan",
    ]);
  });

  it("turns a preprocessing plan artifact into open and execute actions", () => {
    const result = cards([
      {
        type: "artifact_created",
        artifact: artifact({
          name: "preprocessing_plan.json",
          path: "results/session-1/preprocessing_plan.json",
        }),
      },
    ]);

    const planCard = result.find((card) => card.id === "preprocessing-plan");

    expect(planCard).toMatchObject({
      kind: "preprocessing_plan",
      status: "blocked",
      artifactPath: "results/session-1/preprocessing_plan.json",
    });
    expect(planCard?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "open_artifact", payload: { path: "results/session-1/preprocessing_plan.json" } }),
        expect.objectContaining({
          id: "approve_preprocessing_plan",
          label: "Approve & Execute",
          payload: expect.objectContaining({
            preprocessingPlanPath: "results/session-1/preprocessing_plan.json",
          }),
        }),
      ]),
    );
  });

  it("uses the approval id when an orchestrator approval is pending", () => {
    const result = cards([
      {
        type: "approval_required",
        task_id: "session-1",
        approval_id: "session-1-preprocessing-plan",
        stage: "transform",
        title: "Approve preprocessing transform",
        artifact_path: "results/session-1/preprocessing_plan.json",
      },
    ]);

    const planCard = result.find((card) => card.id === "preprocessing-plan");

    expect(planCard?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "approve_preprocessing_plan",
          payload: {
            approvalId: "session-1-preprocessing-plan",
            preprocessingPlanPath: "results/session-1/preprocessing_plan.json",
          },
        }),
        expect.objectContaining({
          id: "revise_preprocessing_plan",
          label: "Revise Plan",
          payload: {
            approvalId: "session-1-preprocessing-plan",
            preprocessingPlanPath: "results/session-1/preprocessing_plan.json",
          },
        }),
      ]),
    );
  });

  it("shows planned dataset and training cards after execution", () => {
    const result = cards(
      [
        {
          type: "artifact_created",
          artifact: artifact({
            name: "preprocessing_plan.json",
            path: "results/session-1/preprocessing_plan.json",
          }),
        },
        {
          type: "artifact_created",
          artifact: artifact({
            name: "churn_planned.csv",
            path: "results/session-1/churn_planned.csv",
          }),
        },
        {
          type: "artifact_created",
          artifact: artifact({
            name: "preprocessing_transform_report.md",
            path: "results/session-1/preprocessing_transform_report.md",
            metadata: {
              artifact_role: "preprocessing_transform_report",
              preprocessing_plan_path: "results/session-1/preprocessing_plan.json",
            },
          }),
        },
      ],
      "results/session-1/churn_planned.csv",
    );

    expect(result.find((card) => card.id === "planned-dataset")).toMatchObject({
      kind: "planned_dataset",
      status: "ready",
      artifactPath: "results/session-1/churn_planned.csv",
    });
    expect(result.find((card) => card.id === "training-config")?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "start_sklearn_training",
          payload: expect.objectContaining({
            path: "results/session-1/churn_planned.csv",
            preprocessingPlanPath: "results/session-1/preprocessing_plan.json",
            targetColumn: "churn",
          }),
        }),
      ]),
    );
  });

  it("asks the user to refresh the plan after a revision instead of executing a stale plan", () => {
    const result = cards([
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
    ]);

    const planCard = result.find((card) => card.id === "preprocessing-plan");

    expect(planCard).toMatchObject({
      title: "Preprocessing plan needs revision",
      status: "attention",
    });
    expect(planCard?.actions.map((action) => action.id)).toEqual(["open_artifact", "generate_preprocessing_plan"]);
  });

  it("offers a retry action after a retryable transform execution failure", () => {
    const result = cards([
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
    ]);

    const planCard = result.find((card) => card.id === "preprocessing-plan");

    expect(planCard).toMatchObject({
      title: "Transform execution failed",
      status: "attention",
    });
    expect(planCard?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "open_artifact" }),
        expect.objectContaining({
          id: "retry_transform",
          label: "Retry Transform",
          payload: expect.objectContaining({
            preprocessingPlanPath: "results/session-1/preprocessing_plan.json",
            stage: "transform",
          }),
        }),
        expect.objectContaining({ id: "generate_preprocessing_plan", label: "Refresh Plan" }),
      ]),
    );
    expect(planCard?.actions.map((action) => action.id)).not.toContain("approve_preprocessing_plan");
  });

  it("offers a retry training action after a retryable sklearn training failure", () => {
    const result = cards(
      [
        {
          type: "artifact_created",
          artifact: artifact({
            name: "customer_churn_planned.csv",
            path: "results/session-1/customer_churn_planned.csv",
          }),
        },
        {
          type: "step_failed",
          task_id: "manual-training",
          stage: "train",
          label: "sklearn training failed",
          error: "Target column was not found",
          retryable: true,
          resume_stage: "train",
        },
      ],
      "results/session-1/customer_churn_planned.csv",
    );

    const trainingCard = result.find((card) => card.id === "training-config");

    expect(trainingCard).toMatchObject({
      title: "Training execution failed",
      status: "attention",
    });
    expect(trainingCard?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "open_training" }),
        expect.objectContaining({
          id: "retry_sklearn_training",
          label: "Retry Training",
          payload: { stage: "train" },
        }),
      ]),
    );
    expect(trainingCard?.actions.map((action) => action.id)).not.toContain("start_sklearn_training");
  });

  it("adds a failed-stage inspector card from durable task state", () => {
    const result = buildCockpitComponentCards({
      activeFile: "data/train_retry.csv",
      events: [
        {
          type: "step_failed",
          task_id: "session-1",
          stage: "train",
          label: "sklearn training failed",
          error: "Target column was not found",
          retryable: true,
          resume_stage: "train",
        },
      ],
      mode: "machine-learning",
      projectId: "project-1",
      suggestedTargetColumn: "churn",
      taskStateInspection: {
        stage: "train",
        title: "Train failure inspector",
        description: "Review saved retry state before rerunning this stage.",
        taskId: "session-1",
        datasetPath: "data/train_retry.csv",
        planPath: "results/session-1/preprocessing_plan.json",
        facts: [
          { label: "Dataset", value: "data/train_retry.csv" },
          { label: "Retries", value: "1" },
          { label: "Last error", value: "Target column was not found" },
        ],
      },
      trainingDatasetPath: "data/train_retry.csv",
      workflow: deriveWorkflowState(
        [
          {
            type: "step_failed",
            task_id: "session-1",
            stage: "train",
            label: "sklearn training failed",
            error: "Target column was not found",
            retryable: true,
            resume_stage: "train",
          },
        ],
        "machine-learning",
        "data/train_retry.csv",
      ),
    });

    const inspector = result.find((card) => card.id === "task-state-inspector");

    expect(inspector).toMatchObject({
      kind: "task_state_inspector",
      title: "Train failure inspector",
      status: "attention",
      artifactPath: "results/session-1/preprocessing_plan.json",
    });
    expect(inspector?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "inspect_logs", label: "Inspect Logs", payload: { taskId: "session-1" } }),
        expect.objectContaining({
          id: "open_artifact",
          label: "Open Plan",
          payload: { path: "results/session-1/preprocessing_plan.json" },
        }),
        expect.objectContaining({
          id: "abandon_task_state",
          label: "Abandon State",
          payload: { taskId: "session-1", stage: "train" },
        }),
      ]),
    );
  });

  it("keeps the task-state inspector card when the orchestrator requests continuation from failure", () => {
    const result = buildCockpitComponentCards({
      activeFile: "results/model_evaluation_report.md",
      events: [
        {
          type: "component_requested",
          task_id: "session-1",
          stage: "train",
          component: "task_state_inspector",
          title: "Continue from saved train failure",
        },
      ],
      mode: "machine-learning",
      projectId: "project-1",
      taskStateInspection: {
        stage: "train",
        title: "Train failure inspector",
        description: "Review saved retry state before rerunning this stage.",
        taskId: "session-1",
        datasetPath: "data/train_retry.csv",
        facts: [
          { label: "Resume", value: "Retry the saved sklearn training request from durable task state." },
          { label: "Repair", value: "Check the target column before retrying." },
        ],
      },
      workflow: deriveWorkflowState(
        [
          {
            type: "component_requested",
            task_id: "session-1",
            stage: "train",
            component: "task_state_inspector",
            title: "Continue from saved train failure",
          },
        ],
        "machine-learning",
        "results/model_evaluation_report.md",
      ),
    });

    const inspector = result.find((card) => card.id === "task-state-inspector");

    expect(inspector).toMatchObject({
      kind: "task_state_inspector",
      stage: "train",
      title: "Train failure inspector",
      status: "attention",
    });
    expect(inspector?.facts).toEqual(
      expect.arrayContaining([
        { label: "Resume", value: "Retry the saved sklearn training request from durable task state." },
        { label: "Repair", value: "Check the target column before retrying." },
      ]),
    );
  });

  it("uses orchestrator training-config props for dataset, target, plan, and start action", () => {
    const result = buildCockpitComponentCards({
      activeFile: "results/session-1/model_evaluation_report.md",
      events: [
        {
          type: "component_requested",
          task_id: "session-1",
          stage: "train",
          component: "training_config",
          title: "Configure sklearn training",
          artifact_path: "data/customer_churn.csv",
          props: {
            dataset_path: "data/customer_churn.csv",
            target_column: "churn",
            preprocessing_plan_path: "results/session-1/preprocessing_plan.json",
            engine: "sklearn",
          },
        },
      ],
      mode: "machine-learning",
      projectId: "project-1",
      trainingDatasetPath: "data/stale.csv",
      workflow: deriveWorkflowState(
        [
          {
            type: "component_requested",
            task_id: "session-1",
            stage: "train",
            component: "training_config",
            title: "Configure sklearn training",
            artifact_path: "data/customer_churn.csv",
            props: {
              dataset_path: "data/customer_churn.csv",
              target_column: "churn",
              preprocessing_plan_path: "results/session-1/preprocessing_plan.json",
            },
          },
        ],
        "machine-learning",
        "results/session-1/model_evaluation_report.md",
      ),
    });

    const trainingCard = result.find((card) => card.id === "training-config");

    expect(trainingCard).toMatchObject({
      kind: "training_config",
      stage: "train",
      status: "ready",
      artifactPath: "data/customer_churn.csv",
      facts: expect.arrayContaining([
        { label: "Dataset", value: "data/customer_churn.csv" },
        { label: "Target", value: "churn" },
        { label: "Plan", value: "results/session-1/preprocessing_plan.json" },
      ]),
    });
    expect(trainingCard?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "start_sklearn_training",
          payload: {
            path: "data/customer_churn.csv",
            datasetPath: "data/customer_churn.csv",
            preprocessingPlanPath: "results/session-1/preprocessing_plan.json",
            targetColumn: "churn",
          },
        }),
      ]),
    );
  });

  it("uses orchestrator evaluation props for model comparison and report cards", () => {
    const events: AgentStreamEvent[] = [
      {
        type: "component_requested",
        task_id: "session-1",
        stage: "evaluate",
        component: "model_comparison",
        title: "Review model comparison",
        artifact_path: "results/session-1/metrics.json",
        props: {
          experiment_id: "exp-evaluate",
          dataset_path: "data/customer_churn.csv",
          target_column: "churn",
          best_model_name: "logistic_regression",
          metrics_path: "results/session-1/metrics.json",
          model_path: "models/exp-evaluate.json",
          evaluation_report_path: "results/session-1/model_evaluation_report.md",
          prediction_samples_path: "results/session-1/prediction_samples.json",
        },
      },
      {
        type: "component_requested",
        task_id: "session-1",
        stage: "evaluate",
        component: "evaluation_report",
        title: "Review evaluation report",
        artifact_path: "results/session-1/model_evaluation_report.md",
        props: {
          experiment_id: "exp-evaluate",
          dataset_path: "data/customer_churn.csv",
          target_column: "churn",
          best_model_name: "logistic_regression",
          metrics_path: "results/session-1/metrics.json",
          model_path: "models/exp-evaluate.json",
          evaluation_report_path: "results/session-1/model_evaluation_report.md",
          prediction_samples_path: "results/session-1/prediction_samples.json",
        },
      },
    ];
    const result = buildCockpitComponentCards({
      activeFile: "results/session-1/model_evaluation_report.md",
      events,
      mode: "machine-learning",
      projectId: "project-1",
      trainingDatasetPath: "data/stale.csv",
      workflow: deriveWorkflowState(events, "machine-learning", "results/session-1/model_evaluation_report.md"),
    });

    const comparisonCard = result.find((card) => card.id === "model-comparison");
    const reportCard = result.find((card) => card.id === "evaluation-report");

    expect(comparisonCard).toMatchObject({
      kind: "model_comparison",
      stage: "evaluate",
      status: "ready",
      artifactPath: "results/session-1/metrics.json",
      facts: expect.arrayContaining([
        { label: "Experiment", value: "exp-evaluate" },
        { label: "Dataset", value: "data/customer_churn.csv" },
        { label: "Target", value: "churn" },
        { label: "Best model", value: "logistic_regression" },
      ]),
    });
    expect(comparisonCard?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "open_artifact",
          label: "Open Metrics",
          payload: { path: "results/session-1/metrics.json" },
        }),
      ]),
    );
    expect(reportCard).toMatchObject({
      kind: "evaluation_report",
      title: "Evaluation report ready",
      artifactPath: "results/session-1/model_evaluation_report.md",
      facts: expect.arrayContaining([
        { label: "Report", value: "results/session-1/model_evaluation_report.md" },
        { label: "Metrics", value: "results/session-1/metrics.json" },
        { label: "Model", value: "models/exp-evaluate.json" },
        { label: "Samples", value: "results/session-1/prediction_samples.json" },
      ]),
    });
    expect(reportCard?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "open_artifact",
          label: "Open Report",
          payload: { path: "results/session-1/model_evaluation_report.md" },
        }),
        expect.objectContaining({
          id: "regenerate_evaluation_report",
          label: "Regenerate Report",
          payload: { experimentId: "exp-evaluate" },
        }),
      ]),
    );
  });

  it("turns ambiguous run commands into selectable blocked cards", () => {
    const events: AgentStreamEvent[] = [
      {
        type: "agent_command",
        task_id: "session-1",
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
          candidate_runs: [
            {
              experiment_id: "candidate-b",
              dataset_path: "data/b.csv",
              target_column: "target",
              best_model_name: "sklearn",
            },
            {
              experiment_id: "candidate-a",
              dataset_path: "data/a.csv",
              target_column: "churn",
              best_model_name: "baseline",
            },
          ],
        },
        resolved_context: {
          project_id: "project-1",
          mode: "machine-learning",
          active_file: "README.md",
        },
      },
    ];
    const result = buildCockpitComponentCards({
      activeFile: "README.md",
      events,
      mode: "machine-learning",
      projectId: "project-1",
      trainingDatasetPath: "data/stale.csv",
      workflow: deriveWorkflowState(events, "machine-learning", "README.md"),
    });

    const selectionCard = result.find((card) => card.id === "experiment-run-selection");

    expect(selectionCard).toMatchObject({
      kind: "experiment_run_selection",
      stage: "evaluate",
      title: "Select experiment run",
      status: "blocked",
      facts: expect.arrayContaining([
        { label: "Missing", value: "experiment_id" },
        { label: "Intent", value: "evaluate" },
        { label: "Candidates", value: "2" },
        { label: "Run 1", value: "candidate-b | data/b.csv | target target | sklearn" },
      ]),
    });
    expect(selectionCard?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "select_experiment_run",
          label: "Use candidate-b",
          payload: {
            experimentId: "candidate-b",
            intent: "evaluate",
            stage: "evaluate",
          },
        }),
      ]),
    );
    expect(result.find((card) => card.id === "model-comparison")).toBeUndefined();
    expect(result.find((card) => card.id === "evaluation-report")).toBeUndefined();
  });

  it("turns ambiguous train dataset commands into selectable blocked cards", () => {
    const events: AgentStreamEvent[] = [
      {
        type: "agent_command",
        task_id: "session-1",
        command: {
          intent: "train",
          dataset_path: null,
          target_column: null,
          selected_artifacts: [],
          missing_context: ["dataset_path"],
          risk_level: "medium",
          planned_steps: ["train"],
          proposed_tools: ["train_sklearn"],
          approval_required: true,
          component_requests: ["training_config"],
          candidate_datasets: [
            {
              dataset_path: "data/customer_churn.csv",
              dataset_version_id: "csv-customer_churn",
              row_count: "3",
              column_count: "3",
              target_candidates: "churn, age, monthly_charges",
            },
            {
              dataset_path: "data/fraud.csv",
              dataset_version_id: "csv-fraud",
              row_count: "2",
              column_count: "3",
              target_candidates: "label, amount, risk",
            },
          ],
        },
        resolved_context: {
          project_id: "project-1",
          mode: "machine-learning",
          active_file: "README.md",
        },
      },
    ];
    const result = buildCockpitComponentCards({
      activeFile: "README.md",
      events,
      mode: "machine-learning",
      projectId: "project-1",
      workflow: deriveWorkflowState(events, "machine-learning", "README.md"),
    });

    const selectionCard = result.find((card) => card.id === "dataset-selection");

    expect(selectionCard).toMatchObject({
      kind: "dataset_selection",
      stage: "train",
      title: "Select training dataset",
      status: "blocked",
      facts: expect.arrayContaining([
        { label: "Missing", value: "dataset_path" },
        { label: "Intent", value: "train" },
        { label: "Candidates", value: "2" },
        {
          label: "Dataset 1",
          value: "data/customer_churn.csv | csv-customer_churn | 3 rows x 3 columns | targets churn, age, monthly_charges",
        },
      ]),
    });
    expect(selectionCard?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "select_training_dataset",
          label: "Use data/customer_churn.csv",
          payload: {
            datasetPath: "data/customer_churn.csv",
            datasetVersionId: "csv-customer_churn",
            targetColumn: "churn",
            intent: "train",
            stage: "train",
          },
        }),
      ]),
    );
    expect(result.find((card) => card.id === "training-config")).toBeUndefined();
  });

  it("uses orchestrator diagnosis props for error analysis and prediction sample cards", () => {
    const events: AgentStreamEvent[] = [
      {
        type: "component_requested",
        task_id: "session-1",
        stage: "diagnose",
        component: "error_analysis",
        title: "Review error slices",
        artifact_path: "results/session-1/metrics.json",
        props: {
          experiment_id: "exp-diagnose",
          dataset_path: "data/customer_churn.csv",
          target_column: "churn",
          metrics_path: "results/session-1/metrics.json",
          evaluation_report_path: "results/session-1/model_evaluation_report.md",
          prediction_samples_path: "results/session-1/prediction_samples.json",
          worst_class: "yes",
          main_confusion: "yes -> no",
          error_count: 5,
          recommendation: "Inspect yes prediction samples, then review features or preprocessing for this class.",
          error_slices: [
            {
              label: "yes",
              support: 7,
              correct: 3,
              errors: 4,
              error_rate: 4 / 7,
              primary_confusion: { label: "no", count: 4, rate: 4 / 7 },
            },
          ],
        },
      },
      {
        type: "component_requested",
        task_id: "session-1",
        stage: "diagnose",
        component: "prediction_samples",
        title: "Inspect prediction samples",
        artifact_path: "results/session-1/prediction_samples.json",
        props: {
          experiment_id: "exp-diagnose",
          dataset_path: "data/customer_churn.csv",
          target_column: "churn",
          metrics_path: "results/session-1/metrics.json",
          evaluation_report_path: "results/session-1/model_evaluation_report.md",
          prediction_samples_path: "results/session-1/prediction_samples.json",
          worst_class: "yes",
          main_confusion: "yes -> no",
          error_count: 5,
          recommendation: "Inspect yes prediction samples, then review features or preprocessing for this class.",
          error_slices: [
            {
              label: "yes",
              support: 7,
              correct: 3,
              errors: 4,
              error_rate: 4 / 7,
              primary_confusion: { label: "no", count: 4, rate: 4 / 7 },
            },
          ],
        },
      },
    ];
    const result = buildCockpitComponentCards({
      activeFile: "results/session-1/model_evaluation_report.md",
      events,
      mode: "machine-learning",
      projectId: "project-1",
      trainingDatasetPath: "data/customer_churn.csv",
      workflow: deriveWorkflowState(events, "machine-learning", "results/session-1/model_evaluation_report.md"),
    });

    const errorCard = result.find((card) => card.id === "error-analysis");
    const samplesCard = result.find((card) => card.id === "prediction-samples");

    expect(errorCard).toMatchObject({
      kind: "error_analysis",
      stage: "diagnose",
      status: "ready",
      artifactPath: "results/session-1/metrics.json",
      facts: expect.arrayContaining([
        { label: "Experiment", value: "exp-diagnose" },
        { label: "Dataset", value: "data/customer_churn.csv" },
        { label: "Worst class", value: "yes" },
        { label: "Main confusion", value: "yes -> no" },
        { label: "Error rows", value: "5" },
        { label: "Slices", value: "1" },
      ]),
    });
    expect(errorCard?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "open_artifact",
          label: "Open Metrics",
          payload: { path: "results/session-1/metrics.json" },
        }),
        expect.objectContaining({
          id: "open_artifact",
          label: "Open Report",
          payload: { path: "results/session-1/model_evaluation_report.md" },
        }),
      ]),
    );
    expect(samplesCard).toMatchObject({
      kind: "prediction_samples",
      title: "Prediction samples",
      artifactPath: "results/session-1/prediction_samples.json",
      description: "Inspect yes prediction samples, then review features or preprocessing for this class.",
      facts: expect.arrayContaining([
        { label: "Samples", value: "results/session-1/prediction_samples.json" },
        { label: "Target", value: "churn" },
        { label: "Worst class", value: "yes" },
      ]),
    });
    expect(samplesCard?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "open_artifact",
          label: "Open Samples",
          payload: { path: "results/session-1/prediction_samples.json" },
        }),
        expect.objectContaining({ id: "open_training", label: "Open Diagnostics" }),
      ]),
    );
  });

  it("uses orchestrator export props for handoff bundle cards", () => {
    const events: AgentStreamEvent[] = [
      {
        type: "component_requested",
        task_id: "session-1",
        stage: "export",
        component: "export_bundle",
        title: "Prepare handoff bundle",
        artifact_path: "exports/export-intent/exp-export_handoff_bundle.zip",
        props: {
          experiment_id: "exp-export",
          dataset_path: "data/customer_churn.csv",
          target_column: "churn",
          metrics_path: "results/export-intent/metrics.json",
          model_path: "models/exp-export.json",
          evaluation_report_path: "results/export-intent/model_evaluation_report.md",
          prediction_samples_path: "results/export-intent/prediction_samples.json",
          preprocessing_plan_path: "results/export-intent/preprocessing_plan.json",
          export_bundle_path: "exports/export-intent/exp-export_handoff_bundle.zip",
          bundle_ready: true,
          missing_required_artifacts: [],
        },
      },
    ];
    const result = buildCockpitComponentCards({
      activeFile: "results/export-intent/model_evaluation_report.md",
      events,
      mode: "machine-learning",
      projectId: "project-1",
      suggestedTargetColumn: "churn",
      trainingDatasetPath: "data/customer_churn.csv",
      workflow: deriveWorkflowState(events, "machine-learning", "results/export-intent/model_evaluation_report.md"),
    });

    const exportCard = result.find((card) => card.id === "export-bundle");
    const checklistCard = result.find((card) => card.id === "export-artifacts");

    expect(exportCard).toMatchObject({
      kind: "export_bundle",
      title: "Export bundle ready",
      status: "ready",
      artifactPath: "exports/export-intent/exp-export_handoff_bundle.zip",
    });
    expect(exportCard?.facts).toEqual(
      expect.arrayContaining([
        { label: "Experiment", value: "exp-export" },
        { label: "Bundle", value: "exports/export-intent/exp-export_handoff_bundle.zip" },
        { label: "Missing", value: "None" },
      ]),
    );
    expect(exportCard?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "open_artifact",
          label: "Open Bundle",
          payload: { path: "exports/export-intent/exp-export_handoff_bundle.zip" },
        }),
        expect.objectContaining({
          id: "export_run_bundle",
          label: "Re-export Bundle",
          payload: { experimentId: "exp-export" },
        }),
      ]),
    );
    expect(checklistCard?.facts).toEqual(
      expect.arrayContaining([
        { label: "Metrics", value: "results/export-intent/metrics.json" },
        { label: "Model", value: "models/exp-export.json" },
        { label: "Samples", value: "results/export-intent/prediction_samples.json" },
        { label: "Plan", value: "results/export-intent/preprocessing_plan.json" },
      ]),
    );
  });

  it("uses orchestrator learning props for lesson review cards", () => {
    const events: AgentStreamEvent[] = [
      {
        type: "component_requested",
        task_id: "session-1",
        stage: "learn",
        component: "lesson_review",
        title: "Review learned-rule candidates",
        artifact_path: "results/learn-intent/missing.json",
        props: {
          source_session_id: "session-1",
          source_event_count: 8,
          candidate_count: 2,
          high_confidence_count: 1,
          latest_event_type: "artifact_created",
          source_artifacts: ["results/learn-intent/missing.json"],
          has_extractable_candidates: true,
        },
      },
    ];
    const result = buildCockpitComponentCards({
      activeFile: "results/learn-intent/missing.json",
      events,
      mode: "machine-learning",
      projectId: "project-1",
      workflow: deriveWorkflowState(events, "machine-learning", "results/learn-intent/missing.json"),
    });

    const lessonCard = result.find((card) => card.id === "lesson-review");

    expect(lessonCard).toMatchObject({
      kind: "lesson_review",
      title: "Learned-rule review",
      status: "ready",
      artifactPath: "results/learn-intent/missing.json",
    });
    expect(lessonCard?.facts).toEqual(
      expect.arrayContaining([
        { label: "Source session", value: "session-1" },
        { label: "Events", value: "8" },
        { label: "Candidates", value: "2" },
        { label: "High confidence", value: "1" },
      ]),
    );
    expect(lessonCard?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "extract_lessons",
          label: "Extract Lessons",
          payload: { sourceSessionId: "session-1" },
        }),
        expect.objectContaining({
          id: "open_artifact",
          label: "Open Evidence",
          payload: { path: "results/learn-intent/missing.json" },
        }),
      ]),
    );
  });

  it("uses orchestrator iterate props for an iteration proposal card", () => {
    const events: AgentStreamEvent[] = [
      {
        type: "component_requested",
        task_id: "session-1",
        stage: "iterate",
        component: "iteration_proposal",
        title: "Review follow-up experiment proposal",
        artifact_path: "results/iterate-intent/metrics.json",
        props: {
          experiment_id: "exp-iterate",
          dataset_path: "data/customer_churn.csv",
          target_column: "churn",
          metrics_path: "results/iterate-intent/metrics.json",
          evaluation_report_path: "results/iterate-intent/model_evaluation_report.md",
          prediction_samples_path: "results/iterate-intent/prediction_samples.json",
          worst_class: "yes",
          main_confusion: "yes -> no",
          recommendation: "Inspect yes prediction samples, then review features or preprocessing for this class.",
          next_actions: [
            "Inspect prediction samples for the highest-error class.",
            "Revise preprocessing or feature selection before rerunning training.",
            "Start a follow-up sklearn run only after reviewing the proposed changes.",
          ],
        },
      },
    ];
    const result = buildCockpitComponentCards({
      activeFile: "results/iterate-intent/model_evaluation_report.md",
      events,
      mode: "machine-learning",
      projectId: "project-1",
      workflow: deriveWorkflowState(events, "machine-learning", "results/iterate-intent/model_evaluation_report.md"),
    });

    const iterationCard = result.find((card) => card.id === "iteration-proposal");

    expect(iterationCard).toMatchObject({
      kind: "iteration_proposal",
      title: "Iteration proposal",
      status: "attention",
      artifactPath: "results/iterate-intent/metrics.json",
    });
    expect(iterationCard?.facts).toEqual(
      expect.arrayContaining([
        { label: "Experiment", value: "exp-iterate" },
        { label: "Dataset", value: "data/customer_churn.csv" },
        { label: "Worst class", value: "yes" },
        { label: "Main confusion", value: "yes -> no" },
        { label: "Next action", value: "Inspect prediction samples for the highest-error class." },
      ]),
    );
    expect(iterationCard?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "open_artifact",
          label: "Open Metrics",
          payload: { path: "results/iterate-intent/metrics.json" },
        }),
        expect.objectContaining({
          id: "open_artifact",
          label: "Open Report",
          payload: { path: "results/iterate-intent/model_evaluation_report.md" },
        }),
        expect.objectContaining({ id: "open_training", label: "Open Training" }),
      ]),
    );
    expect(result.some((card) => card.id === "requested-iteration_proposal")).toBe(false);
  });

  it("adds retry evaluation to an evaluate task-state inspector", () => {
    const result = buildCockpitComponentCards({
      activeFile: "data/customer_churn.csv",
      events: [
        {
          type: "step_failed",
          task_id: "eval-session",
          stage: "evaluate",
          label: "evaluation report failed",
          error: "Metrics artifact not found",
          retryable: true,
          resume_stage: "evaluate",
        },
      ],
      mode: "machine-learning",
      projectId: "project-1",
      suggestedTargetColumn: "churn",
      taskStateInspection: {
        stage: "evaluate",
        title: "Evaluate failure inspector",
        description: "Review saved retry state before rerunning this stage.",
        taskId: "eval-session",
        datasetPath: "data/customer_churn.csv",
        planPath: "results/eval-session/missing_metrics.json",
        facts: [
          { label: "Experiment", value: "exp-eval-retry" },
          { label: "Metrics", value: "results/eval-session/missing_metrics.json" },
          { label: "Last error", value: "Metrics artifact not found" },
        ],
      },
      trainingDatasetPath: "data/customer_churn.csv",
      workflow: deriveWorkflowState(
        [
          {
            type: "step_failed",
            task_id: "eval-session",
            stage: "evaluate",
            label: "evaluation report failed",
            error: "Metrics artifact not found",
            retryable: true,
            resume_stage: "evaluate",
          },
        ],
        "machine-learning",
        "data/customer_churn.csv",
      ),
    });

    const inspector = result.find((card) => card.id === "task-state-inspector");

    expect(inspector).toMatchObject({
      kind: "task_state_inspector",
      title: "Evaluate failure inspector",
      status: "attention",
      artifactPath: "results/eval-session/missing_metrics.json",
    });
    expect(inspector?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "retry_evaluation_report",
          label: "Retry Evaluation",
          payload: { stage: "evaluate" },
        }),
        expect.objectContaining({ id: "inspect_logs", payload: { taskId: "eval-session" } }),
        expect.objectContaining({
          id: "open_artifact",
          label: "Open Metrics",
          payload: { path: "results/eval-session/missing_metrics.json" },
        }),
        expect.objectContaining({
          id: "abandon_task_state",
          label: "Abandon State",
          payload: { taskId: "eval-session", stage: "evaluate" },
        }),
      ]),
    );
  });

  it("adds retry export to an export task-state inspector", () => {
    const result = buildCockpitComponentCards({
      activeFile: "data/customer_churn.csv",
      events: [
        {
          type: "step_failed",
          task_id: "export-session",
          stage: "export",
          label: "export bundle failed",
          error: "Evaluation Report Artifact not found",
          retryable: true,
          resume_stage: "export",
        },
      ],
      mode: "machine-learning",
      projectId: "project-1",
      taskStateInspection: {
        stage: "export",
        title: "Export failure inspector",
        description: "Review saved retry state before rerunning this stage.",
        taskId: "export-session",
        datasetPath: "data/customer_churn.csv",
        planPath: "results/export-session/model_evaluation_report.md",
        facts: [
          { label: "Experiment", value: "exp-export" },
          { label: "Report", value: "results/export-session/model_evaluation_report.md" },
          { label: "Last error", value: "Evaluation Report Artifact not found" },
        ],
      },
      trainingDatasetPath: "data/customer_churn.csv",
      workflow: deriveWorkflowState(
        [
          {
            type: "step_failed",
            task_id: "export-session",
            stage: "export",
            label: "export bundle failed",
            error: "Evaluation Report Artifact not found",
            retryable: true,
            resume_stage: "export",
          },
        ],
        "machine-learning",
        "data/customer_churn.csv",
      ),
    });

    const inspector = result.find((card) => card.id === "task-state-inspector");

    expect(inspector?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "retry_export_bundle", label: "Retry Export", payload: { stage: "export" } }),
        expect.objectContaining({
          id: "open_artifact",
          label: "Open Report",
          payload: { path: "results/export-session/model_evaluation_report.md" },
        }),
        expect.objectContaining({
          id: "abandon_task_state",
          label: "Abandon State",
          payload: { taskId: "export-session", stage: "export" },
        }),
      ]),
    );
  });

  it("adds retry learning to a learn task-state inspector", () => {
    const result = buildCockpitComponentCards({
      activeFile: "data/customer_churn.csv",
      events: [
        {
          type: "step_failed",
          task_id: "learn-session",
          stage: "learn",
          label: "lesson extraction failed",
          error: "Session not found for lesson extraction",
          retryable: true,
          resume_stage: "learn",
        },
      ],
      mode: "machine-learning",
      projectId: "project-1",
      taskStateInspection: {
        stage: "learn",
        title: "Learn failure inspector",
        description: "Review saved retry state before rerunning this stage.",
        taskId: "learn-session",
        facts: [
          { label: "Source", value: "learn-session" },
          { label: "Last error", value: "Session not found for lesson extraction" },
        ],
      },
      workflow: deriveWorkflowState(
        [
          {
            type: "step_failed",
            task_id: "learn-session",
            stage: "learn",
            label: "lesson extraction failed",
            error: "Session not found for lesson extraction",
            retryable: true,
            resume_stage: "learn",
          },
        ],
        "machine-learning",
        "data/customer_churn.csv",
      ),
    });

    const inspector = result.find((card) => card.id === "task-state-inspector");

    expect(inspector?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "retry_lesson_extraction", label: "Retry Learning", payload: { stage: "learn" } }),
        expect.objectContaining({ id: "inspect_logs", payload: { taskId: "learn-session" } }),
        expect.objectContaining({
          id: "abandon_task_state",
          label: "Abandon State",
          payload: { taskId: "learn-session", stage: "learn" },
        }),
      ]),
    );
  });

  it("keeps actions disabled when no project or dataset is available", () => {
    const result = buildCockpitComponentCards({
      activeFile: "",
      events: [],
      mode: "analysis",
      workflow: deriveWorkflowState([], "analysis", ""),
    });

    const generateProfile = result[0].actions.find((action) => action.id === "generate_profile");
    expect(generateProfile?.disabledReason).toContain("Open or create a project");
  });
});
