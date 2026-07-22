import type { AgentStreamEvent, WorkflowStageId } from "./types";

const stageLabels: Record<WorkflowStageId, string> = {
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

export type WorkflowCompletionFeedback = {
  id: string;
  kind: "stage" | "artifact";
  label: "Stage completed" | "Step completed" | "Artifact created";
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
      const title = event.label ?? `${stageLabels[event.stage]} completed`;
      latest = {
        id: `stage:${index}:${event.task_id}:${event.stage}:${title}`,
        kind: "stage",
        label: "Stage completed",
        stage: event.stage,
        title,
      };
      return;
    }

    if (event.type === "step_completed") {
      latest = {
        id: `step:${index}:${event.task_id}:${event.stage ?? "workflow"}:${event.label}:${event.artifact_path ?? ""}`,
        kind: "stage",
        label: event.stage ? "Stage completed" : "Step completed",
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
        label: "Artifact created",
        title: event.artifact.name,
        detail: event.artifact.path,
        artifactPath: event.artifact.path,
      };
    }
  });

  return latest;
}
