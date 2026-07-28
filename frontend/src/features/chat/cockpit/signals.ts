import type { AgentStreamEvent } from "../types";
import type { ComponentSignal } from "./types";

export function latestMissingRunCommand(events: AgentStreamEvent[]) {
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

export function latestMissingDatasetCommand(events: AgentStreamEvent[]) {
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

export function collectSignals(events: AgentStreamEvent[]) {
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
