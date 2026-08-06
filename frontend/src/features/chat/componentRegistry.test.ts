import { describe, expect, it } from "vitest";

import { buildCockpitComponentCards, selectVisibleCockpitCards } from "./componentRegistry";
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
      title: "数据集已登记",
      status: "ready",
      artifactPath: "results/session-1/dataset_registry_entry.json",
      facts: expect.arrayContaining([
        { label: "数据集", value: "data/customer_churn.csv" },
        { label: "版本", value: "csv-customer_churn-session-1" },
        { label: "规模", value: "3 行 × 4 列" },
        { label: "采样", value: "full_csv_scan" },
        { label: "列", value: "customer_id, age, monthly_charges, churn" },
      ]),
    });
    expect(summaryCard?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "open_artifact",
          label: "打开登记表",
          payload: { path: "results/session-1/dataset_registry_entry.json" },
        }),
        expect.objectContaining({
          id: "generate_profile",
          label: "生成画像",
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
          label: "批准并执行",
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
          label: "修订计划",
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
      title: "预处理计划需要修订",
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
      title: "变换执行失败",
      status: "attention",
    });
    expect(planCard?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "open_artifact" }),
        expect.objectContaining({
          id: "retry_transform",
          label: "重试变换",
          payload: expect.objectContaining({
            preprocessingPlanPath: "results/session-1/preprocessing_plan.json",
            stage: "transform",
          }),
        }),
        expect.objectContaining({ id: "generate_preprocessing_plan", label: "刷新计划" }),
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
      title: "训练执行失败",
      status: "attention",
    });
    expect(trainingCard?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "open_training" }),
        expect.objectContaining({
          id: "retry_sklearn_training",
          label: "重试训练",
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
        expect.objectContaining({ id: "inspect_logs", label: "查看日志", payload: { taskId: "session-1" } }),
        expect.objectContaining({
          id: "open_artifact",
          label: "打开计划",
          payload: { path: "results/session-1/preprocessing_plan.json" },
        }),
        expect.objectContaining({
          id: "abandon_task_state",
          label: "放弃状态",
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
        { label: "数据集", value: "data/customer_churn.csv" },
        { label: "目标列", value: "churn" },
        { label: "计划", value: "results/session-1/preprocessing_plan.json" },
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
        { label: "实验", value: "exp-evaluate" },
        { label: "数据集", value: "data/customer_churn.csv" },
        { label: "目标列", value: "churn" },
        { label: "最佳模型", value: "logistic_regression" },
      ]),
    });
    expect(comparisonCard?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "open_artifact",
          label: "打开指标",
          payload: { path: "results/session-1/metrics.json" },
        }),
      ]),
    );
    expect(reportCard).toMatchObject({
      kind: "evaluation_report",
      title: "评估报告已就绪",
      artifactPath: "results/session-1/model_evaluation_report.md",
      facts: expect.arrayContaining([
        { label: "报告", value: "results/session-1/model_evaluation_report.md" },
        { label: "指标", value: "results/session-1/metrics.json" },
        { label: "模型", value: "models/exp-evaluate.json" },
        { label: "样本", value: "results/session-1/prediction_samples.json" },
      ]),
    });
    expect(reportCard?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "open_artifact",
          label: "打开报告",
          payload: { path: "results/session-1/model_evaluation_report.md" },
        }),
        expect.objectContaining({
          id: "regenerate_evaluation_report",
          label: "重新生成报告",
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
      title: "选择实验运行",
      status: "blocked",
      facts: expect.arrayContaining([
        { label: "缺少", value: "experiment_id" },
        { label: "意图", value: "evaluate" },
        { label: "候选数", value: "2" },
        { label: "运行 1", value: "b.csv | 目标列 target | sklearn" },
        { label: "运行 1 ID", value: "candidate-b" },
      ]),
    });
    expect(selectionCard?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "select_experiment_run",
          label: "选择 b.csv · sklearn",
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
      title: "选择训练数据集",
      status: "blocked",
      facts: expect.arrayContaining([
        { label: "缺少", value: "dataset_path" },
        { label: "意图", value: "train" },
        { label: "候选数", value: "2" },
        { label: "数据集 1", value: "data/customer_churn.csv" },
        { label: "版本 1", value: "csv-customer_churn" },
        { label: "规模 1", value: "3 行 × 3 列 | 目标列候选 churn, age, monthly_charges" },
      ]),
    });
    expect(selectionCard?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "select_training_dataset",
          label: "选择 customer_churn.csv",
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
        { label: "实验", value: "exp-diagnose" },
        { label: "数据集", value: "data/customer_churn.csv" },
        { label: "最差类别", value: "yes" },
        { label: "主要混淆", value: "yes -> no" },
        { label: "误差行数", value: "5" },
        { label: "切片数", value: "1" },
      ]),
    });
    expect(errorCard?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "open_artifact",
          label: "打开指标",
          payload: { path: "results/session-1/metrics.json" },
        }),
        expect.objectContaining({
          id: "open_artifact",
          label: "打开报告",
          payload: { path: "results/session-1/model_evaluation_report.md" },
        }),
      ]),
    );
    expect(samplesCard).toMatchObject({
      kind: "prediction_samples",
      title: "预测样本",
      artifactPath: "results/session-1/prediction_samples.json",
      description: "Inspect yes prediction samples, then review features or preprocessing for this class.",
      facts: expect.arrayContaining([
        { label: "样本", value: "results/session-1/prediction_samples.json" },
        { label: "目标列", value: "churn" },
        { label: "最差类别", value: "yes" },
      ]),
    });
    expect(samplesCard?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "open_artifact",
          label: "打开样本",
          payload: { path: "results/session-1/prediction_samples.json" },
        }),
        expect.objectContaining({ id: "open_training", label: "打开诊断" }),
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
      title: "导出包已就绪",
      status: "ready",
      artifactPath: "exports/export-intent/exp-export_handoff_bundle.zip",
    });
    expect(exportCard?.facts).toEqual(
      expect.arrayContaining([
        { label: "实验", value: "exp-export" },
        { label: "导出包", value: "exports/export-intent/exp-export_handoff_bundle.zip" },
        { label: "缺失项", value: "无" },
      ]),
    );
    expect(exportCard?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "open_artifact",
          label: "打开导出包",
          payload: { path: "exports/export-intent/exp-export_handoff_bundle.zip" },
        }),
        expect.objectContaining({
          id: "export_run_bundle",
          label: "重新导出包",
          payload: { experimentId: "exp-export" },
        }),
      ]),
    );
    expect(checklistCard?.facts).toEqual(
      expect.arrayContaining([
        { label: "指标", value: "results/export-intent/metrics.json" },
        { label: "模型", value: "models/exp-export.json" },
        { label: "样本", value: "results/export-intent/prediction_samples.json" },
        { label: "计划", value: "results/export-intent/preprocessing_plan.json" },
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
      title: "习得规则审核",
      status: "ready",
      artifactPath: "results/learn-intent/missing.json",
    });
    expect(lessonCard?.facts).toEqual(
      expect.arrayContaining([
        { label: "来源会话", value: "session-1" },
        { label: "事件数", value: "8" },
        { label: "候选数", value: "2" },
        { label: "高置信数", value: "1" },
      ]),
    );
    expect(lessonCard?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "extract_lessons",
          label: "提取经验",
          payload: { sourceSessionId: "session-1" },
        }),
        expect.objectContaining({
          id: "open_artifact",
          label: "打开证据",
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
      title: "迭代建议",
      status: "attention",
      artifactPath: "results/iterate-intent/metrics.json",
    });
    expect(iterationCard?.facts).toEqual(
      expect.arrayContaining([
        { label: "实验", value: "exp-iterate" },
        { label: "数据集", value: "data/customer_churn.csv" },
        { label: "最差类别", value: "yes" },
        { label: "主要混淆", value: "yes -> no" },
        { label: "下一步", value: "Inspect prediction samples for the highest-error class." },
      ]),
    );
    expect(iterationCard?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "open_artifact",
          label: "打开指标",
          payload: { path: "results/iterate-intent/metrics.json" },
        }),
        expect.objectContaining({
          id: "open_artifact",
          label: "打开报告",
          payload: { path: "results/iterate-intent/model_evaluation_report.md" },
        }),
        expect.objectContaining({ id: "open_training", label: "打开训练" }),
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
          label: "重试评估",
          payload: { stage: "evaluate" },
        }),
        expect.objectContaining({ id: "inspect_logs", payload: { taskId: "eval-session" } }),
        expect.objectContaining({
          id: "open_artifact",
          label: "打开指标",
          payload: { path: "results/eval-session/missing_metrics.json" },
        }),
        expect.objectContaining({
          id: "abandon_task_state",
          label: "放弃状态",
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
        expect.objectContaining({ id: "retry_export_bundle", label: "重试导出", payload: { stage: "export" } }),
        expect.objectContaining({
          id: "open_artifact",
          label: "打开报告",
          payload: { path: "results/export-session/model_evaluation_report.md" },
        }),
        expect.objectContaining({
          id: "abandon_task_state",
          label: "放弃状态",
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
        expect.objectContaining({ id: "retry_lesson_extraction", label: "重试沉淀", payload: { stage: "learn" } }),
        expect.objectContaining({ id: "inspect_logs", payload: { taskId: "learn-session" } }),
        expect.objectContaining({
          id: "abandon_task_state",
          label: "放弃状态",
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
    expect(generateProfile?.disabledReason).toContain("打开或创建项目");
  });
});

describe("cockpit training target selection", () => {
  function trainingCardFor(input: {
    events: AgentStreamEvent[];
    suggestedTargetColumn?: string;
    activeFile?: string;
  }) {
    const activeFile = input.activeFile ?? "data/customer_churn.csv";
    const result = buildCockpitComponentCards({
      activeFile,
      events: input.events,
      mode: "machine-learning",
      projectId: "project-1",
      suggestedTargetColumn: input.suggestedTargetColumn,
      trainingDatasetPath: activeFile,
      workflow: deriveWorkflowState(input.events, "machine-learning", activeFile),
    });
    return result.find((card) => card.id === "training-config");
  }

  function profileEvent(targetCandidates: string[]): AgentStreamEvent {
    return {
      type: "component_requested",
      task_id: "session-1",
      stage: "profile",
      component: "data_quality",
      title: "Review data quality profile",
      artifact_path: "results/session-1/data_quality_profile.json",
      props: {
        dataset_path: "data/customer_churn.csv",
        profile_path: "results/session-1/data_quality_profile.json",
        row_count: 120,
        column_count: 8,
        target_candidates: targetCandidates,
      },
    };
  }

  const trainingEvent: AgentStreamEvent = {
    type: "component_requested",
    task_id: "session-1",
    stage: "train",
    component: "training_config",
    title: "Configure sklearn training",
    artifact_path: "data/customer_churn.csv",
    props: { dataset_path: "data/customer_churn.csv", engine: "sklearn" },
  };

  it("offers profiled target candidates as an in-card selection control", () => {
    const card = trainingCardFor({
      events: [profileEvent(["churn", "contract_type"]), trainingEvent],
      suggestedTargetColumn: "churn",
    });

    const control = card?.controls?.find((item) => item.id === "target_column");
    expect(control).toMatchObject({ kind: "select", value: "churn" });
    expect(control?.options.map((option) => option.value)).toEqual(["churn", "contract_type"]);
    // 控件已经呈现目标列，facts 不应再重复同一信息
    expect(card?.facts.map((fact) => fact.label)).not.toContain("目标列");
  });

  it("keeps an already resolved target selectable when profiling did not rank it", () => {
    const card = trainingCardFor({
      events: [profileEvent(["contract_type"]), trainingEvent],
      suggestedTargetColumn: "churn",
    });

    const control = card?.controls?.find((item) => item.id === "target_column");
    // 与上一条用例同样的写法：select 变体的 id 现在是联合类型，find 不再把它收窄到单一变体
    expect(control).toMatchObject({ value: "churn" });
    expect(control?.options.map((option) => option.value)).toContain("churn");
  });

  it("does not fabricate a target control before a profile produced candidates", () => {
    const card = trainingCardFor({ events: [trainingEvent] });

    expect(card?.controls ?? []).toHaveLength(0);
    expect(card?.status).toBe("attention");
    expect(
      card?.actions.find((action) => action.id === "start_sklearn_training")?.disabledReason,
    ).toContain("目标列");
  });

  // 「生成画像」按钮走的是本地 artifact 事件，候选是带评分的对象数组；
  // 后端自然语言路径走 component_requested，候选已被降级成列名数组。两条路径都要能选目标列。
  it("reads scored candidates from a locally generated profile artifact", () => {
    const card = trainingCardFor({
      events: [
        {
          type: "artifact_created",
          artifact: {
            id: "artifact-profile",
            project_id: "project-1",
            session_id: "session-1",
            type: "dataframe",
            name: "data_quality_profile.json",
            path: "results/session-1/data_quality_profile.json",
            metadata: {
              target_candidates: [
                { column: "churn", score: 0.92 },
                { column: "contract_type", score: 0.41 },
              ],
            },
            created_at: "2026-07-27T00:00:00Z",
          },
        },
        trainingEvent,
      ],
      suggestedTargetColumn: "churn",
    });

    const control = card?.controls?.find((item) => item.id === "target_column");
    expect(control?.options.map((option) => option.value)).toEqual(["churn", "contract_type"]);
  });
});

describe("cockpit preprocessing feature selection", () => {
  function planArtifactEvent(metadata: Record<string, unknown>): AgentStreamEvent {
    return {
      type: "artifact_created",
      artifact: {
        id: "artifact-plan",
        project_id: "project-1",
        session_id: "session-1",
        type: "dataframe",
        name: "preprocessing_plan.json",
        path: "results/session-1/preprocessing_plan.json",
        metadata: { artifact_role: "preprocessing_plan", ...metadata },
        created_at: "2026-07-27T00:00:00Z",
      },
    };
  }

  function planCardFor(events: AgentStreamEvent[]) {
    const activeFile = "data/customer_churn.csv";
    return buildCockpitComponentCards({
      activeFile,
      events,
      mode: "analysis",
      projectId: "project-1",
      trainingDatasetPath: activeFile,
      workflow: deriveWorkflowState(events, "analysis", activeFile),
    }).find((card) => card.kind === "preprocessing_plan");
  }

  it("offers every non-target column as a feature choice with planned features preselected", () => {
    const card = planCardFor([
      planArtifactEvent({
        target_column: "churn",
        feature_columns: ["age", "contract"],
        drop_columns: ["customer_id"],
      }),
    ]);

    const control = card?.controls?.find((item) => item.id === "feature_columns");
    expect(control?.kind).toBe("multi_select");
    expect(control?.kind === "multi_select" ? control.values : []).toEqual(["age", "contract"]);
    expect(control?.options.map((option) => option.value)).toEqual([
      "age",
      "contract",
      "customer_id",
    ]);
  });

  it("exposes an apply action for the edited feature selection", () => {
    const card = planCardFor([
      planArtifactEvent({
        target_column: "churn",
        feature_columns: ["age"],
        drop_columns: ["customer_id"],
      }),
    ]);

    expect(card?.actions.map((action) => action.id)).toContain("apply_feature_selection");
  });

  it("does not offer feature editing before a plan reported its columns", () => {
    const card = planCardFor([planArtifactEvent({ target_column: "churn" })]);

    // 断言范围收在特征控件上：策略选择器与列信息无关，检查点上一直提供
    expect(card?.controls?.map((control) => control.id) ?? []).not.toContain("feature_columns");
    expect(card?.actions.map((action) => action.id)).not.toContain("apply_feature_selection");
  });
});

describe("cockpit card ordering", () => {
  // cockpit 只渲染前若干张卡片。Agent 会直接让用户"查看训练卡片"，
  // 若当前阶段的卡片被挤出可见范围，用户就被指向了一个看不到的东西。
  it("keeps the stages the workflow reached when the list exceeds the limit", () => {
    // 复现自然语言流程走到训练配置时的真实产物集合：卡片数量超过 cockpit 的可见上限
    const activeFile = "results/session-1/nl_churn_planned.csv";
    function producedArtifact(name: string, path: string, metadata: Record<string, unknown> = {}) {
      return {
        type: "artifact_created" as const,
        artifact: {
          id: `artifact-${name}`,
          project_id: "project-1",
          session_id: "session-1",
          type: "dataframe" as const,
          name,
          path,
          metadata,
          created_at: "2026-07-27T00:00:00Z",
        },
      };
    }
    const events: AgentStreamEvent[] = [
      producedArtifact("data_quality_profile.json", "results/session-1/data_quality_profile.json", {
        target_candidates: ["churn"],
      }),
      producedArtifact("preprocessing_plan.json", "results/session-1/preprocessing_plan.json", {
        artifact_role: "preprocessing_plan",
        feature_columns: ["age", "monthly_spend"],
        drop_columns: [],
      }),
      producedArtifact("nl_churn_planned.csv", activeFile, { artifact_role: "preprocessed_dataset" }),
      producedArtifact(
        "preprocessing_transform_report.json",
        "results/session-1/preprocessing_transform_report.json",
        { artifact_role: "preprocessing_transform_summary", output_dataset_path: activeFile },
      ),
      {
        type: "component_requested",
        task_id: "session-1",
        stage: "train",
        component: "training_config",
        title: "Configure sklearn training",
        artifact_path: activeFile,
        props: { dataset_path: activeFile, target_column: "churn" },
      },
    ];
    const result = buildCockpitComponentCards({
      activeFile,
      events,
      mode: "analysis",
      projectId: "project-1",
      suggestedTargetColumn: "churn",
      trainingDatasetPath: activeFile,
      workflow: deriveWorkflowState(events, "analysis", activeFile),
    });

    // 卡片按工作流顺序产生：越靠后越是当前该做的事。超出上限时必须保留后者。
    expect(result.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["data_quality", "training_config"]),
    );

    const visible = selectVisibleCockpitCards(result, 2).map((card) => card.kind);
    expect(visible).toContain("training_config");
    expect(visible).not.toContain("data_quality");
  });

  it("keeps every card when the list is within the limit", () => {
    const cards = [
      { id: "a", kind: "data_quality", stage: "profile" },
      { id: "b", kind: "training_config", stage: "train" },
    ] as Parameters<typeof selectVisibleCockpitCards>[0];

    expect(selectVisibleCockpitCards(cards, 6)).toHaveLength(2);
  });
});

describe("cockpit transformation report card", () => {
  const transformReportEvent: AgentStreamEvent = {
    type: "artifact_created",
    artifact: {
      id: "artifact-transform",
      project_id: "project-1",
      session_id: "session-1",
      type: "report",
      name: "preprocessing_transform_report.md",
      path: "results/session-1/preprocessing_transform_report.md",
      metadata: {
        artifact_role: "preprocessing_transform_report",
        dataset_path: "data/customer_churn.csv",
        output_dataset_path: "results/session-1/customer_churn_planned.csv",
      },
      created_at: "2026-07-27T00:00:00Z",
    },
  };

  it("surfaces the transform diff with entries into the report and planned dataset", () => {
    const activeFile = "data/customer_churn.csv";
    const events = [transformReportEvent];
    const card = buildCockpitComponentCards({
      activeFile,
      events,
      mode: "analysis",
      projectId: "project-1",
      trainingDatasetPath: activeFile,
      workflow: deriveWorkflowState(events, "analysis", activeFile),
    }).find((item) => item.id === "transformation-report");

    expect(card).toMatchObject({ kind: "transformation_report", stage: "transform" });
    expect(card?.facts.map((fact) => fact.value)).toEqual(
      expect.arrayContaining(["results/session-1/customer_churn_planned.csv"]),
    );

    // 结构化列对照只在 .json 明细里，.md 报告是纯文本，两个入口必须分别指向各自产物
    const paths = card?.actions.map((action) => action.payload?.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "results/session-1/preprocessing_transform_report.json",
        "results/session-1/preprocessing_transform_report.md",
        "results/session-1/customer_churn_planned.csv",
      ]),
    );
  });
});


/**
 * 计划卡片的目标列选择器。目标列决定了哪些列进 drop、哪些进特征、pipeline_script
 * 怎么写，所以纠正它必须在审批检查点这里并重算整份计划——放到训练卡片上改已经太晚，
 * 那时计划早已按错的目标列算完，而计划才是训练目标列的权威来源。
 */
describe("cockpit preprocessing plan target selection", () => {
  function planComponentEvent(props: Record<string, unknown>): AgentStreamEvent {
    return {
      type: "component_requested",
      task_id: "session-1",
      stage: "transform",
      component: "preprocessing_plan",
      title: "Review preprocessing plan",
      artifact_path: "results/session-1/preprocessing_plan.json",
      props,
    };
  }

  const planApproval: AgentStreamEvent[] = [
    {
      type: "component_requested",
      task_id: "session-1",
      stage: "profile",
      component: "data_quality",
      title: "Review data quality profile",
      artifact_path: "results/session-1/data_quality_profile.json",
      props: { target_candidates: ["converted", "contract_type"] },
    },
    {
      type: "component_requested",
      task_id: "session-1",
      stage: "transform",
      component: "preprocessing_plan",
      title: "Review preprocessing plan",
      artifact_path: "results/session-1/preprocessing_plan.json",
      props: { target_column: "converted", feature_columns: ["age"], drop_columns: ["note"] },
    },
    {
      type: "approval_required",
      task_id: "session-1",
      approval_id: "session-1-preprocessing-plan",
      stage: "transform",
      title: "Approve preprocessing transform",
      artifact_path: "results/session-1/preprocessing_plan.json",
    },
  ];

  function planCardFor(events: AgentStreamEvent[]) {
    const activeFile = "data/customer_churn.csv";
    return buildCockpitComponentCards({
      activeFile,
      events,
      mode: "analysis",
      projectId: "project-1",
      workflow: deriveWorkflowState(events, "analysis", activeFile),
    }).find((card) => card.id === "preprocessing-plan");
  }

  it("offers a target column selector at the approval checkpoint", () => {
    const card = planCardFor(planApproval);

    const control = card?.controls?.find((item) => item.id === "plan_target_column");
    expect(control).toMatchObject({ kind: "select", value: "converted" });
    expect(control?.options.map((option) => option.value)).toEqual(["converted", "contract_type"]);
    // 顺序即阅读顺序：先定预测什么，再定用哪些列，最后才是这些列怎么处理
    expect(card?.controls?.map((item) => item.id)).toEqual([
      "plan_target_column",
      "feature_columns",
      "numeric_imputer",
      "numeric_scaler",
      "categorical_imputer",
    ]);
  });

  it("keeps the plan selector distinct from the training one", () => {
    // 两者后果不同：一个重算整份计划，一个只切换本次训练的目标列。共用 id 会让
    // 计划卡片上的选择静默走成训练卡片的行为。
    const card = planCardFor(planApproval);

    expect(card?.controls?.map((item) => item.id)).not.toContain("target_column");
  });

  it("shows the strategies the plan actually recorded, not the defaults", () => {
    // 卡片只拿得到事件 props（来自产物 metadata）。不显示计划真实取值的话，用户改一项
    // 时另外两项会被当成默认值一起送回后端，等于悄悄改掉了没碰过的设置。
    const card = planCardFor([
      planApproval[0],
      planComponentEvent({
        target_column: "converted",
        feature_columns: ["age"],
        drop_columns: ["note"],
        numeric_imputer: "zero",
        numeric_scaler: "none",
        categorical_imputer: "constant",
      }),
      planApproval[2],
    ]);

    const values = Object.fromEntries(
      (card?.controls ?? [])
        .filter((control) => control.kind === "select")
        .map((control) => [control.id, control.value]),
    );
    expect(values).toMatchObject({
      numeric_imputer: "zero",
      numeric_scaler: "none",
      categorical_imputer: "constant",
    });
  });

  it("offers a preview before the irreversible approve step", () => {
    // 批准会写出变换后的数据集，是一步不可逆的动作。此前要看清楚会发生什么，
    // 只能先批准再执行——预览把这一步挪到批准之前。
    const card = planCardFor(planApproval);

    expect(card?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "preview_preprocessing_plan",
          label: "预览变换",
          payload: { preprocessingPlanPath: "results/session-1/preprocessing_plan.json" },
        }),
      ]),
    );
  });

  it("does not offer the selector once the checkpoint is resolved", () => {
    // 变换已执行后再改目标列毫无意义：这份计划已经产出了数据集，改它不会回头重算
    const card = planCardFor([
      ...planApproval,
      {
        type: "artifact_created",
        artifact: {
          id: "artifact-planned",
          project_id: "project-1",
          session_id: "session-1",
          type: "dataframe",
          name: "customer_churn_planned.csv",
          path: "results/session-1/customer_churn_planned.csv",
          metadata: {},
          created_at: "2026-07-29T00:00:00Z",
        },
      },
    ]);

    expect(card?.controls?.map((item) => item.id) ?? []).not.toContain("plan_target_column");
  });
});
