import { compactInformationIdentifier, friendlyPathName } from "../informationDisplay";
import type { CockpitActionId, CockpitComponentAction, CockpitComponentControl } from "./types";

export function stringProp(props: Record<string, unknown> | undefined, key: string) {
  const value = props?.[key];
  return typeof value === "string" && value ? value : undefined;
}

export function numberProp(props: Record<string, unknown> | undefined, key: string) {
  const value = props?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function arrayProp(props: Record<string, unknown> | undefined, key: string) {
  const value = props?.[key];
  return Array.isArray(value) ? value : undefined;
}

export function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

/**
 * 目标列候选有两种真实来源，形状不同：orchestrator 的 component_requested 已把候选
 * 降级成列名数组，而本地「生成画像」写入的 artifact metadata 仍是带评分的对象数组。
 * 两者都按后端的评分顺序排列，这里统一取列名。
 */
export function targetCandidatesFromProps(props: Record<string, unknown> | undefined) {
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

export function stringListFromProps(props: Record<string, unknown> | undefined, key: string) {
  return (arrayProp(props, key) ?? [])
    .map((item) => stringValue(item))
    .filter((item): item is string => Boolean(item));
}

/**
 * 特征选择的候选是计划里的“全部非目标列”，即已选特征加上被丢弃的列；已选特征保持勾选。
 * 计划未报告列信息时不造控件，避免呈现一个空的、会把全部特征清空的选择器。
 */
export function buildFeatureSelectionControls(
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
export function buildTargetColumnControls(
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

export function runCandidateLabel(candidate: Record<string, unknown>) {
  const datasetPath = stringValue(candidate.dataset_path);
  const bestModelName = stringValue(candidate.best_model_name);
  const experimentId = stringValue(candidate.experiment_id);
  return [datasetPath ? friendlyPathName(datasetPath) : undefined, bestModelName]
    .filter(Boolean)
    .join(" · ") || (experimentId ? compactInformationIdentifier(experimentId) : "未知实验");
}

export function runCandidateFacts(candidate: Record<string, unknown>) {
  const datasetPath = stringValue(candidate.dataset_path) ?? "-";
  const targetColumn = stringValue(candidate.target_column) ?? "-";
  const bestModelName = stringValue(candidate.best_model_name) ?? "-";
  return `${friendlyPathName(datasetPath)} | 目标列 ${targetColumn} | ${bestModelName}`;
}

export function datasetCandidateLabel(candidate: Record<string, unknown>) {
  const path = stringValue(candidate.dataset_path);
  return path ? friendlyPathName(path) : "未知数据集";
}

export function datasetCandidateTarget(candidate: Record<string, unknown>) {
  const targetCandidates = stringValue(candidate.target_candidates);
  return targetCandidates?.split(",").map((item) => item.trim()).find(Boolean);
}

export function datasetCandidateFacts(candidate: Record<string, unknown>) {
  const rowCount = stringValue(candidate.row_count) ?? "-";
  const columnCount = stringValue(candidate.column_count) ?? "-";
  const targetCandidates = stringValue(candidate.target_candidates) ?? "-";
  return `${rowCount} 行 × ${columnCount} 列 | 目标列候选 ${targetCandidates}`;
}
export function isDatasetPath(path?: string | null) {
  return Boolean(path && /\.(csv|tsv|jsonl|parquet)$/i.test(path) && !path.includes("preprocessing_plan"));
}
export function disabledWithoutProject(projectId?: string) {
  return projectId ? undefined : "执行此操作前请先打开或创建项目。";
}

export function disabledWithoutDataset(datasetPath?: string) {
  return isDatasetPath(datasetPath) ? undefined : "执行此操作前请先选择数据集文件。";
}

export function action(
  id: CockpitActionId,
  label: string,
  options: Omit<CockpitComponentAction, "id" | "label"> = {},
): CockpitComponentAction {
  return { id, label, ...options };
}
