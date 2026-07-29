import type { AgentComponentKind, AgentStreamEvent, WorkflowStageId } from "../types";
import type { TaskStateInspection } from "../taskStateInspector";
import type { WorkflowState } from "../workflowState";

export type CockpitActionId =
  | "generate_profile"
  | "generate_preprocessing_plan"
  | "open_artifact"
  | "approve_preprocessing_plan"
  | "revise_preprocessing_plan"
  | "execute_preprocessing_plan"
  | "preview_preprocessing_plan"
  | "retry_transform"
  | "inspect_logs"
  | "open_training"
  | "start_sklearn_training"
  | "regenerate_evaluation_report"
  | "export_run_bundle"
  | "extract_lessons"
  | "retry_evaluation_report"
  | "retry_export_bundle"
  | "retry_lesson_extraction"
  | "retry_sklearn_training"
  | "select_experiment_run"
  | "select_training_dataset"
  | "apply_feature_selection"
  | "abandon_task_state";

export type CockpitComponentAction = {
  id: CockpitActionId;
  label: string;
  payload?: {
    path?: string;
    datasetPath?: string;
    datasetVersionId?: string;
    preprocessingPlanPath?: string;
    targetColumn?: string;
    approvalId?: string;
    // "local" 表示审批由前端本地流程发起，批准应本地执行而非发往编排器
    approvalOrigin?: "local";
    experimentId?: string;
    intent?: string;
    sourceSessionId?: string;
    taskId?: string;
    stage?: WorkflowStageId;
  };
  disabledReason?: string;
  tone?: "primary" | "secondary";
};

export type CockpitControlId = "target_column" | "feature_columns";

type CockpitControlBase = {
  label: string;
  description?: string;
  options: Array<{ value: string; label: string }>;
  disabledReason?: string;
};

/**
 * 卡片内的输入控件。facts 只读、actions 只触发，两者都无法表达“用户在卡片里做选择”，
 * 而训练目标列与预处理特征都需要这一步。只落地当前真实用到的两种控件形态。
 */
/** 预处理策略控件。与后端 `preprocessing_strategies` 的字段一一对应，改名要两边同步。 */
export type PlanStrategyControlId = "numeric_imputer" | "numeric_scaler" | "categorical_imputer";

export type CockpitComponentControl =
  // `target_column` 切换本次训练的目标列；`plan_target_column` 会按新目标列重算整份
  // 预处理计划。两者后果差别很大，因此各占一个 id——`runCockpitControl` 靠它分派，
  // 共用一个 id 会让计划卡片上的选择静默走成训练卡片的行为。
  | (CockpitControlBase & {
      id: "target_column" | "plan_target_column" | PlanStrategyControlId;
      kind: "select";
      value: string;
    })
  | (CockpitControlBase & { id: "feature_columns"; kind: "multi_select"; values: string[] });

export type CockpitComponentCard = {
  id: string;
  kind: AgentComponentKind | "active_dataset" | string;
  stage: WorkflowStageId;
  title: string;
  description: string;
  artifactPath?: string;
  status: "ready" | "attention" | "blocked" | "complete";
  facts: Array<{ label: string; value: string }>;
  controls?: CockpitComponentControl[];
  actions: CockpitComponentAction[];
};
export type BuildCockpitComponentCardsInput = {
  activeFile: string;
  events: AgentStreamEvent[];
  mode: "analysis" | "machine-learning";
  preprocessingPlanPath?: string | null;
  projectId?: string;
  suggestedTargetColumn?: string;
  taskStateInspection?: TaskStateInspection | null;
  trainingDatasetPath?: string;
  workflow: WorkflowState;
};

export type ComponentSignal = {
  kind: AgentComponentKind | string;
  stage: WorkflowStageId;
  title?: string;
  artifactPath?: string;
  props?: Record<string, unknown>;
};

/**
 * 各组卡片 builder 的共享输入。只放**真正跨组**的派生值——按组独占的派生值
 * 留在各 builder 内部计算，否则 context 会退化成原来那个 86 个局部变量的大作用域。
 */
export type CardBuilderContext = {
  input: BuildCockpitComponentCardsInput;
  signals: Map<string, ComponentSignal>;
  projectDisabled?: string;
  datasetDisabled?: string;
  activeDatasetPath?: string;
  effectiveTargetColumn?: string;
  planPath?: string;
  plannedDatasetPath?: string;
  missingRunCommand?: Extract<AgentStreamEvent, { type: "agent_command" }>;
  missingDatasetCommand?: Extract<AgentStreamEvent, { type: "agent_command" }>;
};
