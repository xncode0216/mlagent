import type { AgentStreamEvent, WorkflowStageId } from "./types";

const stageLabels: Record<WorkflowStageId, string> = {
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

export type WorkflowCompletionFeedback = {
  id: string;
  kind: "stage" | "artifact";
  label: "阶段完成" | "步骤完成" | "产物已创建";
  title: string;
  detail?: string;
  stage?: WorkflowStageId;
  artifactPath?: string;
};

export function deriveWorkflowCompletionFeedback(
  events: AgentStreamEvent[],
): WorkflowCompletionFeedback | null {
  let latest: WorkflowCompletionFeedback | null = null;

  events.forEach((event, index) => {
    if (event.type === "stage_completed") {
      const title = event.label ?? `${stageLabels[event.stage]} 完成`;
      latest = {
        id: `stage:${index}:${event.task_id}:${event.stage}:${title}`,
        kind: "stage",
        label: "阶段完成",
        stage: event.stage,
        title,
      };
      return;
    }

    if (event.type === "step_completed") {
      latest = {
        id: `step:${index}:${event.task_id}:${event.stage ?? "workflow"}:${event.label}:${event.artifact_path ?? ""}`,
        kind: "stage",
        label: event.stage ? "阶段完成" : "步骤完成",
        title: event.label,
        detail: event.artifact_path,
        stage: event.stage,
        artifactPath: event.artifact_path,
      };
      return;
    }

    if (event.type === "artifact_created") {
      latest = {
        id: `artifact:${index}:${event.artifact.id}:${event.artifact.path}`,
        kind: "artifact",
        label: "产物已创建",
        title: event.artifact.name,
        detail: event.artifact.path,
        artifactPath: event.artifact.path,
      };
    }
  });

  return latest;
}
