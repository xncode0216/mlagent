import type { AgentComponentKind, AgentStreamEvent, WorkflowStageId } from "./types";
import type { TaskStateInspection } from "./taskStateInspector";
import type { WorkflowState } from "./workflowState";
import { compactInformationIdentifier, friendlyPathName } from "./informationDisplay";

export type CockpitActionId =
  | "generate_profile"
  | "generate_preprocessing_plan"
  | "open_artifact"
  | "approve_preprocessing_plan"
  | "revise_preprocessing_plan"
  | "execute_preprocessing_plan"
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
export type CockpitComponentControl =
  | (CockpitControlBase & { id: "target_column"; kind: "select"; value: string })
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

type ComponentSignal = {
  kind: AgentComponentKind | string;
  stage: WorkflowStageId;
  title?: string;
  artifactPath?: string;
  props?: Record<string, unknown>;
};

function stringProp(props: Record<string, unknown> | undefined, key: string) {
  const value = props?.[key];
  return typeof value === "string" && value ? value : undefined;
}

function numberProp(props: Record<string, unknown> | undefined, key: string) {
  const value = props?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function arrayProp(props: Record<string, unknown> | undefined, key: string) {
  const value = props?.[key];
  return Array.isArray(value) ? value : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

/**
 * 目标列候选有两种真实来源，形状不同：orchestrator 的 component_requested 已把候选
 * 降级成列名数组，而本地「生成画像」写入的 artifact metadata 仍是带评分的对象数组。
 * 两者都按后端的评分顺序排列，这里统一取列名。
 */
function targetCandidatesFromProps(props: Record<string, unknown> | undefined) {
  return (arrayProp(props, "target_candidates") ?? [])
    .map((candidate) => {
      if (typeof candidate === "string") return stringValue(candidate);
      if (candidate && typeof candidate === "object") {
        return stringValue((candidate as Record<string, unknown>).column);
      }
      return undefined;
    })
    .filter((column): column is string => Boolean(column));
}

function stringListFromProps(props: Record<string, unknown> | undefined, key: string) {
  return (arrayProp(props, key) ?? [])
    .map((item) => stringValue(item))
    .filter((item): item is string => Boolean(item));
}

/**
 * 特征选择的候选是计划里的“全部非目标列”，即已选特征加上被丢弃的列；已选特征保持勾选。
 * 计划未报告列信息时不造控件，避免呈现一个空的、会把全部特征清空的选择器。
 */
function buildFeatureSelectionControls(
  plannedFeatures: string[],
  droppedColumns: string[],
): CockpitComponentControl[] {
  if (plannedFeatures.length === 0 && droppedColumns.length === 0) return [];
  const options = [...new Set([...plannedFeatures, ...droppedColumns])];
  return [
    {
      id: "feature_columns",
      kind: "multi_select",
      label: "参与训练的特征",
      description: "取消勾选的列会以 deselected 记入计划，重新生成计划与管道脚本后生效。",
      values: plannedFeatures,
      options: options.map((value) => ({ value, label: value })),
    },
  ];
}

/**
 * 目标列候选来自 data_quality 画像（后端已按评分降序）。没有画像就没有候选，
 * 此时不造选择器，让卡片继续引导用户先生成画像。已解析出的目标列即使不在候选里
 * 也保留为可选项，避免选择器把 agent 或右侧面板定下的值挤掉。
 */
function buildTargetColumnControls(
  candidates: string[],
  currentTarget: string | undefined,
): CockpitComponentControl[] {
  if (candidates.length === 0) return [];
  const values = [...new Set([...(currentTarget ? [currentTarget] : []), ...candidates])];
  return [
    {
      id: "target_column",
      kind: "select",
      label: "目标列",
      description: "选择本次训练要预测的列。候选来自数据画像的目标列评分。",
      value: currentTarget ?? "",
      options: values.map((value) => ({ value, label: value })),
    },
  ];
}

function runCandidateLabel(candidate: Record<string, unknown>) {
  const datasetPath = stringValue(candidate.dataset_path);
  const bestModelName = stringValue(candidate.best_model_name);
  const experimentId = stringValue(candidate.experiment_id);
  return [datasetPath ? friendlyPathName(datasetPath) : undefined, bestModelName]
    .filter(Boolean)
    .join(" · ") || (experimentId ? compactInformationIdentifier(experimentId) : "未知实验");
}

function runCandidateFacts(candidate: Record<string, unknown>) {
  const datasetPath = stringValue(candidate.dataset_path) ?? "-";
  const targetColumn = stringValue(candidate.target_column) ?? "-";
  const bestModelName = stringValue(candidate.best_model_name) ?? "-";
  return `${friendlyPathName(datasetPath)} | 目标列 ${targetColumn} | ${bestModelName}`;
}

function datasetCandidateLabel(candidate: Record<string, unknown>) {
  const path = stringValue(candidate.dataset_path);
  return path ? friendlyPathName(path) : "未知数据集";
}

function datasetCandidateTarget(candidate: Record<string, unknown>) {
  const targetCandidates = stringValue(candidate.target_candidates);
  return targetCandidates?.split(",").map((item) => item.trim()).find(Boolean);
}

function datasetCandidateFacts(candidate: Record<string, unknown>) {
  const rowCount = stringValue(candidate.row_count) ?? "-";
  const columnCount = stringValue(candidate.column_count) ?? "-";
  const targetCandidates = stringValue(candidate.target_candidates) ?? "-";
  return `${rowCount} 行 × ${columnCount} 列 | 目标列候选 ${targetCandidates}`;
}

function latestMissingRunCommand(events: AgentStreamEvent[]) {
  return [...events]
    .reverse()
    .find(
      (event): event is Extract<AgentStreamEvent, { type: "agent_command" }> =>
        event.type === "agent_command" &&
        Boolean(event.command.missing_context?.includes("experiment_id")) &&
        Array.isArray(event.command.candidate_runs) &&
        event.command.candidate_runs.length > 0,
    );
}

function latestMissingDatasetCommand(events: AgentStreamEvent[]) {
  return [...events]
    .reverse()
    .find(
      (event): event is Extract<AgentStreamEvent, { type: "agent_command" }> =>
        event.type === "agent_command" &&
        Boolean(event.command.missing_context?.includes("dataset_path")) &&
        Array.isArray(event.command.candidate_datasets) &&
        event.command.candidate_datasets.length > 0,
    );
}

function isDatasetPath(path?: string | null) {
  return Boolean(path && /\.(csv|tsv|jsonl|parquet)$/i.test(path) && !path.includes("preprocessing_plan"));
}

function artifactText(event: Extract<AgentStreamEvent, { type: "artifact_created" }>) {
  return [
    event.artifact.name,
    event.artifact.path,
    event.artifact.type,
    ...Object.entries(event.artifact.metadata).map(([key, value]) => `${key} ${String(value)}`),
  ]
    .join(" ")
    .toLowerCase();
}

function classifyArtifact(event: Extract<AgentStreamEvent, { type: "artifact_created" }>): ComponentSignal | null {
  const namePath = `${event.artifact.name} ${event.artifact.path}`.toLowerCase();
  const artifactRole =
    typeof event.artifact.metadata.artifact_role === "string" ? event.artifact.metadata.artifact_role : "";
  const text = artifactText(event);

  if (namePath.includes("preprocessing_plan")) {
    return {
      kind: "preprocessing_plan",
      stage: "transform",
      artifactPath: event.artifact.path,
      props: event.artifact.metadata,
    };
  }
  if (artifactRole === "dataset_registry_entry" || namePath.includes("dataset_registry_entry")) {
    return { kind: "dataset_summary", stage: "ingest", artifactPath: event.artifact.path };
  }
  if (
    namePath.includes("_planned.csv") ||
    namePath.includes("_preprocessed.csv") ||
    text.includes("planned dataset") ||
    artifactRole === "preprocessed_dataset"
  ) {
    return { kind: "planned_dataset", stage: "transform", artifactPath: event.artifact.path };
  }
  if (
    namePath.includes("preprocessing_transform") ||
    text.includes("transformation report") ||
    artifactRole === "preprocessing_transform_report" ||
    artifactRole === "preprocessing_transform_summary"
  ) {
    return {
      kind: "transformation_report",
      stage: "transform",
      artifactPath: event.artifact.path,
      props: event.artifact.metadata,
    };
  }
  if (text.includes("data_quality") || text.includes("quality profile")) {
    return {
      kind: "data_quality",
      stage: "profile",
      artifactPath: event.artifact.path,
      props: event.artifact.metadata,
    };
  }
  if (text.includes("evaluation_report") || text.includes("model_evaluation_report")) {
    return { kind: "evaluation_report", stage: "evaluate", artifactPath: event.artifact.path };
  }
  if (text.includes("prediction_samples")) {
    return { kind: "prediction_samples", stage: "diagnose", artifactPath: event.artifact.path };
  }
  return null;
}

function collectSignals(events: AgentStreamEvent[]) {
  const byKind = new Map<string, ComponentSignal>();

  for (const event of events) {
    if (event.type === "component_requested") {
      byKind.set(event.component, {
        kind: event.component,
        stage: event.stage,
        title: event.title,
        artifactPath: event.artifact_path,
        props: event.props,
      });
    }
    if (event.type === "artifact_created") {
      const signal = classifyArtifact(event);
      if (signal) byKind.set(signal.kind, signal);
    }
  }

  return byKind;
}

function disabledWithoutProject(projectId?: string) {
  return projectId ? undefined : "执行此操作前请先打开或创建项目。";
}

function disabledWithoutDataset(datasetPath?: string) {
  return isDatasetPath(datasetPath) ? undefined : "执行此操作前请先选择数据集文件。";
}

function action(
  id: CockpitActionId,
  label: string,
  options: Omit<CockpitComponentAction, "id" | "label"> = {},
): CockpitComponentAction {
  return { id, label, ...options };
}

export function buildCockpitComponentCards(input: BuildCockpitComponentCardsInput): CockpitComponentCard[] {
  const signals = collectSignals(input.events);
  const missingRunCommand = latestMissingRunCommand(input.events);
  const missingRunCandidates = missingRunCommand?.command.candidate_runs ?? [];
  const missingDatasetCommand = latestMissingDatasetCommand(input.events);
  const missingDatasetCandidates = missingDatasetCommand?.command.candidate_datasets ?? [];
  const datasetSummarySignal = signals.get("dataset_summary");
  const trainingSignal = signals.get("training_config");
  const modelComparisonSignal = signals.get("model_comparison");
  const evaluationReportSignal = signals.get("evaluation_report");
  const errorAnalysisSignal = signals.get("error_analysis");
  const predictionSamplesSignal = signals.get("prediction_samples");
  const iterationProposalSignal = signals.get("iteration_proposal");
  const exportBundleSignal = signals.get("export_bundle");
  const lessonReviewSignal = signals.get("lesson_review");
  const activeDatasetPath = isDatasetPath(input.activeFile) ? input.activeFile : input.trainingDatasetPath;
  const requestedTrainingDatasetPath = stringProp(trainingSignal?.props, "dataset_path");
  const requestedTargetColumn = stringProp(trainingSignal?.props, "target_column");
  const requestedPreprocessingPlanPath = stringProp(trainingSignal?.props, "preprocessing_plan_path");
  const effectiveTrainingDatasetPath = requestedTrainingDatasetPath ?? input.trainingDatasetPath;
  const effectiveTargetColumn = requestedTargetColumn ?? input.suggestedTargetColumn;
  const dataProfilePath = signals.get("data_quality")?.artifactPath;
  const targetCandidateColumns = targetCandidatesFromProps(signals.get("data_quality")?.props);
  const evaluationExperimentId =
    stringProp(evaluationReportSignal?.props, "experiment_id") ?? stringProp(modelComparisonSignal?.props, "experiment_id");
  const evaluationDatasetPath =
    stringProp(evaluationReportSignal?.props, "dataset_path") ?? stringProp(modelComparisonSignal?.props, "dataset_path");
  const evaluationTargetColumn =
    stringProp(evaluationReportSignal?.props, "target_column") ?? stringProp(modelComparisonSignal?.props, "target_column");
  const evaluationMetricsPath =
    stringProp(evaluationReportSignal?.props, "metrics_path") ??
    stringProp(modelComparisonSignal?.props, "metrics_path") ??
    modelComparisonSignal?.artifactPath;
  const evaluationModelPath =
    stringProp(evaluationReportSignal?.props, "model_path") ?? stringProp(modelComparisonSignal?.props, "model_path");
  const evaluationReportPath =
    stringProp(evaluationReportSignal?.props, "evaluation_report_path") ?? evaluationReportSignal?.artifactPath;
  const evaluationPredictionSamplesPath =
    stringProp(evaluationReportSignal?.props, "prediction_samples_path") ??
    stringProp(modelComparisonSignal?.props, "prediction_samples_path");
  const evaluationBestModel =
    stringProp(evaluationReportSignal?.props, "best_model_name") ?? stringProp(modelComparisonSignal?.props, "best_model_name");
  const diagnosisExperimentId =
    stringProp(errorAnalysisSignal?.props, "experiment_id") ?? stringProp(predictionSamplesSignal?.props, "experiment_id");
  const diagnosisDatasetPath =
    stringProp(errorAnalysisSignal?.props, "dataset_path") ?? stringProp(predictionSamplesSignal?.props, "dataset_path");
  const diagnosisTargetColumn =
    stringProp(errorAnalysisSignal?.props, "target_column") ?? stringProp(predictionSamplesSignal?.props, "target_column");
  const diagnosisMetricsPath =
    stringProp(errorAnalysisSignal?.props, "metrics_path") ??
    stringProp(predictionSamplesSignal?.props, "metrics_path") ??
    errorAnalysisSignal?.artifactPath;
  const diagnosisReportPath =
    stringProp(errorAnalysisSignal?.props, "evaluation_report_path") ??
    stringProp(predictionSamplesSignal?.props, "evaluation_report_path");
  const diagnosisSamplesPath =
    stringProp(errorAnalysisSignal?.props, "prediction_samples_path") ??
    stringProp(predictionSamplesSignal?.props, "prediction_samples_path") ??
    predictionSamplesSignal?.artifactPath;
  const diagnosisWorstClass =
    stringProp(errorAnalysisSignal?.props, "worst_class") ?? stringProp(predictionSamplesSignal?.props, "worst_class");
  const diagnosisMainConfusion =
    stringProp(errorAnalysisSignal?.props, "main_confusion") ?? stringProp(predictionSamplesSignal?.props, "main_confusion");
  const diagnosisRecommendation =
    stringProp(errorAnalysisSignal?.props, "recommendation") ?? stringProp(predictionSamplesSignal?.props, "recommendation");
  const diagnosisErrorCount =
    numberProp(errorAnalysisSignal?.props, "error_count") ?? numberProp(predictionSamplesSignal?.props, "error_count");
  const diagnosisSliceCount =
    arrayProp(errorAnalysisSignal?.props, "error_slices")?.length ??
    arrayProp(predictionSamplesSignal?.props, "error_slices")?.length;
  const iterationExperimentId = stringProp(iterationProposalSignal?.props, "experiment_id");
  const iterationDatasetPath = stringProp(iterationProposalSignal?.props, "dataset_path");
  const iterationTargetColumn = stringProp(iterationProposalSignal?.props, "target_column");
  const iterationMetricsPath = stringProp(iterationProposalSignal?.props, "metrics_path") ?? iterationProposalSignal?.artifactPath;
  const iterationReportPath = stringProp(iterationProposalSignal?.props, "evaluation_report_path");
  const iterationSamplesPath = stringProp(iterationProposalSignal?.props, "prediction_samples_path");
  const iterationPlanPath = stringProp(iterationProposalSignal?.props, "preprocessing_plan_path");
  const iterationWorstClass = stringProp(iterationProposalSignal?.props, "worst_class");
  const iterationMainConfusion = stringProp(iterationProposalSignal?.props, "main_confusion");
  const iterationRecommendation = stringProp(iterationProposalSignal?.props, "recommendation");
  const iterationNextActions = arrayProp(iterationProposalSignal?.props, "next_actions") ?? [];
  const exportExperimentId = stringProp(exportBundleSignal?.props, "experiment_id");
  const exportDatasetPath = stringProp(exportBundleSignal?.props, "dataset_path");
  const exportTargetColumn = stringProp(exportBundleSignal?.props, "target_column");
  const exportMetricsPath = stringProp(exportBundleSignal?.props, "metrics_path");
  const exportModelPath = stringProp(exportBundleSignal?.props, "model_path");
  const exportReportPath = stringProp(exportBundleSignal?.props, "evaluation_report_path");
  const exportSamplesPath = stringProp(exportBundleSignal?.props, "prediction_samples_path");
  const exportPlanPath = stringProp(exportBundleSignal?.props, "preprocessing_plan_path");
  const exportBundlePath = stringProp(exportBundleSignal?.props, "export_bundle_path");
  const exportMissingArtifacts = arrayProp(exportBundleSignal?.props, "missing_required_artifacts") ?? [];
  const exportBundleReady =
    typeof exportBundleSignal?.props?.bundle_ready === "boolean"
      ? exportBundleSignal.props.bundle_ready
      : Boolean(exportExperimentId && exportMetricsPath && exportModelPath && exportReportPath);
  const lessonSourceSessionId = stringProp(lessonReviewSignal?.props, "source_session_id");
  const lessonSourceEventCount = numberProp(lessonReviewSignal?.props, "source_event_count");
  const lessonCandidateCount = numberProp(lessonReviewSignal?.props, "candidate_count");
  const lessonHighConfidenceCount = numberProp(lessonReviewSignal?.props, "high_confidence_count");
  const lessonLatestEventType = stringProp(lessonReviewSignal?.props, "latest_event_type");
  const lessonSourceArtifacts = arrayProp(lessonReviewSignal?.props, "source_artifacts") ?? [];
  const lessonHasExtractableCandidates =
    typeof lessonReviewSignal?.props?.has_extractable_candidates === "boolean"
      ? lessonReviewSignal.props.has_extractable_candidates
      : undefined;
  const registeredDatasetPath = stringProp(datasetSummarySignal?.props, "dataset_path") ?? activeDatasetPath;
  const datasetRegistryPath =
    stringProp(datasetSummarySignal?.props, "registry_path") ?? datasetSummarySignal?.artifactPath;
  const datasetVersionId = stringProp(datasetSummarySignal?.props, "dataset_version_id");
  const datasetRowCount = numberProp(datasetSummarySignal?.props, "row_count");
  const datasetColumnCount = numberProp(datasetSummarySignal?.props, "column_count");
  const datasetColumns = arrayProp(datasetSummarySignal?.props, "columns") ?? [];
  const datasetSampleStrategy = stringProp(datasetSummarySignal?.props, "sample_strategy");
  const planPath =
    requestedPreprocessingPlanPath ??
    input.preprocessingPlanPath ??
    signals.get("preprocessing_plan")?.artifactPath ??
    input.workflow.approval?.artifactPath ??
    (input.activeFile.endsWith("preprocessing_plan.json") ? input.activeFile : undefined);
  const plannedDatasetPath =
    signals.get("planned_dataset")?.artifactPath ??
    (input.activeFile.includes("_planned.csv") || input.activeFile.includes("planned") ? input.activeFile : undefined);
  const failedTransformNeedsRevision = Boolean(
    input.workflow.currentStage.id === "transform" &&
      input.workflow.currentStage.status === "failed" &&
      !input.workflow.currentStage.retryable &&
      !input.workflow.approval &&
      !plannedDatasetPath,
  );
  const retryableTransformFailure = Boolean(
    input.workflow.currentStage.id === "transform" &&
      input.workflow.currentStage.status === "failed" &&
      input.workflow.currentStage.retryable &&
      !input.workflow.approval &&
      !plannedDatasetPath,
  );
  const retryableTrainingFailure = Boolean(
    input.workflow.currentStage.id === "train" &&
      input.workflow.currentStage.status === "failed" &&
      input.workflow.currentStage.retryable,
  );
  const retryableEvaluationFailure = Boolean(
    input.workflow.currentStage.id === "evaluate" &&
      input.workflow.currentStage.status === "failed" &&
      input.workflow.currentStage.retryable,
  );
  const retryableExportFailure = Boolean(
    input.workflow.currentStage.id === "export" &&
      input.workflow.currentStage.status === "failed" &&
      input.workflow.currentStage.retryable,
  );
  const retryableLearnFailure = Boolean(
    input.workflow.currentStage.id === "learn" &&
      input.workflow.currentStage.status === "failed" &&
      input.workflow.currentStage.retryable,
  );
  const taskInspection = input.taskStateInspection;
  const cards: CockpitComponentCard[] = [];
  const projectDisabled = disabledWithoutProject(input.projectId);
  const datasetDisabled = disabledWithoutDataset(activeDatasetPath);

  if (missingRunCommand) {
    const intent = missingRunCommand.command.intent;
    const stage = (
      intent === "diagnose" || intent === "export" || intent === "evaluate" ? intent : input.workflow.currentStage.id
    ) as WorkflowStageId;
    cards.push({
      id: "experiment-run-selection",
      kind: "experiment_run_selection",
      stage,
      title: "选择实验运行",
      description:
        "智能体发现了多个已完成的运行。请先选择要继续的运行，再打开评估、诊断或导出卡片。",
      status: "blocked",
      facts: [
        { label: "缺少", value: "experiment_id" },
        { label: "意图", value: intent },
        { label: "候选数", value: String(missingRunCandidates.length) },
        ...missingRunCandidates.slice(0, 3).flatMap((candidate, index) => [
          { label: `运行 ${index + 1}`, value: runCandidateFacts(candidate) },
          { label: `运行 ${index + 1} ID`, value: stringValue(candidate.experiment_id) ?? "-" },
        ]),
      ],
      actions: missingRunCandidates.slice(0, 5).map((candidate, index) =>
        action("select_experiment_run", `选择 ${runCandidateLabel(candidate)}`, {
          disabledReason: projectDisabled ?? (stringValue(candidate.experiment_id) ? undefined : "此运行缺少 id。"),
          payload: {
            experimentId: stringValue(candidate.experiment_id),
            intent,
            stage,
          },
          tone: index === 0 ? "primary" : "secondary",
        }),
      ),
    });
  }

  if (missingDatasetCommand) {
    const intent = missingDatasetCommand.command.intent;
    const stage = (
      intent === "train" || intent === "profile" || intent === "clean" || intent === "transform"
        ? intent
        : input.workflow.currentStage.id
    ) as WorkflowStageId;
    cards.push({
      id: "dataset-selection",
      kind: "dataset_selection",
      stage,
      title: "选择训练数据集",
      description:
        "智能体需要一个明确的数据集才能配置训练。请选择源数据集，以保证运行可审计。",
      status: "blocked",
      facts: [
        { label: "缺少", value: "dataset_path" },
        { label: "意图", value: intent },
        { label: "候选数", value: String(missingDatasetCandidates.length) },
        ...missingDatasetCandidates.slice(0, 3).flatMap((candidate, index) => [
          { label: `数据集 ${index + 1}`, value: stringValue(candidate.dataset_path) ?? "-" },
          { label: `版本 ${index + 1}`, value: stringValue(candidate.dataset_version_id) ?? "-" },
          { label: `规模 ${index + 1}`, value: datasetCandidateFacts(candidate) },
        ]),
      ],
      actions: missingDatasetCandidates.slice(0, 5).map((candidate, index) =>
        action("select_training_dataset", `选择 ${datasetCandidateLabel(candidate)}`, {
          disabledReason:
            projectDisabled ?? (stringValue(candidate.dataset_path) ? undefined : "此数据集缺少路径。"),
          payload: {
            datasetPath: stringValue(candidate.dataset_path),
            datasetVersionId: stringValue(candidate.dataset_version_id),
            targetColumn: datasetCandidateTarget(candidate),
            intent,
            stage,
          },
          tone: index === 0 ? "primary" : "secondary",
        }),
      ),
    });
  }

  if (taskInspection) {
    const inspectionArtifactLabel =
      taskInspection.stage === "evaluate" && taskInspection.planPath
        ? "打开指标"
        : taskInspection.stage === "export" && taskInspection.planPath
          ? "打开报告"
        : taskInspection.planPath
          ? "打开计划"
          : "打开数据集";
    const inspectionArtifactDisabledReason =
      taskInspection.planPath || taskInspection.datasetPath
        ? undefined
        : "没有可用的已保存数据集、计划或指标路径。";

    cards.push({
      id: "task-state-inspector",
      kind: "task_state_inspector",
      stage: taskInspection.stage,
      title: taskInspection.title,
      description: taskInspection.description,
      artifactPath: taskInspection.planPath ?? taskInspection.datasetPath,
      status: "attention",
      facts: taskInspection.facts,
      actions: [
        ...(taskInspection.stage === "evaluate"
          ? [
              action("retry_evaluation_report", "重试评估", {
                disabledReason: projectDisabled,
                payload: { stage: "evaluate" },
                tone: "primary" as const,
              }),
            ]
          : []),
        ...(taskInspection.stage === "export"
          ? [
              action("retry_export_bundle", "重试导出", {
                disabledReason: projectDisabled,
                payload: { stage: "export" },
                tone: "primary" as const,
              }),
            ]
          : []),
        ...(taskInspection.stage === "learn"
          ? [
              action("retry_lesson_extraction", "重试沉淀", {
                disabledReason: projectDisabled,
                payload: { stage: "learn" },
                tone: "primary" as const,
              }),
            ]
          : []),
        action("inspect_logs", "查看日志", {
          payload: { taskId: taskInspection.taskId },
          tone: ["evaluate", "export", "learn"].includes(taskInspection.stage) ? "secondary" : "primary",
        }),
        action("open_artifact", inspectionArtifactLabel, {
          disabledReason: inspectionArtifactDisabledReason,
          payload: { path: taskInspection.planPath ?? taskInspection.datasetPath },
          tone: "secondary",
        }),
        action("abandon_task_state", "放弃状态", {
          disabledReason: taskInspection.taskId ? undefined : "没有可用的已保存任务状态 id。",
          payload: { taskId: taskInspection.taskId, stage: taskInspection.stage },
          tone: "secondary",
        }),
      ],
    });
  }

  if (retryableEvaluationFailure && !cards.some((card) => card.id === "task-state-inspector")) {
    cards.push({
      id: "evaluation-retry",
      kind: "evaluation_report",
      stage: "evaluate",
      title: "评估报告失败",
      description:
        "训练后的评估/报告步骤失败。修复缺失的指标或报告依赖后，从已保存的评估状态重试。",
      status: "attention",
      facts: [
        { label: "阶段", value: "评估" },
        { label: "下一步", value: "重试已保存的评估/报告步骤。" },
      ],
      actions: [
        action("retry_evaluation_report", "重试评估", {
          disabledReason: projectDisabled,
          payload: { stage: "evaluate" },
          tone: "primary",
        }),
      ],
    });
  }

  if (retryableExportFailure && !cards.some((card) => card.id === "task-state-inspector")) {
    cards.push({
      id: "export-retry",
      kind: "export_bundle",
      stage: "export",
      title: "导出包失败",
      description:
        "模型交接包写入失败。修复缺失的产物或文件系统访问后重试导出。",
      status: "attention",
      facts: [
        { label: "阶段", value: "导出" },
        { label: "下一步", value: "重试已保存的导出包步骤。" },
      ],
      actions: [
        action("retry_export_bundle", "重试导出", {
          disabledReason: projectDisabled,
          payload: { stage: "export" },
          tone: "primary",
        }),
      ],
    });
  }

  if (retryableLearnFailure && !cards.some((card) => card.id === "task-state-inspector")) {
    cards.push({
      id: "learn-retry",
      kind: "lesson_review",
      stage: "learn",
      title: "经验沉淀失败",
      description:
        "经验提取步骤无法读取或转换已保存的证据。恢复会话证据后重试沉淀。",
      status: "attention",
      facts: [
        { label: "阶段", value: "沉淀" },
        { label: "下一步", value: "从已保存的会话上下文重试经验提取。" },
      ],
      actions: [
        action("retry_lesson_extraction", "重试沉淀", {
          disabledReason: projectDisabled,
          payload: { stage: "learn" },
          tone: "primary",
        }),
      ],
    });
  }

  if (signals.has("dataset_summary") || input.workflow.currentStage.id === "ingest") {
    cards.push({
      id: "dataset-summary",
      kind: "dataset_summary",
      stage: "ingest",
      title: datasetRegistryPath ? "数据集已登记" : "数据集接入",
      description:
        "在画像、清洗、变换或训练之前，先查看当前数据集的来源、版本与结构快照。",
      artifactPath: datasetRegistryPath,
      status: datasetRegistryPath ? "ready" : "attention",
      facts: [
        { label: "数据集", value: registeredDatasetPath || input.activeFile || "-" },
        { label: "版本", value: datasetVersionId ?? "未登记" },
        {
          label: "规模",
          value:
            datasetRowCount !== undefined && datasetColumnCount !== undefined
              ? `${datasetRowCount} 行 × ${datasetColumnCount} 列`
              : "未知",
        },
        { label: "采样", value: datasetSampleStrategy ?? "未知" },
        {
          label: "列",
          value: datasetColumns.length > 0 ? datasetColumns.map(String).join(", ") : "未检查",
        },
      ],
      actions: [
        action("open_artifact", "打开登记表", {
          disabledReason: datasetRegistryPath ? undefined : "没有可用的数据集登记产物。",
          payload: { path: datasetRegistryPath },
          tone: "secondary",
        }),
        action("generate_profile", "生成画像", {
          disabledReason: projectDisabled ?? disabledWithoutDataset(registeredDatasetPath),
          tone: "primary",
        }),
      ],
    });
  }

  if (
    input.workflow.currentStage.id === "ingest" ||
    input.workflow.currentStage.id === "profile" ||
    signals.has("data_quality") ||
    input.mode === "analysis"
  ) {
    cards.push({
      id: "data-quality",
      kind: "data_quality",
      stage: "profile",
      title: dataProfilePath ? "数据质量画像已就绪" : "为当前数据集生成画像",
      description: dataProfilePath
        ? "查看列级质量画像，然后基于同一数据集生成预处理计划。"
        : "在决定如何清洗、变换或训练之前，先为该数据集生成数据质量画像。",
      artifactPath: dataProfilePath,
      status: dataProfilePath ? "complete" : "ready",
      facts: [
        { label: "数据集", value: activeDatasetPath || input.activeFile || "-" },
        { label: "画像", value: dataProfilePath ?? "未生成" },
      ],
      actions: [
        action("generate_profile", dataProfilePath ? "刷新画像" : "生成画像", {
          disabledReason: projectDisabled ?? datasetDisabled,
          tone: dataProfilePath ? "secondary" : "primary",
        }),
        action("generate_preprocessing_plan", planPath ? "刷新计划" : "生成计划", {
          disabledReason: projectDisabled ?? datasetDisabled,
          tone: "secondary",
        }),
      ],
    });
  }

  if (planPath || input.workflow.approval?.stage === "transform" || signals.has("preprocessing_plan")) {
    const isPendingApproval = Boolean(input.workflow.approval?.stage === "transform" && !plannedDatasetPath);
    const planSignalProps = signals.get("preprocessing_plan")?.props;
    const featureControls = buildFeatureSelectionControls(
      stringListFromProps(planSignalProps, "feature_columns"),
      stringListFromProps(planSignalProps, "drop_columns"),
    );
    cards.push({
      id: "preprocessing-plan",
      kind: "preprocessing_plan",
      stage: "transform",
      title: retryableTransformFailure
        ? "变换执行失败"
        : failedTransformNeedsRevision
        ? "预处理计划需要修订"
        : input.workflow.approval?.title ?? "审核预处理计划",
      description:
        retryableTransformFailure
          ? "批准后的预处理运行失败。从已保存的变换状态重试；若问题出在计划本身，请刷新计划。"
          : failedTransformNeedsRevision
          ? "审批检查点被拒绝或变换失败。请先刷新计划，再尝试执行。"
          : input.workflow.approval?.description ??
            "执行变换前，先检查生成的丢弃列、填充器、编码器与输出路径。",
      artifactPath: planPath,
      status: plannedDatasetPath ? "complete" : failedTransformNeedsRevision || retryableTransformFailure ? "attention" : "blocked",
      facts: [
        { label: "计划", value: planPath ?? "未选择计划" },
        { label: "输出", value: plannedDatasetPath ?? "等待执行" },
      ],
      ...(featureControls.length > 0 ? { controls: featureControls } : {}),
      actions: [
        action("open_artifact", "打开计划", {
          disabledReason: planPath ? undefined : "没有可用的预处理计划产物。",
          payload: { path: planPath },
          tone: "secondary",
        }),
        ...(featureControls.length > 0
          ? [
              action("apply_feature_selection", "应用特征选择", {
                disabledReason: projectDisabled ?? datasetDisabled,
                tone: "secondary",
              }),
            ]
          : []),
        failedTransformNeedsRevision
          ? action("generate_preprocessing_plan", "刷新计划", {
              disabledReason: projectDisabled ?? datasetDisabled,
              tone: "primary",
            })
          : retryableTransformFailure
          ? action("retry_transform", "重试变换", {
              disabledReason: projectDisabled ?? (planPath ? undefined : "没有可用的预处理计划产物。"),
              payload: {
                preprocessingPlanPath: planPath,
                stage: input.workflow.currentStage.resumeStage ?? "transform",
              },
              tone: "primary",
            })
          : action(
              isPendingApproval ? "approve_preprocessing_plan" : "execute_preprocessing_plan",
              plannedDatasetPath ? "重新执行计划" : "批准并执行",
              {
                disabledReason: projectDisabled ?? (planPath ? undefined : "没有可用的预处理计划产物。"),
                payload: {
                  approvalId: input.workflow.approval?.id,
                  ...(input.workflow.approval?.origin
                    ? { approvalOrigin: input.workflow.approval.origin }
                    : {}),
                  preprocessingPlanPath: planPath,
                },
                tone: "primary",
              },
            ),
        ...(isPendingApproval
          ? [
              action("revise_preprocessing_plan", "修订计划", {
                disabledReason: projectDisabled ?? (planPath ? undefined : "没有可用的预处理计划产物。"),
                payload: { approvalId: input.workflow.approval?.id, preprocessingPlanPath: planPath },
                tone: "secondary" as const,
              }),
            ]
          : []),
        ...(retryableTransformFailure
          ? [
              action("generate_preprocessing_plan", "刷新计划", {
                disabledReason: projectDisabled ?? datasetDisabled,
                tone: "secondary" as const,
              }),
            ]
          : []),
      ],
    });
  }

  if (signals.has("transformation_report")) {
    const transformSignal = signals.get("transformation_report");
    // 执行计划会写出同名的 .json 明细与 .md 报告，事件里后到的 .md 会覆盖 signal。
    // 结构化列对照只存在于 .json，因此两个入口都按扩展名归一化后分别给出。
    const transformArtifactPath = transformSignal?.artifactPath;
    const transformDetailPath = transformArtifactPath?.replace(/\.md$/, ".json");
    const transformReportPath = transformArtifactPath?.replace(/\.json$/, ".md");
    const transformOutputPath =
      stringProp(transformSignal?.props, "output_dataset_path") ?? plannedDatasetPath;
    const transformSourcePath = stringProp(transformSignal?.props, "dataset_path");
    cards.push({
      id: "transformation-report",
      kind: "transformation_report",
      stage: "transform",
      title: "变换结果复核",
      description:
        "对照变换前后的列与形状，确认丢弃、填充与编码结果符合预期，再把数据集交给训练。",
      artifactPath: transformDetailPath,
      status: transformOutputPath ? "complete" : "attention",
      facts: [
        { label: "源数据", value: transformSourcePath ?? "-" },
        { label: "输出", value: transformOutputPath ?? "等待执行" },
        { label: "明细", value: transformDetailPath ?? "未生成" },
      ],
      actions: [
        action("open_artifact", "打开列对照", {
          disabledReason: transformDetailPath ? undefined : "没有可用的变换明细产物。",
          payload: { path: transformDetailPath },
          tone: "primary",
        }),
        action("open_artifact", "打开变换报告", {
          disabledReason: transformReportPath ? undefined : "没有可用的变换报告产物。",
          payload: { path: transformReportPath },
          tone: "secondary",
        }),
        action("open_artifact", "打开输出数据集", {
          disabledReason: transformOutputPath ? undefined : "没有可用的变换后数据集产物。",
          payload: { path: transformOutputPath },
          tone: "secondary",
        }),
      ],
    });
  }

  if (plannedDatasetPath || signals.has("planned_dataset")) {
    cards.push({
      id: "planned-dataset",
      kind: "planned_dataset",
      stage: "train",
      title: "变换后数据集已就绪",
      description: "变换后的数据集现在可作为 sklearn 对比运行的训练输入。",
      artifactPath: plannedDatasetPath,
      status: "ready",
      facts: [
        { label: "数据集", value: plannedDatasetPath ?? input.trainingDatasetPath ?? "-" },
        { label: "目标列", value: effectiveTargetColumn || "未选择" },
      ],
      actions: [
        action("open_artifact", "打开数据集", {
          disabledReason: plannedDatasetPath ? undefined : "没有可用的变换后数据集产物。",
          payload: { path: plannedDatasetPath },
          tone: "secondary",
        }),
        action("open_training", "打开训练", {
          disabledReason: projectDisabled,
          tone: "primary",
        }),
      ],
    });
  }

  if (!missingDatasetCommand && (plannedDatasetPath || input.workflow.currentStage.id === "train" || input.mode === "machine-learning")) {
    const trainingDataset = plannedDatasetPath ?? effectiveTrainingDatasetPath ?? input.activeFile;
    const targetControls = buildTargetColumnControls(targetCandidateColumns, effectiveTargetColumn);
    cards.push({
      id: "training-config",
      kind: "training_config",
      stage: "train",
      title: retryableTrainingFailure ? "训练执行失败" : "训练配置",
      description: retryableTrainingFailure
        ? "sklearn 训练运行失败。从已保存的训练状态重试，或先调整数据集、目标列、GPU 或预处理计划。"
        : "使用当前数据集与目标列，启动一次可复现的 sklearn 训练运行。",
      artifactPath: trainingDataset,
      status: retryableTrainingFailure ? "attention" : effectiveTargetColumn ? "ready" : "attention",
      facts: [
        { label: "数据集", value: trainingDataset },
        // 有选择器时目标列由控件自身呈现，不再重复一条只读事实
        ...(targetControls.length > 0
          ? []
          : [{ label: "目标列", value: effectiveTargetColumn || "缺失" }]),
        { label: "计划", value: planPath ?? "无" },
      ],
      ...(targetControls.length > 0 ? { controls: targetControls } : {}),
      actions: [
        action("open_training", "打开训练", {
          disabledReason: projectDisabled,
          tone: "secondary",
        }),
        retryableTrainingFailure
          ? action("retry_sklearn_training", "重试训练", {
              disabledReason: projectDisabled,
              payload: { stage: input.workflow.currentStage.resumeStage ?? "train" },
              tone: "primary",
            })
          : action("start_sklearn_training", "启动 sklearn", {
              disabledReason:
                projectDisabled ??
                (effectiveTargetColumn ? undefined : "训练前请选择或推断一个目标列。") ??
                disabledWithoutDataset(trainingDataset),
              payload: {
                path: trainingDataset,
                datasetPath: trainingDataset,
                preprocessingPlanPath: planPath,
                targetColumn: effectiveTargetColumn,
              },
              tone: "primary",
            }),
      ],
    });
  }

  if (
    !missingRunCommand &&
    (signals.has("model_comparison") || signals.has("evaluation_report") || input.workflow.currentStage.id === "evaluate")
  ) {
    cards.push({
      id: "model-comparison",
      kind: "model_comparison",
      stage: "evaluate",
      title: "模型对比",
      description:
        "在重新生成报告或进入诊断之前，检查所选实验的指标、候选模型对比与产物路径。",
      artifactPath: evaluationMetricsPath,
      status: evaluationMetricsPath ? "ready" : "attention",
      facts: [
        { label: "实验", value: evaluationExperimentId ?? "-" },
        { label: "数据集", value: evaluationDatasetPath ?? input.trainingDatasetPath ?? "-" },
        { label: "目标列", value: evaluationTargetColumn ?? input.suggestedTargetColumn ?? "-" },
        { label: "最佳模型", value: evaluationBestModel ?? "-" },
      ],
      actions: [
        action("open_training", "打开训练", {
          disabledReason: projectDisabled,
          tone: "secondary",
        }),
        action("open_artifact", "打开指标", {
          disabledReason: evaluationMetricsPath ? undefined : "没有可用的指标产物。",
          payload: { path: evaluationMetricsPath },
          tone: "primary",
        }),
      ],
    });

    cards.push({
      id: "evaluation-report",
      kind: "evaluation_report",
      stage: "evaluate",
      title: evaluationReportPath ? "评估报告已就绪" : "评估报告缺失",
      description: evaluationReportPath
        ? "打开已生成的模型评估报告，或从已保存的实验产物重新生成。"
        : "该实验有指标但尚无报告产物。请从所选运行重新生成报告。",
      artifactPath: evaluationReportPath,
      status: evaluationReportPath ? "ready" : "attention",
      facts: [
        { label: "报告", value: evaluationReportPath ?? "未生成" },
        { label: "指标", value: evaluationMetricsPath ?? "-" },
        { label: "模型", value: evaluationModelPath ?? "-" },
        { label: "样本", value: evaluationPredictionSamplesPath ?? "-" },
      ],
      actions: [
        action("open_artifact", "打开报告", {
          disabledReason: evaluationReportPath ? undefined : "没有可用的评估报告产物。",
          payload: { path: evaluationReportPath },
          tone: evaluationReportPath ? "primary" : "secondary",
        }),
        action("regenerate_evaluation_report", evaluationReportPath ? "重新生成报告" : "生成报告", {
          disabledReason:
            projectDisabled ?? (evaluationExperimentId ? undefined : "没有可用于生成报告的实验 id。"),
          payload: evaluationExperimentId ? { experimentId: evaluationExperimentId } : undefined,
          tone: evaluationReportPath ? "secondary" : "primary",
        }),
      ],
    });
  }

  if (
    !missingRunCommand &&
    (signals.has("error_analysis") || signals.has("prediction_samples") || input.workflow.currentStage.id === "diagnose")
  ) {
    cards.push({
      id: "error-analysis",
      kind: "error_analysis",
      stage: "diagnose",
      title: "误差分析",
      description:
        "在决定是否调整特征、预处理或注意事项之前，检查类别级误差集中度与最强混淆方向。",
      artifactPath: diagnosisMetricsPath,
      status: diagnosisMetricsPath ? "ready" : "attention",
      facts: [
        { label: "实验", value: diagnosisExperimentId ?? "-" },
        { label: "数据集", value: diagnosisDatasetPath ?? input.trainingDatasetPath ?? "-" },
        { label: "最差类别", value: diagnosisWorstClass ?? "无" },
        { label: "主要混淆", value: diagnosisMainConfusion ?? "无" },
        { label: "误差行数", value: String(diagnosisErrorCount ?? 0) },
        { label: "切片数", value: String(diagnosisSliceCount ?? 0) },
      ],
      actions: [
        action("open_training", "打开训练", {
          disabledReason: projectDisabled,
          tone: "secondary",
        }),
        action("open_artifact", "打开指标", {
          disabledReason: diagnosisMetricsPath ? undefined : "没有可用的指标产物。",
          payload: { path: diagnosisMetricsPath },
          tone: "primary",
        }),
        action("open_artifact", "打开报告", {
          disabledReason: diagnosisReportPath ? undefined : "没有可用的评估报告产物。",
          payload: { path: diagnosisReportPath },
          tone: "secondary",
        }),
      ],
    });

    cards.push({
      id: "prediction-samples",
      kind: "prediction_samples",
      stage: "diagnose",
      title: "预测样本",
      description:
        diagnosisRecommendation ??
        "打开行级预测样本，查看诊断摘要背后被误分类的样本及其特征值。",
      artifactPath: diagnosisSamplesPath,
      status: diagnosisSamplesPath ? "ready" : "attention",
      facts: [
        { label: "样本", value: diagnosisSamplesPath ?? "未生成" },
        { label: "目标列", value: diagnosisTargetColumn ?? input.suggestedTargetColumn ?? "-" },
        { label: "最差类别", value: diagnosisWorstClass ?? "无" },
        { label: "建议", value: diagnosisRecommendation ?? "查看聚焦实验的诊断结果。" },
      ],
      actions: [
        action("open_artifact", "打开样本", {
          disabledReason: diagnosisSamplesPath ? undefined : "没有可用的预测样本产物。",
          payload: { path: diagnosisSamplesPath },
          tone: "primary",
        }),
        action("open_training", "打开诊断", {
          disabledReason: projectDisabled,
          tone: "secondary",
        }),
      ],
    });
  }

  if (signals.has("iteration_proposal") || input.workflow.currentStage.id === "iterate") {
    cards.push({
      id: "iteration-proposal",
      kind: "iteration_proposal",
      stage: "iterate",
      title: "迭代建议",
      description:
        iterationRecommendation ??
        "查看所选实验的诊断结果，在开始下一次运行前决定是否调整预处理、特征或训练。",
      artifactPath: iterationMetricsPath,
      status: "attention",
      facts: [
        { label: "实验", value: iterationExperimentId ?? "-" },
        { label: "数据集", value: iterationDatasetPath ?? input.trainingDatasetPath ?? "-" },
        { label: "目标列", value: iterationTargetColumn ?? input.suggestedTargetColumn ?? "-" },
        { label: "最差类别", value: iterationWorstClass ?? "无" },
        { label: "主要混淆", value: iterationMainConfusion ?? "无" },
        {
          label: "下一步",
          value: iterationNextActions.at(0) ? String(iterationNextActions.at(0)) : "重新训练前先查看诊断结果。",
        },
      ],
      actions: [
        action("open_artifact", "打开指标", {
          disabledReason: iterationMetricsPath ? undefined : "没有可用的指标产物。",
          payload: { path: iterationMetricsPath },
          tone: "primary",
        }),
        action("open_artifact", "打开报告", {
          disabledReason: iterationReportPath ? undefined : "没有可用的评估报告产物。",
          payload: { path: iterationReportPath },
          tone: "secondary",
        }),
        action("open_artifact", "打开样本", {
          disabledReason: iterationSamplesPath ? undefined : "没有可用的预测样本产物。",
          payload: { path: iterationSamplesPath },
          tone: "secondary",
        }),
        action("open_artifact", "打开计划", {
          disabledReason: iterationPlanPath ? undefined : "没有可用的预处理计划产物。",
          payload: { path: iterationPlanPath },
          tone: "secondary",
        }),
        action("open_training", "打开训练", {
          disabledReason: projectDisabled,
          tone: "secondary",
        }),
      ],
    });
  }

  if (!missingRunCommand && (signals.has("export_bundle") || input.workflow.currentStage.id === "export")) {
    cards.push({
      id: "export-bundle",
      kind: "export_bundle",
      stage: "export",
      title: exportBundlePath ? "导出包已就绪" : "准备导出包",
      description: exportBundleReady
        ? "将所选运行打包为可复现的交接包，包含模型、指标、报告与可选诊断。"
        : "缺少必要的运行产物。导出交接包前，请重新生成报告或恢复缺失文件。",
      artifactPath: exportBundlePath ?? exportReportPath,
      status: exportBundleReady ? "ready" : "attention",
      facts: [
        { label: "实验", value: exportExperimentId ?? "-" },
        { label: "数据集", value: exportDatasetPath ?? input.trainingDatasetPath ?? "-" },
        { label: "目标列", value: exportTargetColumn ?? input.suggestedTargetColumn ?? "-" },
        { label: "报告", value: exportReportPath ?? "缺失" },
        { label: "导出包", value: exportBundlePath ?? "未导出" },
        {
          label: "缺失项",
          value: exportMissingArtifacts.length > 0 ? exportMissingArtifacts.map(String).join(", ") : "无",
        },
      ],
      actions: [
        action("open_artifact", exportBundlePath ? "打开导出包" : "打开报告", {
          disabledReason:
            exportBundlePath || exportReportPath ? undefined : "没有可用的导出包或报告产物。",
          payload: { path: exportBundlePath ?? exportReportPath },
          tone: exportBundlePath ? "primary" : "secondary",
        }),
        action("export_run_bundle", exportBundlePath ? "重新导出包" : "导出包", {
          disabledReason:
            projectDisabled ??
            (exportExperimentId ? undefined : "没有可用于导出包的实验 id。") ??
            (exportBundleReady ? undefined : "缺少必要的模型、指标或报告产物。"),
          payload: exportExperimentId ? { experimentId: exportExperimentId } : undefined,
          tone: exportBundleReady ? "primary" : "secondary",
        }),
        action("open_training", "打开训练", {
          disabledReason: projectDisabled,
          tone: "secondary",
        }),
      ],
    });

    cards.push({
      id: "export-artifacts",
      kind: "evaluation_report",
      stage: "export",
      title: "交接产物清单",
      description: "在创建或刷新归档之前，检查将纳入交接的产物。",
      artifactPath: exportReportPath,
      status: exportBundleReady ? "ready" : "attention",
      facts: [
        { label: "指标", value: exportMetricsPath ?? "缺失" },
        { label: "模型", value: exportModelPath ?? "缺失" },
        { label: "样本", value: exportSamplesPath ?? "可选" },
        { label: "计划", value: exportPlanPath ?? "可选" },
      ],
      actions: [
        action("open_artifact", "打开报告", {
          disabledReason: exportReportPath ? undefined : "没有可用的评估报告产物。",
          payload: { path: exportReportPath },
          tone: "primary",
        }),
        action("open_artifact", "打开指标", {
          disabledReason: exportMetricsPath ? undefined : "没有可用的指标产物。",
          payload: { path: exportMetricsPath },
          tone: "secondary",
        }),
      ],
    });
  }

  if (signals.has("lesson_review") || input.workflow.currentStage.id === "learn") {
    cards.push({
      id: "lesson-review",
      kind: "lesson_review",
      stage: "learn",
      title: "习得规则审核",
      description:
        lessonHasExtractableCandidates === false
          ? "本次会话有证据，但当前提取器尚未找到可复用的规则候选。"
          : "从当前会话证据中提取可审核的经验候选，采纳前先在「自进化知识」中查看。",
      artifactPath: lessonSourceArtifacts.at(-1) ? String(lessonSourceArtifacts.at(-1)) : undefined,
      status: lessonHasExtractableCandidates === false ? "attention" : "ready",
      facts: [
        { label: "来源会话", value: lessonSourceSessionId ?? "-" },
        { label: "事件数", value: String(lessonSourceEventCount ?? 0) },
        { label: "候选数", value: String(lessonCandidateCount ?? 0) },
        { label: "高置信数", value: String(lessonHighConfidenceCount ?? 0) },
        { label: "最新事件", value: lessonLatestEventType ?? "-" },
      ],
      actions: [
        action("extract_lessons", "提取经验", {
          disabledReason:
            projectDisabled ??
            (lessonSourceSessionId ? undefined : "没有可用于经验提取的来源会话。"),
          payload: lessonSourceSessionId ? { sourceSessionId: lessonSourceSessionId } : undefined,
          tone: "primary",
        }),
        action("open_artifact", "打开证据", {
          disabledReason: lessonSourceArtifacts.at(-1) ? undefined : "没有可用的来源产物证据。",
          payload: { path: lessonSourceArtifacts.at(-1) ? String(lessonSourceArtifacts.at(-1)) : undefined },
          tone: "secondary",
        }),
      ],
    });
  }

  const requested = input.workflow.component;
  if (requested && !cards.some((card) => card.kind === requested.kind)) {
    cards.push({
      id: `requested-${requested.kind}`,
      kind: requested.kind,
      stage: requested.stage,
      title: requested.title,
      description: "智能体请求了这个上下文组件。打开产物以查看完整详情。",
      artifactPath: requested.artifactPath,
      status: "ready",
      facts: [{ label: "产物", value: requested.artifactPath ?? "暂无产物" }],
      actions: [
        action("open_artifact", "打开产物", {
          disabledReason: requested.artifactPath ? undefined : "暂无可用的产物路径。",
          payload: { path: requested.artifactPath },
          tone: "primary",
        }),
      ],
    });
  }

  return cards;
}
