import type { AgentComponentKind, AgentStreamEvent, Artifact, WorkflowStageId } from "./types";

export type WorkflowStepStatus = "pending" | "active" | "completed" | "blocked" | "failed";

export type WorkflowStageState = {
  id: WorkflowStageId;
  label: string;
  status: WorkflowStepStatus;
  detail: string;
  retryable?: boolean;
  resumeStage?: WorkflowStageId;
};

export type WorkflowApprovalState = {
  id: string;
  stage: WorkflowStageId;
  title: string;
  description?: string;
  artifactPath?: string;
};

export type WorkflowComponentState = {
  stage: WorkflowStageId;
  kind: AgentComponentKind | string;
  title: string;
  artifactPath?: string;
};

export type WorkflowArtifactState = {
  name: string;
  path: string;
  stage: WorkflowStageId;
  component?: AgentComponentKind | string;
};

export type WorkflowState = {
  stages: WorkflowStageState[];
  currentStage: WorkflowStageState;
  nextAction: string;
  approval: WorkflowApprovalState | null;
  component: WorkflowComponentState | null;
  latestArtifact: WorkflowArtifactState | null;
};

const STAGES: Array<{ id: WorkflowStageId; label: string }> = [
  { id: "ingest", label: "Ingest" },
  { id: "profile", label: "Profile" },
  { id: "clean", label: "Clean" },
  { id: "transform", label: "Transform" },
  { id: "train", label: "Train" },
  { id: "evaluate", label: "Evaluate" },
  { id: "diagnose", label: "Diagnose" },
  { id: "iterate", label: "Iterate" },
  { id: "export", label: "Export" },
  { id: "learn", label: "Learn" },
];

const COMPONENT_LABELS: Record<string, string> = {
  dataset_summary: "Dataset summary",
  data_quality: "Data quality review",
  preprocessing_plan: "Preprocessing plan",
  planned_dataset: "Planned dataset",
  transformation_report: "Transformation report",
  training_config: "Training configuration",
  model_comparison: "Model comparison",
  evaluation_report: "Evaluation report",
  error_analysis: "Error analysis",
  prediction_samples: "Prediction samples",
  iteration_proposal: "Iteration proposal",
  export_bundle: "Export bundle",
  provenance_graph: "Provenance graph",
  lesson_review: "Lesson review",
};

const STAGE_TOOL_PATTERNS: Array<[WorkflowStageId, RegExp]> = [
  ["transform", /preprocess|transform|feature|encode|impute|scale/i],
  ["profile", /profile|quality|describe|correlation|missing/i],
  ["clean", /clean|dedupe|normalize|repair/i],
  ["train", /train|baseline|sklearn|model|classifier|regressor/i],
  ["evaluate", /evaluate|metric|report|compare|importance|coefficient/i],
  ["diagnose", /diagnose|prediction|sample|error|confusion|slice/i],
  ["iterate", /iterate|iteration|retrain|rerun|follow-up|improve/i],
  ["export", /handoff|export|download|package/i],
  ["learn", /lesson|rule|evolution|knowledge|adopt/i],
  ["ingest", /load|read|upload|dataset|file/i],
];

function createStages(): WorkflowStageState[] {
  return STAGES.map((stage) => ({
    id: stage.id,
    label: stage.label,
    status: "pending",
    detail: "Waiting",
  }));
}

function stageIndex(stageId: WorkflowStageId) {
  return STAGES.findIndex((stage) => stage.id === stageId);
}

function stageLabel(stageId: WorkflowStageId) {
  return STAGES.find((stage) => stage.id === stageId)?.label ?? stageId;
}

function textFromMetadata(metadata: Record<string, unknown>) {
  return Object.entries(metadata)
    .map(([key, value]) => `${key} ${String(value)}`)
    .join(" ");
}

function inferStageFromText(text: string, fallback: WorkflowStageId = "ingest"): WorkflowStageId {
  for (const [stage, pattern] of STAGE_TOOL_PATTERNS) {
    if (pattern.test(text)) return stage;
  }
  return fallback;
}

function artifactText(artifact: Artifact) {
  return [artifact.name, artifact.path, artifact.type, textFromMetadata(artifact.metadata)].join(" ").toLowerCase();
}

function classifyArtifact(artifact: Artifact): {
  stage: WorkflowStageId;
  component?: AgentComponentKind;
  planReady?: boolean;
  plannedDataset?: boolean;
  trainingArtifact?: boolean;
  evaluationArtifact?: boolean;
  diagnosticArtifact?: boolean;
} {
  const text = artifactText(artifact);
  const namePath = `${artifact.name} ${artifact.path}`.toLowerCase();
  const artifactRole = typeof artifact.metadata.artifact_role === "string" ? artifact.metadata.artifact_role : "";

  if (artifactRole === "dataset_registry_entry" || namePath.includes("dataset_registry_entry")) {
    return { stage: "ingest", component: "dataset_summary" };
  }

  if (
    namePath.includes("_planned.csv") ||
    namePath.includes("_preprocessed.csv") ||
    text.includes("planned dataset") ||
    text.includes("transformed_data")
  ) {
    return { stage: "transform", component: "planned_dataset", plannedDataset: true };
  }
  if (namePath.includes("preprocessing_plan")) {
    return { stage: "transform", component: "preprocessing_plan", planReady: true };
  }
  if (namePath.includes("preprocessing_transform") || text.includes("transformation report")) {
    return { stage: "transform", component: "transformation_report" };
  }
  if (text.includes("data_quality") || text.includes("quality profile") || text.includes("profile")) {
    return { stage: "profile", component: "data_quality" };
  }
  if (text.includes("cleaned") || text.includes("cleaning")) {
    return { stage: "clean" };
  }
  if (text.includes("prediction_samples")) {
    return { stage: "diagnose", component: "prediction_samples", diagnosticArtifact: true };
  }
  if (text.includes("error_slice") || text.includes("confusion")) {
    return { stage: "diagnose", component: "error_analysis", diagnosticArtifact: true };
  }
  if (text.includes("iteration") || text.includes("iterate")) {
    return { stage: "iterate", component: "iteration_proposal" };
  }
  if (text.includes("model_evaluation_report") || text.includes("evaluation_report")) {
    return { stage: "evaluate", component: "evaluation_report", evaluationArtifact: true };
  }
  if (text.includes("metrics") || text.includes("model_comparison") || text.includes("candidate")) {
    return { stage: "evaluate", component: "model_comparison", evaluationArtifact: true };
  }
  if (artifact.type === "model" || text.includes("model_artifact")) {
    return { stage: "train", component: "training_config", trainingArtifact: true };
  }
  if (artifact.type === "archive" || text.includes("export_bundle") || text.includes("handoff_bundle")) {
    return { stage: "export", component: "export_bundle" };
  }
  if (text.includes("handoff") || text.includes("analysis_report")) {
    return { stage: "export", component: "evaluation_report" };
  }
  if (text.includes("lesson") || text.includes("rule")) {
    return { stage: "learn", component: "lesson_review" };
  }

  return { stage: inferStageFromText(text) };
}

function componentTitle(kind: AgentComponentKind | string) {
  return COMPONENT_LABELS[kind] ?? kind;
}

function findStage(stages: WorkflowStageState[], stageId: WorkflowStageId) {
  return stages[stageIndex(stageId)];
}

function markEarlierStagesReady(stages: WorkflowStageState[], stageId: WorkflowStageId) {
  const index = stageIndex(stageId);
  for (let i = 0; i < index; i += 1) {
    if (stages[i].status === "pending") {
      stages[i] = { ...stages[i], status: "completed", detail: "Ready" };
    }
  }
}

function setStage(
  stages: WorkflowStageState[],
  stageId: WorkflowStageId,
  status: WorkflowStepStatus,
  detail: string,
  options: { retryable?: boolean; resumeStage?: WorkflowStageId } = {},
) {
  markEarlierStagesReady(stages, stageId);
  const index = stageIndex(stageId);
  stages[index] = {
    ...stages[index],
    status,
    detail,
    retryable: status === "failed" ? options.retryable === true : undefined,
    resumeStage: status === "failed" ? options.resumeStage : undefined,
  };
}

function currentStage(stages: WorkflowStageState[], defaultStage: WorkflowStageId) {
  const failedStage = stages.find((stage) => stage.status === "failed");
  if (failedStage) return failedStage;
  const blockedStage = stages.find((stage) => stage.status === "blocked");
  if (blockedStage) return blockedStage;
  const activeStage = [...stages].reverse().find((stage) => stage.status === "active" && stage.id !== "learn");
  if (activeStage) return activeStage;
  const learningStage = stages.find((stage) => stage.status === "active" && stage.id === "learn");
  if (learningStage) return learningStage;

  let lastCompletedIndex = -1;
  for (let index = stages.length - 1; index >= 0; index -= 1) {
    if (stages[index].status === "completed") {
      lastCompletedIndex = index;
      break;
    }
  }
  if (lastCompletedIndex >= stages.length - 1) return stages[lastCompletedIndex];
  const nextStage = stages[lastCompletedIndex + 1] ?? findStage(stages, defaultStage);
  if (nextStage.status === "pending") {
    setStage(stages, nextStage.id, "active", "Ready for next step");
    return findStage(stages, nextStage.id);
  }
  return nextStage;
}

function nextActionFor(
  stage: WorkflowStageState,
  flags: {
    hasPreprocessingPlan: boolean;
    hasPlannedDataset: boolean;
    hasTrainingArtifact: boolean;
    hasEvaluationArtifact: boolean;
    hasDiagnosticArtifact: boolean;
    hasLesson: boolean;
  },
  approval: WorkflowApprovalState | null,
) {
  if (stage.status === "failed" && stage.retryable) return `Retry or resume the failed ${stage.label.toLowerCase()} step.`;
  if (stage.status === "failed") return `Resolve the failed ${stage.label.toLowerCase()} step, then retry or resume.`;
  if (approval) return `Review approval checkpoint: ${approval.title}.`;
  if (flags.hasPreprocessingPlan && !flags.hasPlannedDataset) {
    return "Review the preprocessing plan, approve it, and execute it to create a training-ready dataset.";
  }
  if (flags.hasPlannedDataset && !flags.hasTrainingArtifact) {
    return "Use the planned dataset for training and compare candidate models.";
  }
  if (flags.hasTrainingArtifact && !flags.hasEvaluationArtifact) {
    return "Inspect metrics and generate the model evaluation report.";
  }
  if (flags.hasEvaluationArtifact && !flags.hasDiagnosticArtifact) {
    return "Open diagnostics to inspect error slices and prediction samples.";
  }
  if (flags.hasDiagnosticArtifact && !flags.hasLesson) {
    return "Extract or review lessons from the diagnostic evidence.";
  }
  return `Continue the ${stage.label.toLowerCase()} step from the active context.`;
}

export function deriveWorkflowState(
  events: AgentStreamEvent[],
  mode: "analysis" | "machine-learning",
  activeFile: string,
): WorkflowState {
  const stages = createStages();
  const defaultStage: WorkflowStageId = mode === "machine-learning" ? "train" : "ingest";
  const callStages = new Map<string, WorkflowStageId>();
  const flags = {
    hasPreprocessingPlan: false,
    hasPlannedDataset: false,
    hasTrainingArtifact: false,
    hasEvaluationArtifact: false,
    hasDiagnosticArtifact: false,
    hasLesson: false,
  };
  let approval: WorkflowApprovalState | null = null;
  let approvalFinalized = false;
  let component: WorkflowComponentState | null = null;
  let latestArtifact: WorkflowArtifactState | null = null;

  for (const event of events) {
    if (event.type === "tool_call_started" || event.type === "tool_started") {
      const stage = event.type === "tool_started" && event.stage ? event.stage : inferStageFromText(event.tool, defaultStage);
      callStages.set(event.call_id, stage);
      setStage(stages, stage, "active", `Running ${event.tool}`);
      continue;
    }

    if (event.type === "tool_call_finished") {
      const stage = callStages.get(event.call_id) ?? inferStageFromText(event.result_ref ?? event.error ?? "", defaultStage);
      setStage(stages, stage, event.status === "success" ? "completed" : "failed", event.error ?? event.result_ref ?? event.status);
      continue;
    }

    if (event.type === "stage_started") {
      setStage(stages, event.stage, "active", event.label ?? `${stageLabel(event.stage)} started`);
      continue;
    }

    if (event.type === "stage_completed") {
      setStage(stages, event.stage, "completed", event.label ?? `${stageLabel(event.stage)} completed`);
      continue;
    }

    if (event.type === "approval_required") {
      setStage(stages, event.stage, "blocked", event.title);
      approvalFinalized = false;
      approval = {
        id: event.approval_id,
        stage: event.stage,
        title: event.title,
        description: event.description,
        artifactPath: event.artifact_path,
      };
      continue;
    }

    if (event.type === "approval_resolved") {
      if (approval?.id === event.approval_id) {
        approval = null;
      }
      approvalFinalized = true;
      setStage(
        stages,
        event.stage,
        event.decision === "execute" || event.decision === "approve" ? "active" : "failed",
        event.decision === "execute" || event.decision === "approve"
          ? "Approval granted"
          : "Approval declined",
      );
      continue;
    }

    if (event.type === "component_requested") {
      setStage(stages, event.stage, "active", event.title ?? componentTitle(event.component));
      component = {
        stage: event.stage,
        kind: event.component,
        title: event.title ?? componentTitle(event.component),
        artifactPath: event.artifact_path,
      };
      continue;
    }

    if (event.type === "agent_command") {
      const firstStep = event.command.planned_steps?.[0];
      const stage =
        typeof firstStep === "string" && STAGES.some((item) => item.id === firstStep)
          ? (firstStep as WorkflowStageId)
          : inferStageFromText(event.command.intent, defaultStage);
      const missingContext = event.command.missing_context ?? [];
      setStage(
        stages,
        stage,
        missingContext.length > 0 ? "blocked" : "active",
        missingContext.length > 0
          ? `Missing context: ${missingContext.join(", ")}`
          : `Command: ${event.command.intent}`,
      );
      continue;
    }

    if (event.type === "step_failed") {
      setStage(stages, event.stage ?? inferStageFromText(event.label, defaultStage), "failed", event.error, {
        retryable: event.retryable === true,
        resumeStage: event.resume_stage,
      });
      continue;
    }

    if (event.type === "step_completed") {
      const stage = event.stage ?? inferStageFromText([event.label, event.artifact_path ?? ""].join(" "), defaultStage);
      setStage(stages, stage, "completed", event.label);
      continue;
    }

    if (event.type === "task_resumed") {
      setStage(stages, event.stage ?? defaultStage, "active", event.label ?? "Task resumed");
      continue;
    }

    if (event.type === "artifact_created") {
      const artifact = classifyArtifact(event.artifact);
      flags.hasPreprocessingPlan ||= Boolean(artifact.planReady);
      flags.hasPlannedDataset ||= Boolean(artifact.plannedDataset);
      flags.hasTrainingArtifact ||= Boolean(artifact.trainingArtifact);
      flags.hasEvaluationArtifact ||= Boolean(artifact.evaluationArtifact);
      flags.hasDiagnosticArtifact ||= Boolean(artifact.diagnosticArtifact);
      setStage(
        stages,
        artifact.stage,
        artifact.planReady && !flags.hasPlannedDataset ? "active" : "completed",
        artifact.component ? componentTitle(artifact.component) : event.artifact.name,
      );
      if (artifact.component) {
        component = {
          stage: artifact.stage,
          kind: artifact.component,
          title: componentTitle(artifact.component),
          artifactPath: event.artifact.path,
        };
      }
      latestArtifact = {
        name: event.artifact.name,
        path: event.artifact.path,
        stage: artifact.stage,
        component: artifact.component,
      };
      continue;
    }

    if (event.type === "task_progress") {
      const stage = inferStageFromText(event.label, defaultStage);
      if (findStage(stages, stage).status === "failed" && event.progress < 1) {
        continue;
      }
      setStage(stages, stage, event.progress >= 1 ? "completed" : "active", event.label);
      continue;
    }

    if (event.type === "lesson_extracted" || event.type === "rules_matched") {
      flags.hasLesson = true;
      setStage(stages, "learn", event.type === "lesson_extracted" ? "completed" : "active", "Lesson evidence available");
      continue;
    }

    if (event.type === "error") {
      const existingStage = findStage(stages, defaultStage);
      setStage(stages, defaultStage, "failed", event.message, {
        retryable: existingStage.retryable,
        resumeStage: existingStage.resumeStage,
      });
    }
  }

  if (!events.length) {
    setStage(stages, defaultStage, "active", activeFile ? `Active file: ${activeFile}` : "Ready for a task");
  }

  if (flags.hasPreprocessingPlan && !flags.hasPlannedDataset && !approvalFinalized && findStage(stages, "transform").status !== "failed") {
    setStage(stages, "transform", "blocked", "Preprocessing plan ready for approval");
    approval ??= {
      id: "preprocessing-plan-review",
      stage: "transform",
      title: "Review and execute preprocessing plan",
      description: "The generated plan should be approved before transforming the dataset.",
      artifactPath: latestArtifact?.component === "preprocessing_plan" ? latestArtifact.path : undefined,
    };
  }

  if (flags.hasPlannedDataset && !flags.hasTrainingArtifact) {
    approval = approval?.stage === "transform" ? null : approval;
    if (findStage(stages, "train").status !== "failed") {
      setStage(stages, "train", "active", "Planned dataset is ready for training");
    }
  }
  if (flags.hasTrainingArtifact && !flags.hasEvaluationArtifact) {
    setStage(stages, "evaluate", "active", "Training artifacts are ready for evaluation");
  }
  if (flags.hasEvaluationArtifact && !flags.hasDiagnosticArtifact) {
    setStage(stages, "diagnose", "active", "Evaluation report is ready for diagnostics");
  }
  if (flags.hasDiagnosticArtifact && !flags.hasLesson) {
    setStage(stages, "learn", "active", "Diagnostics are ready for lesson review");
  }

  const selectedStage = currentStage(stages, defaultStage);

  return {
    stages,
    currentStage: selectedStage,
    nextAction: nextActionFor(selectedStage, flags, approval),
    approval,
    component,
    latestArtifact,
  };
}
