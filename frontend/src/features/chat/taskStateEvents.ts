import type { AgentStreamEvent, WorkflowStageId } from "./types";

export type DurableTaskState = {
  session_id?: string;
  stage?: string;
  status?: string;
  project_id?: string;
  active_file?: string;
  dataset_path?: string;
  target_column?: string;
  engine?: string;
  experiment_id?: string;
  metrics_path?: string;
  model_path?: string;
  report_path?: string;
  source_type?: string;
  source_id?: string;
  use_gpu?: boolean;
  plan_path?: string;
  preprocessing_plan_path?: string | null;
  retry_count?: number;
  last_error?: string;
  repair_hint?: string;
  stale_check?: string;
  resume_action?: string;
  regenerate_action?: string;
  abandon_action?: string;
  stale_artifact_paths?: string[];
  recovery_policy?: {
    repair_hint?: string;
    stale_check?: string;
    resume_action?: string;
    regenerate_action?: string;
    abandon_action?: string;
    stale_artifact_paths?: string[];
  };
  created_at?: string;
  updated_at?: string;
};

export type TaskStateContext = {
  trainingDatasetPath?: string;
  targetColumn?: string;
  preprocessingPlanPath?: string | null;
  retryCount?: number;
  lastError?: string;
};

const STAGE_IDS = new Set<WorkflowStageId>([
  "ingest",
  "profile",
  "clean",
  "transform",
  "train",
  "evaluate",
  "diagnose",
  "export",
  "learn",
]);

function isWorkflowStageId(value: unknown): value is WorkflowStageId {
  return typeof value === "string" && STAGE_IDS.has(value as WorkflowStageId);
}

function retryableStage(stage: WorkflowStageId) {
  return stage === "transform" || stage === "train" || stage === "evaluate" || stage === "export" || stage === "learn";
}

function taskStateLabel(state: DurableTaskState, stage: WorkflowStageId) {
  if (stage === "train" && state.engine === "sklearn") return "sklearn training failed";
  if (stage === "evaluate") return "evaluation report failed";
  if (stage === "export") return "export bundle failed";
  if (stage === "learn") return "lesson extraction failed";
  if (stage === "transform") return "transform execution failed";
  return `${stage} step failed`;
}

export function taskStateToEvent(state: DurableTaskState): AgentStreamEvent | null {
  if (state.status !== "failed" || !isWorkflowStageId(state.stage)) return null;
  return {
    type: "step_failed",
    task_id: state.session_id ?? state.stage,
    stage: state.stage,
    label: taskStateLabel(state, state.stage),
    error: state.last_error ?? "Task failed and can be inspected from durable task state.",
    retryable: retryableStage(state.stage),
    resume_stage: state.stage,
    retry_count: typeof state.retry_count === "number" ? state.retry_count : undefined,
  };
}

export function taskStatesToEvents(states: DurableTaskState[]): AgentStreamEvent[] {
  return states.flatMap((state) => {
    const event = taskStateToEvent(state);
    return event ? [event] : [];
  });
}

export function trainingContextFromTaskStates(states: DurableTaskState[]): TaskStateContext | null {
  const trainState = states.find((state) => state.stage === "train" && state.status === "failed");
  if (!trainState) return null;
  return {
    trainingDatasetPath: typeof trainState.dataset_path === "string" ? trainState.dataset_path : undefined,
    targetColumn: typeof trainState.target_column === "string" ? trainState.target_column : undefined,
    preprocessingPlanPath:
      typeof trainState.preprocessing_plan_path === "string" ? trainState.preprocessing_plan_path : null,
    retryCount: typeof trainState.retry_count === "number" ? trainState.retry_count : undefined,
    lastError: typeof trainState.last_error === "string" ? trainState.last_error : undefined,
  };
}
