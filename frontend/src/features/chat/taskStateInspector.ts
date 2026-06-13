import type { AgentStreamEvent, WorkflowStageId } from "./types";
import type { DurableTaskState } from "./taskStateEvents";

export type TaskStateInspection = {
  stage: WorkflowStageId;
  taskId?: string;
  title: string;
  description: string;
  datasetPath?: string;
  planPath?: string;
  facts: Array<{ label: string; value: string }>;
};

const STAGE_IDS = new Set<WorkflowStageId>([
  "ingest",
  "profile",
  "clean",
  "transform",
  "train",
  "evaluate",
  "diagnose",
  "iterate",
  "export",
  "learn",
]);

const STAGE_LABELS: Record<WorkflowStageId, string> = {
  ingest: "Ingest",
  profile: "Profile",
  clean: "Clean",
  transform: "Transform",
  train: "Train",
  evaluate: "Evaluate",
  diagnose: "Diagnose",
  iterate: "Iterate",
  export: "Export",
  learn: "Learn",
};

function isWorkflowStageId(value: unknown): value is WorkflowStageId {
  return typeof value === "string" && STAGE_IDS.has(value as WorkflowStageId);
}

function asText(value: unknown) {
  if (typeof value === "string" && value.trim()) return value;
  return undefined;
}

function asCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatBoolean(value: unknown) {
  if (value === true) return "Requested";
  if (value === false) return "Not requested";
  return "-";
}

function stateUpdatedAt(state: DurableTaskState) {
  return asText(state.updated_at) ?? asText(state.created_at) ?? "";
}

function newerState(left: DurableTaskState, right: DurableTaskState) {
  return stateUpdatedAt(right).localeCompare(stateUpdatedAt(left));
}

function datasetPath(state: DurableTaskState) {
  return asText(state.dataset_path) ?? asText(state.active_file);
}

function planPath(state: DurableTaskState) {
  return asText(state.preprocessing_plan_path) ?? asText(state.plan_path);
}

function artifactPath(state: DurableTaskState) {
  return planPath(state) ?? asText(state.report_path) ?? asText(state.metrics_path) ?? datasetPath(state);
}

function policyText(
  state: DurableTaskState,
  field: "repair_hint" | "stale_check" | "resume_action" | "regenerate_action" | "abandon_action",
) {
  return asText(state.recovery_policy?.[field]) ?? asText(state[field]);
}

function staleArtifactPaths(state: DurableTaskState) {
  const paths = Array.isArray(state.recovery_policy?.stale_artifact_paths)
    ? state.recovery_policy.stale_artifact_paths
    : state.stale_artifact_paths;
  return Array.isArray(paths)
    ? paths.filter((path): path is string => typeof path === "string" && path.trim().length > 0)
    : [];
}

function relatedEvent(state: DurableTaskState, stage: WorkflowStageId, event: AgentStreamEvent) {
  const taskId = asText(state.session_id);
  if ("task_id" in event && taskId && event.task_id === taskId) return true;
  if (event.type === "step_failed" && event.stage === stage) return true;
  if (event.type === "tool_call_finished" && event.status === "error") return true;
  if (event.type === "error") return true;
  return false;
}

function eventSummary(event: AgentStreamEvent) {
  if (event.type === "step_failed") return event.error;
  if (event.type === "tool_call_finished") return event.error ?? event.result_ref ?? event.status;
  if (event.type === "error") return event.message;
  if (event.type === "task_progress") return event.label;
  if (event.type === "kernel_output") return event.text;
  return event.type;
}

function recommendation(state: DurableTaskState, stage: WorkflowStageId) {
  const savedResumeAction = policyText(state, "resume_action");
  if (savedResumeAction) return savedResumeAction;
  if (stage === "transform") {
    return "Retry the saved transform after fixing the plan or refresh the plan if the dataset schema changed.";
  }
  if (stage === "train") {
    const engine = asText(state.engine) ?? "training";
    return `Retry the saved ${engine} run after checking the dataset, target column, kernel, and resource settings.`;
  }
  if (stage === "evaluate") {
    return "Inspect the training artifacts and rerun evaluation after the missing report or metrics dependency is fixed.";
  }
  if (stage === "export") {
    return "Inspect the failed artifact bundle, then rerun export after the missing file or permission issue is resolved.";
  }
  if (stage === "learn") {
    return "Review the source evidence and rerun lesson extraction after resolving the failed knowledge rule input.";
  }
  return "Inspect the saved inputs and logs, then rerun the failed step after the blocking issue is resolved.";
}

export function buildTaskStateInspection(
  states: DurableTaskState[],
  events: AgentStreamEvent[],
  preferredStage?: WorkflowStageId,
): TaskStateInspection | null {
  const failedStates = states
    .filter((state) => state.status === "failed" && isWorkflowStageId(state.stage))
    .sort(newerState);
  const state =
    failedStates.find((candidate) => candidate.stage === preferredStage) ?? failedStates[0];
  if (!state || !isWorkflowStageId(state.stage)) return null;

  const stage = state.stage;
  const relatedEvents = events.filter((event) => relatedEvent(state, stage, event));
  const latestEvent = [...relatedEvents].reverse().find((event) => eventSummary(event));
  const savedDatasetPath = datasetPath(state);
  const savedPlanPath = planPath(state);
  const savedArtifactPath = artifactPath(state);
  const retryCount = asCount(state.retry_count);
  const lastError = asText(state.last_error) ?? "No error detail was saved.";
  const stalePaths = staleArtifactPaths(state);

  const facts: Array<{ label: string; value: string }> = [
    { label: "Stage", value: STAGE_LABELS[stage] },
    { label: "Experiment", value: asText(state.experiment_id) ?? "-" },
    { label: "Source", value: asText(state.source_id) ?? asText(state.source_type) ?? "-" },
    { label: "Dataset", value: savedDatasetPath ?? "-" },
    { label: "Target", value: asText(state.target_column) ?? "-" },
    { label: "Plan", value: savedPlanPath ?? "None" },
    { label: "Report", value: asText(state.report_path) ?? "-" },
    { label: "Metrics", value: asText(state.metrics_path) ?? "-" },
    { label: "Engine", value: asText(state.engine) ?? "-" },
    { label: "GPU", value: formatBoolean(state.use_gpu) },
    { label: "Retries", value: String(retryCount) },
    { label: "Last error", value: lastError },
    { label: "Repair", value: policyText(state, "repair_hint") ?? "-" },
    { label: "Stale check", value: policyText(state, "stale_check") ?? "-" },
    { label: "Resume", value: recommendation(state, stage) },
    { label: "Regenerate", value: policyText(state, "regenerate_action") ?? "-" },
    { label: "Abandon", value: policyText(state, "abandon_action") ?? "-" },
    { label: "Stale artifacts", value: stalePaths.length ? stalePaths.join(", ") : "-" },
    { label: "Related logs", value: String(relatedEvents.length) },
    { label: "Latest log", value: latestEvent ? eventSummary(latestEvent) : "No matching log event loaded" },
  ];

  return {
    stage,
    taskId: asText(state.session_id),
    title: `${STAGE_LABELS[stage]} failure inspector`,
    description:
      "Review the saved retry state, the latest related log entry, and the next recovery action before rerunning this stage.",
    datasetPath: savedDatasetPath,
    planPath: savedArtifactPath,
    facts,
  };
}
