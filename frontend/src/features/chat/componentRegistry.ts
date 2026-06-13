import type { AgentComponentKind, AgentStreamEvent, WorkflowStageId } from "./types";
import type { TaskStateInspection } from "./taskStateInspector";
import type { WorkflowState } from "./workflowState";

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
    experimentId?: string;
    intent?: string;
    sourceSessionId?: string;
    taskId?: string;
    stage?: WorkflowStageId;
  };
  disabledReason?: string;
  tone?: "primary" | "secondary";
};

export type CockpitComponentCard = {
  id: string;
  kind: AgentComponentKind | "active_dataset" | string;
  stage: WorkflowStageId;
  title: string;
  description: string;
  artifactPath?: string;
  status: "ready" | "attention" | "blocked" | "complete";
  facts: Array<{ label: string; value: string }>;
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

function runCandidateLabel(candidate: Record<string, unknown>) {
  return stringValue(candidate.experiment_id) ?? "Unknown run";
}

function runCandidateFacts(candidate: Record<string, unknown>) {
  const experimentId = stringValue(candidate.experiment_id) ?? "-";
  const datasetPath = stringValue(candidate.dataset_path) ?? "-";
  const targetColumn = stringValue(candidate.target_column) ?? "-";
  const bestModelName = stringValue(candidate.best_model_name) ?? "-";
  return `${experimentId} | ${datasetPath} | target ${targetColumn} | ${bestModelName}`;
}

function datasetCandidateLabel(candidate: Record<string, unknown>) {
  return stringValue(candidate.dataset_path) ?? "Unknown dataset";
}

function datasetCandidateTarget(candidate: Record<string, unknown>) {
  const targetCandidates = stringValue(candidate.target_candidates);
  return targetCandidates?.split(",").map((item) => item.trim()).find(Boolean);
}

function datasetCandidateFacts(candidate: Record<string, unknown>) {
  const datasetPath = stringValue(candidate.dataset_path) ?? "-";
  const datasetVersionId = stringValue(candidate.dataset_version_id) ?? "-";
  const rowCount = stringValue(candidate.row_count) ?? "-";
  const columnCount = stringValue(candidate.column_count) ?? "-";
  const targetCandidates = stringValue(candidate.target_candidates) ?? "-";
  return `${datasetPath} | ${datasetVersionId} | ${rowCount} rows x ${columnCount} columns | targets ${targetCandidates}`;
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
    return { kind: "preprocessing_plan", stage: "transform", artifactPath: event.artifact.path };
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
    return { kind: "transformation_report", stage: "transform", artifactPath: event.artifact.path };
  }
  if (text.includes("data_quality") || text.includes("quality profile")) {
    return { kind: "data_quality", stage: "profile", artifactPath: event.artifact.path };
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
  return projectId ? undefined : "Open or create a project before running this action.";
}

function disabledWithoutDataset(datasetPath?: string) {
  return isDatasetPath(datasetPath) ? undefined : "Select a dataset file before running this action.";
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
      title: "Select experiment run",
      description:
        "The agent found multiple completed runs. Choose the run to continue before opening evaluation, diagnosis, or export cards.",
      status: "blocked",
      facts: [
        { label: "Missing", value: "experiment_id" },
        { label: "Intent", value: intent },
        { label: "Candidates", value: String(missingRunCandidates.length) },
        ...missingRunCandidates.slice(0, 3).map((candidate, index) => ({
          label: `Run ${index + 1}`,
          value: runCandidateFacts(candidate),
        })),
      ],
      actions: missingRunCandidates.slice(0, 5).map((candidate, index) =>
        action("select_experiment_run", `Use ${runCandidateLabel(candidate)}`, {
          disabledReason: projectDisabled ?? (stringValue(candidate.experiment_id) ? undefined : "This run is missing an id."),
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
      title: "Select training dataset",
      description:
        "The agent needs a concrete dataset before configuring training. Choose the source dataset to keep the run auditable.",
      status: "blocked",
      facts: [
        { label: "Missing", value: "dataset_path" },
        { label: "Intent", value: intent },
        { label: "Candidates", value: String(missingDatasetCandidates.length) },
        ...missingDatasetCandidates.slice(0, 3).map((candidate, index) => ({
          label: `Dataset ${index + 1}`,
          value: datasetCandidateFacts(candidate),
        })),
      ],
      actions: missingDatasetCandidates.slice(0, 5).map((candidate, index) =>
        action("select_training_dataset", `Use ${datasetCandidateLabel(candidate)}`, {
          disabledReason:
            projectDisabled ?? (stringValue(candidate.dataset_path) ? undefined : "This dataset is missing a path."),
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
        ? "Open Metrics"
        : taskInspection.stage === "export" && taskInspection.planPath
          ? "Open Report"
        : taskInspection.planPath
          ? "Open Plan"
          : "Open Dataset";
    const inspectionArtifactDisabledReason =
      taskInspection.planPath || taskInspection.datasetPath
        ? undefined
        : "No saved dataset, plan, or metrics path is available.";

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
              action("retry_evaluation_report", "Retry Evaluation", {
                disabledReason: projectDisabled,
                payload: { stage: "evaluate" },
                tone: "primary" as const,
              }),
            ]
          : []),
        ...(taskInspection.stage === "export"
          ? [
              action("retry_export_bundle", "Retry Export", {
                disabledReason: projectDisabled,
                payload: { stage: "export" },
                tone: "primary" as const,
              }),
            ]
          : []),
        ...(taskInspection.stage === "learn"
          ? [
              action("retry_lesson_extraction", "Retry Learning", {
                disabledReason: projectDisabled,
                payload: { stage: "learn" },
                tone: "primary" as const,
              }),
            ]
          : []),
        action("inspect_logs", "Inspect Logs", {
          payload: { taskId: taskInspection.taskId },
          tone: ["evaluate", "export", "learn"].includes(taskInspection.stage) ? "secondary" : "primary",
        }),
        action("open_artifact", inspectionArtifactLabel, {
          disabledReason: inspectionArtifactDisabledReason,
          payload: { path: taskInspection.planPath ?? taskInspection.datasetPath },
          tone: "secondary",
        }),
        action("abandon_task_state", "Abandon State", {
          disabledReason: taskInspection.taskId ? undefined : "No saved task state id is available.",
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
      title: "Evaluation report failed",
      description:
        "The evaluation/report step failed after training. Retry from the saved evaluation state after repairing missing metrics or report dependencies.",
      status: "attention",
      facts: [
        { label: "Stage", value: "Evaluate" },
        { label: "Next", value: "Retry the saved evaluation/report step." },
      ],
      actions: [
        action("retry_evaluation_report", "Retry Evaluation", {
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
      title: "Export bundle failed",
      description:
        "The model handoff bundle could not be written. Retry export after repairing missing artifacts or filesystem access.",
      status: "attention",
      facts: [
        { label: "Stage", value: "Export" },
        { label: "Next", value: "Retry the saved export bundle step." },
      ],
      actions: [
        action("retry_export_bundle", "Retry Export", {
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
      title: "Learning extraction failed",
      description:
        "The lesson extraction step could not read or convert the saved evidence. Retry learning after restoring the session evidence.",
      status: "attention",
      facts: [
        { label: "Stage", value: "Learn" },
        { label: "Next", value: "Retry lesson extraction from the saved session context." },
      ],
      actions: [
        action("retry_lesson_extraction", "Retry Learning", {
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
      title: datasetRegistryPath ? "Dataset registered" : "Dataset ingest",
      description:
        "Review the active dataset source, version, and schema snapshot before profiling, cleaning, transforming, or training.",
      artifactPath: datasetRegistryPath,
      status: datasetRegistryPath ? "ready" : "attention",
      facts: [
        { label: "Dataset", value: registeredDatasetPath || input.activeFile || "-" },
        { label: "Version", value: datasetVersionId ?? "Not registered" },
        {
          label: "Shape",
          value:
            datasetRowCount !== undefined && datasetColumnCount !== undefined
              ? `${datasetRowCount} rows x ${datasetColumnCount} columns`
              : "Unknown",
        },
        { label: "Sample", value: datasetSampleStrategy ?? "Unknown" },
        {
          label: "Columns",
          value: datasetColumns.length > 0 ? datasetColumns.map(String).join(", ") : "Not inspected",
        },
      ],
      actions: [
        action("open_artifact", "Open Registry", {
          disabledReason: datasetRegistryPath ? undefined : "No dataset registry artifact is available.",
          payload: { path: datasetRegistryPath },
          tone: "secondary",
        }),
        action("generate_profile", "Generate Profile", {
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
      title: dataProfilePath ? "Data quality profile ready" : "Profile the active dataset",
      description: dataProfilePath
        ? "Review the column-level quality profile, then generate a preprocessing plan from the same dataset."
        : "Create a data quality profile before deciding how to clean, transform, or train from this dataset.",
      artifactPath: dataProfilePath,
      status: dataProfilePath ? "complete" : "ready",
      facts: [
        { label: "Dataset", value: activeDatasetPath || input.activeFile || "-" },
        { label: "Profile", value: dataProfilePath ?? "Not generated" },
      ],
      actions: [
        action("generate_profile", dataProfilePath ? "Refresh Profile" : "Generate Profile", {
          disabledReason: projectDisabled ?? datasetDisabled,
          tone: dataProfilePath ? "secondary" : "primary",
        }),
        action("generate_preprocessing_plan", planPath ? "Refresh Plan" : "Generate Plan", {
          disabledReason: projectDisabled ?? datasetDisabled,
          tone: "secondary",
        }),
      ],
    });
  }

  if (planPath || input.workflow.approval?.stage === "transform" || signals.has("preprocessing_plan")) {
    const isPendingApproval = Boolean(input.workflow.approval?.stage === "transform" && !plannedDatasetPath);
    cards.push({
      id: "preprocessing-plan",
      kind: "preprocessing_plan",
      stage: "transform",
      title: retryableTransformFailure
        ? "Transform execution failed"
        : failedTransformNeedsRevision
        ? "Preprocessing plan needs revision"
        : input.workflow.approval?.title ?? "Review preprocessing plan",
      description:
        retryableTransformFailure
          ? "The preprocessing run failed after approval. Retry from the saved transform state, or refresh the plan if the failure came from the plan itself."
          : failedTransformNeedsRevision
          ? "The approval checkpoint was declined or the transform failed. Refresh the plan before attempting execution again."
          : input.workflow.approval?.description ??
            "Inspect the generated drops, imputers, encoders, and output path before executing the transform.",
      artifactPath: planPath,
      status: plannedDatasetPath ? "complete" : failedTransformNeedsRevision || retryableTransformFailure ? "attention" : "blocked",
      facts: [
        { label: "Plan", value: planPath ?? "No plan selected" },
        { label: "Output", value: plannedDatasetPath ?? "Waiting for execution" },
      ],
      actions: [
        action("open_artifact", "Open Plan", {
          disabledReason: planPath ? undefined : "No preprocessing plan artifact is available.",
          payload: { path: planPath },
          tone: "secondary",
        }),
        failedTransformNeedsRevision
          ? action("generate_preprocessing_plan", "Refresh Plan", {
              disabledReason: projectDisabled ?? datasetDisabled,
              tone: "primary",
            })
          : retryableTransformFailure
          ? action("retry_transform", "Retry Transform", {
              disabledReason: projectDisabled ?? (planPath ? undefined : "No preprocessing plan artifact is available."),
              payload: {
                preprocessingPlanPath: planPath,
                stage: input.workflow.currentStage.resumeStage ?? "transform",
              },
              tone: "primary",
            })
          : action(
              isPendingApproval ? "approve_preprocessing_plan" : "execute_preprocessing_plan",
              plannedDatasetPath ? "Re-run Plan" : "Approve & Execute",
              {
                disabledReason: projectDisabled ?? (planPath ? undefined : "No preprocessing plan artifact is available."),
                payload: { approvalId: input.workflow.approval?.id, preprocessingPlanPath: planPath },
                tone: "primary",
              },
            ),
        ...(isPendingApproval
          ? [
              action("revise_preprocessing_plan", "Revise Plan", {
                disabledReason: projectDisabled ?? (planPath ? undefined : "No preprocessing plan artifact is available."),
                payload: { approvalId: input.workflow.approval?.id, preprocessingPlanPath: planPath },
                tone: "secondary" as const,
              }),
            ]
          : []),
        ...(retryableTransformFailure
          ? [
              action("generate_preprocessing_plan", "Refresh Plan", {
                disabledReason: projectDisabled ?? datasetDisabled,
                tone: "secondary" as const,
              }),
            ]
          : []),
      ],
    });
  }

  if (plannedDatasetPath || signals.has("planned_dataset")) {
    cards.push({
      id: "planned-dataset",
      kind: "planned_dataset",
      stage: "train",
      title: "Planned dataset ready",
      description: "The transformed dataset can now become the active training input for sklearn comparison runs.",
      artifactPath: plannedDatasetPath,
      status: "ready",
      facts: [
        { label: "Dataset", value: plannedDatasetPath ?? input.trainingDatasetPath ?? "-" },
        { label: "Target", value: effectiveTargetColumn || "Not selected" },
      ],
      actions: [
        action("open_artifact", "Open Dataset", {
          disabledReason: plannedDatasetPath ? undefined : "No planned dataset artifact is available.",
          payload: { path: plannedDatasetPath },
          tone: "secondary",
        }),
        action("open_training", "Open Training", {
          disabledReason: projectDisabled,
          tone: "primary",
        }),
      ],
    });
  }

  if (!missingDatasetCommand && (plannedDatasetPath || input.workflow.currentStage.id === "train" || input.mode === "machine-learning")) {
    const trainingDataset = plannedDatasetPath ?? effectiveTrainingDatasetPath ?? input.activeFile;
    cards.push({
      id: "training-config",
      kind: "training_config",
      stage: "train",
      title: retryableTrainingFailure ? "Training execution failed" : "Training configuration",
      description: retryableTrainingFailure
        ? "The sklearn training run failed. Retry from the saved training state, or adjust the dataset, target, GPU, or preprocessing plan first."
        : "Use the current dataset and target column to start a reproducible sklearn training run.",
      artifactPath: trainingDataset,
      status: retryableTrainingFailure ? "attention" : effectiveTargetColumn ? "ready" : "attention",
      facts: [
        { label: "Dataset", value: trainingDataset },
        { label: "Target", value: effectiveTargetColumn || "Missing" },
        { label: "Plan", value: planPath ?? "None" },
      ],
      actions: [
        action("open_training", "Open Training", {
          disabledReason: projectDisabled,
          tone: "secondary",
        }),
        retryableTrainingFailure
          ? action("retry_sklearn_training", "Retry Training", {
              disabledReason: projectDisabled,
              payload: { stage: input.workflow.currentStage.resumeStage ?? "train" },
              tone: "primary",
            })
          : action("start_sklearn_training", "Start sklearn", {
              disabledReason:
                projectDisabled ??
                (effectiveTargetColumn ? undefined : "Choose or infer a target column before training.") ??
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
      title: "Model comparison",
      description:
        "Inspect the selected experiment metrics, candidate model comparison, and artifact paths before regenerating reports or moving into diagnosis.",
      artifactPath: evaluationMetricsPath,
      status: evaluationMetricsPath ? "ready" : "attention",
      facts: [
        { label: "Experiment", value: evaluationExperimentId ?? "-" },
        { label: "Dataset", value: evaluationDatasetPath ?? input.trainingDatasetPath ?? "-" },
        { label: "Target", value: evaluationTargetColumn ?? input.suggestedTargetColumn ?? "-" },
        { label: "Best model", value: evaluationBestModel ?? "-" },
      ],
      actions: [
        action("open_training", "Open Training", {
          disabledReason: projectDisabled,
          tone: "secondary",
        }),
        action("open_artifact", "Open Metrics", {
          disabledReason: evaluationMetricsPath ? undefined : "No metrics artifact is available.",
          payload: { path: evaluationMetricsPath },
          tone: "primary",
        }),
      ],
    });

    cards.push({
      id: "evaluation-report",
      kind: "evaluation_report",
      stage: "evaluate",
      title: evaluationReportPath ? "Evaluation report ready" : "Evaluation report missing",
      description: evaluationReportPath
        ? "Open the generated model evaluation report, or regenerate it from the saved experiment artifacts."
        : "This experiment has metrics but no report artifact yet. Regenerate the report from the selected run.",
      artifactPath: evaluationReportPath,
      status: evaluationReportPath ? "ready" : "attention",
      facts: [
        { label: "Report", value: evaluationReportPath ?? "Not generated" },
        { label: "Metrics", value: evaluationMetricsPath ?? "-" },
        { label: "Model", value: evaluationModelPath ?? "-" },
        { label: "Samples", value: evaluationPredictionSamplesPath ?? "-" },
      ],
      actions: [
        action("open_artifact", "Open Report", {
          disabledReason: evaluationReportPath ? undefined : "No evaluation report artifact is available.",
          payload: { path: evaluationReportPath },
          tone: evaluationReportPath ? "primary" : "secondary",
        }),
        action("regenerate_evaluation_report", evaluationReportPath ? "Regenerate Report" : "Generate Report", {
          disabledReason:
            projectDisabled ?? (evaluationExperimentId ? undefined : "No experiment id is available for report generation."),
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
      title: "Error analysis",
      description:
        "Inspect class-level error concentration and the strongest confusion direction before deciding whether to adjust features, preprocessing, or caveats.",
      artifactPath: diagnosisMetricsPath,
      status: diagnosisMetricsPath ? "ready" : "attention",
      facts: [
        { label: "Experiment", value: diagnosisExperimentId ?? "-" },
        { label: "Dataset", value: diagnosisDatasetPath ?? input.trainingDatasetPath ?? "-" },
        { label: "Worst class", value: diagnosisWorstClass ?? "None" },
        { label: "Main confusion", value: diagnosisMainConfusion ?? "None" },
        { label: "Error rows", value: String(diagnosisErrorCount ?? 0) },
        { label: "Slices", value: String(diagnosisSliceCount ?? 0) },
      ],
      actions: [
        action("open_training", "Open Training", {
          disabledReason: projectDisabled,
          tone: "secondary",
        }),
        action("open_artifact", "Open Metrics", {
          disabledReason: diagnosisMetricsPath ? undefined : "No metrics artifact is available.",
          payload: { path: diagnosisMetricsPath },
          tone: "primary",
        }),
        action("open_artifact", "Open Report", {
          disabledReason: diagnosisReportPath ? undefined : "No evaluation report artifact is available.",
          payload: { path: diagnosisReportPath },
          tone: "secondary",
        }),
      ],
    });

    cards.push({
      id: "prediction-samples",
      kind: "prediction_samples",
      stage: "diagnose",
      title: "Prediction samples",
      description:
        diagnosisRecommendation ??
        "Open row-level prediction samples to inspect misclassified examples and feature values behind the diagnostic summary.",
      artifactPath: diagnosisSamplesPath,
      status: diagnosisSamplesPath ? "ready" : "attention",
      facts: [
        { label: "Samples", value: diagnosisSamplesPath ?? "Not generated" },
        { label: "Target", value: diagnosisTargetColumn ?? input.suggestedTargetColumn ?? "-" },
        { label: "Worst class", value: diagnosisWorstClass ?? "None" },
        { label: "Recommendation", value: diagnosisRecommendation ?? "Review the focused experiment diagnostics." },
      ],
      actions: [
        action("open_artifact", "Open Samples", {
          disabledReason: diagnosisSamplesPath ? undefined : "No prediction samples artifact is available.",
          payload: { path: diagnosisSamplesPath },
          tone: "primary",
        }),
        action("open_training", "Open Diagnostics", {
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
      title: "Iteration proposal",
      description:
        iterationRecommendation ??
        "Review the selected experiment diagnostics and decide whether to adjust preprocessing, features, or training before starting another run.",
      artifactPath: iterationMetricsPath,
      status: "attention",
      facts: [
        { label: "Experiment", value: iterationExperimentId ?? "-" },
        { label: "Dataset", value: iterationDatasetPath ?? input.trainingDatasetPath ?? "-" },
        { label: "Target", value: iterationTargetColumn ?? input.suggestedTargetColumn ?? "-" },
        { label: "Worst class", value: iterationWorstClass ?? "None" },
        { label: "Main confusion", value: iterationMainConfusion ?? "None" },
        {
          label: "Next action",
          value: iterationNextActions.at(0) ? String(iterationNextActions.at(0)) : "Review diagnostics before retraining.",
        },
      ],
      actions: [
        action("open_artifact", "Open Metrics", {
          disabledReason: iterationMetricsPath ? undefined : "No metrics artifact is available.",
          payload: { path: iterationMetricsPath },
          tone: "primary",
        }),
        action("open_artifact", "Open Report", {
          disabledReason: iterationReportPath ? undefined : "No evaluation report artifact is available.",
          payload: { path: iterationReportPath },
          tone: "secondary",
        }),
        action("open_artifact", "Open Samples", {
          disabledReason: iterationSamplesPath ? undefined : "No prediction samples artifact is available.",
          payload: { path: iterationSamplesPath },
          tone: "secondary",
        }),
        action("open_artifact", "Open Plan", {
          disabledReason: iterationPlanPath ? undefined : "No preprocessing plan artifact is available.",
          payload: { path: iterationPlanPath },
          tone: "secondary",
        }),
        action("open_training", "Open Training", {
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
      title: exportBundlePath ? "Export bundle ready" : "Prepare export bundle",
      description: exportBundleReady
        ? "Package the selected run into a reproducible handoff bundle with model, metrics, report, and optional diagnostics."
        : "Required run artifacts are missing. Regenerate the report or restore missing files before exporting the handoff bundle.",
      artifactPath: exportBundlePath ?? exportReportPath,
      status: exportBundleReady ? "ready" : "attention",
      facts: [
        { label: "Experiment", value: exportExperimentId ?? "-" },
        { label: "Dataset", value: exportDatasetPath ?? input.trainingDatasetPath ?? "-" },
        { label: "Target", value: exportTargetColumn ?? input.suggestedTargetColumn ?? "-" },
        { label: "Report", value: exportReportPath ?? "Missing" },
        { label: "Bundle", value: exportBundlePath ?? "Not exported" },
        {
          label: "Missing",
          value: exportMissingArtifacts.length > 0 ? exportMissingArtifacts.map(String).join(", ") : "None",
        },
      ],
      actions: [
        action("open_artifact", exportBundlePath ? "Open Bundle" : "Open Report", {
          disabledReason:
            exportBundlePath || exportReportPath ? undefined : "No bundle or report artifact is available.",
          payload: { path: exportBundlePath ?? exportReportPath },
          tone: exportBundlePath ? "primary" : "secondary",
        }),
        action("export_run_bundle", exportBundlePath ? "Re-export Bundle" : "Export Bundle", {
          disabledReason:
            projectDisabled ??
            (exportExperimentId ? undefined : "No experiment id is available for bundle export.") ??
            (exportBundleReady ? undefined : "Required model, metrics, or report artifacts are missing."),
          payload: exportExperimentId ? { experimentId: exportExperimentId } : undefined,
          tone: exportBundleReady ? "primary" : "secondary",
        }),
        action("open_training", "Open Training", {
          disabledReason: projectDisabled,
          tone: "secondary",
        }),
      ],
    });

    cards.push({
      id: "export-artifacts",
      kind: "evaluation_report",
      stage: "export",
      title: "Handoff artifact checklist",
      description: "Review the artifacts that will be included in the handoff before creating or refreshing the archive.",
      artifactPath: exportReportPath,
      status: exportBundleReady ? "ready" : "attention",
      facts: [
        { label: "Metrics", value: exportMetricsPath ?? "Missing" },
        { label: "Model", value: exportModelPath ?? "Missing" },
        { label: "Samples", value: exportSamplesPath ?? "Optional" },
        { label: "Plan", value: exportPlanPath ?? "Optional" },
      ],
      actions: [
        action("open_artifact", "Open Report", {
          disabledReason: exportReportPath ? undefined : "No evaluation report artifact is available.",
          payload: { path: exportReportPath },
          tone: "primary",
        }),
        action("open_artifact", "Open Metrics", {
          disabledReason: exportMetricsPath ? undefined : "No metrics artifact is available.",
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
      title: "Learned-rule review",
      description:
        lessonHasExtractableCandidates === false
          ? "This session has evidence, but the current extractor did not find a reusable rule candidate yet."
          : "Extract reviewable lesson candidates from the current session evidence, then inspect them in Evolution Knowledge before adoption.",
      artifactPath: lessonSourceArtifacts.at(-1) ? String(lessonSourceArtifacts.at(-1)) : undefined,
      status: lessonHasExtractableCandidates === false ? "attention" : "ready",
      facts: [
        { label: "Source session", value: lessonSourceSessionId ?? "-" },
        { label: "Events", value: String(lessonSourceEventCount ?? 0) },
        { label: "Candidates", value: String(lessonCandidateCount ?? 0) },
        { label: "High confidence", value: String(lessonHighConfidenceCount ?? 0) },
        { label: "Latest event", value: lessonLatestEventType ?? "-" },
      ],
      actions: [
        action("extract_lessons", "Extract Lessons", {
          disabledReason:
            projectDisabled ??
            (lessonSourceSessionId ? undefined : "No source session is available for lesson extraction."),
          payload: lessonSourceSessionId ? { sourceSessionId: lessonSourceSessionId } : undefined,
          tone: "primary",
        }),
        action("open_artifact", "Open Evidence", {
          disabledReason: lessonSourceArtifacts.at(-1) ? undefined : "No source artifact evidence is available.",
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
      description: "The agent requested this contextual component. Open the artifact to inspect its full details.",
      artifactPath: requested.artifactPath,
      status: "ready",
      facts: [{ label: "Artifact", value: requested.artifactPath ?? "No artifact yet" }],
      actions: [
        action("open_artifact", "Open Artifact", {
          disabledReason: requested.artifactPath ? undefined : "No artifact path is available yet.",
          payload: { path: requested.artifactPath },
          tone: "primary",
        }),
      ],
    });
  }

  return cards;
}
