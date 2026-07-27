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
  ingest: "接入",
  profile: "画像",
  clean: "清洗",
  transform: "变换",
  train: "训练",
  evaluate: "评估",
  diagnose: "诊断",
  iterate: "迭代",
  export: "导出",
  learn: "沉淀",
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
  if (value === true) return "已请求";
  if (value === false) return "未请求";
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
    return "修复计划后重试已保存的变换；若数据集结构已变化，请刷新计划。";
  }
  if (stage === "train") {
    const engine = asText(state.engine) ?? "训练";
    return `检查数据集、目标列、内核与资源设置后，重试已保存的 ${engine} 运行。`;
  }
  if (stage === "evaluate") {
    return "检查训练产物，在修复缺失的报告或指标依赖后重新运行评估。";
  }
  if (stage === "export") {
    return "检查失败的产物包，在解决缺失文件或权限问题后重新运行导出。";
  }
  if (stage === "learn") {
    return "查看来源证据，在解决失败的知识规则输入后重新运行经验提取。";
  }
  return "检查已保存的输入与日志，在解决阻塞问题后重新运行失败步骤。";
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
  const lastError = asText(state.last_error) ?? "未保存错误详情。";
  const stalePaths = staleArtifactPaths(state);

  const facts: Array<{ label: string; value: string }> = [
    { label: "阶段", value: STAGE_LABELS[stage] },
    { label: "实验", value: asText(state.experiment_id) ?? "-" },
    { label: "来源", value: asText(state.source_id) ?? asText(state.source_type) ?? "-" },
    { label: "数据集", value: savedDatasetPath ?? "-" },
    { label: "目标列", value: asText(state.target_column) ?? "-" },
    { label: "计划", value: savedPlanPath ?? "无" },
    { label: "报告", value: asText(state.report_path) ?? "-" },
    { label: "指标", value: asText(state.metrics_path) ?? "-" },
    { label: "引擎", value: asText(state.engine) ?? "-" },
    { label: "GPU", value: formatBoolean(state.use_gpu) },
    { label: "重试次数", value: String(retryCount) },
    { label: "最近错误", value: lastError },
    { label: "修复", value: policyText(state, "repair_hint") ?? "-" },
    { label: "陈旧检查", value: policyText(state, "stale_check") ?? "-" },
    { label: "恢复", value: recommendation(state, stage) },
    { label: "重新生成", value: policyText(state, "regenerate_action") ?? "-" },
    { label: "放弃", value: policyText(state, "abandon_action") ?? "-" },
    { label: "陈旧产物", value: stalePaths.length ? stalePaths.join(", ") : "-" },
    { label: "相关日志", value: String(relatedEvents.length) },
    { label: "最新日志", value: latestEvent ? eventSummary(latestEvent) : "未加载到匹配的日志事件" },
  ];

  return {
    stage,
    taskId: asText(state.session_id),
    title: `${STAGE_LABELS[stage]} 失败检查器`,
    description:
      "重新运行该阶段前，查看已保存的重试状态、最新的相关日志与下一步恢复动作。",
    datasetPath: savedDatasetPath,
    planPath: savedArtifactPath,
    facts,
  };
}
