import type { KnowledgeGraphNode } from "../../lib/api";

export type GraphEvidenceItem = {
  label: string;
  value: string;
  action?: { type: "file"; path: string } | { type: "experiment"; experimentId: string };
};

function stringifyEvidenceValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value == null) return "";
  return JSON.stringify(value);
}

function stringFromRecord(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : "";
}

function addPath(items: GraphEvidenceItem[], label: string, value: unknown, navigable = false) {
  const text = stringifyEvidenceValue(value);
  if (text) {
    items.push({
      label,
      value: text,
      ...(navigable ? { action: { type: "file" as const, path: text } } : {}),
    });
  }
}

function addExperiment(items: GraphEvidenceItem[], value: unknown) {
  const experimentId = stringifyEvidenceValue(value);
  if (experimentId) {
    items.push({
      action: { type: "experiment" as const, experimentId },
      label: "实验 ID",
      value: experimentId,
    });
  }
}

export function buildGraphEvidenceItems(node: KnowledgeGraphNode): GraphEvidenceItem[] {
  const provenance = node.properties.provenance;
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) {
    return [];
  }

  const source = provenance as Record<string, unknown>;
  const kind = stringFromRecord(source, "kind");
  const items: GraphEvidenceItem[] = [];

  if (kind === "dataset_column") {
    const datasetPaths = source.dataset_paths;
    if (Array.isArray(datasetPaths) && datasetPaths.length > 0) {
      const paths = datasetPaths.map(stringifyEvidenceValue).filter(Boolean);
      for (const path of paths) {
        items.push({
          action: { type: "file" as const, path },
          label: "数据集",
          value: path,
        });
      }
    }
    addPath(items, "字段", source.column);
    return items;
  }

  if (kind === "experiment_run") {
    addExperiment(items, source.experiment_id);
    addPath(items, "数据集", source.dataset_path, true);
    addPath(items, "指标产物", source.metrics_path, true);
    addPath(items, "模型产物", source.model_path, true);
    return items;
  }

  if (kind === "lesson") {
    addPath(items, "来源类型", source.source_type);
    addPath(items, "来源 ID", source.source_id);
    const evidence = source.evidence;
    if (evidence && typeof evidence === "object" && !Array.isArray(evidence)) {
      for (const [key, value] of Object.entries(evidence as Record<string, unknown>)) {
        const text = stringifyEvidenceValue(value);
        if (text) items.push({ label: `证据: ${key}`, value: text });
      }
    }
  }

  return items;
}
