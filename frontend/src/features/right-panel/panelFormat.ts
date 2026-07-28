import type { TrainingMetric } from "../../lib/api";
import type { Artifact } from "../chat/types";
import { tabById, type RightPanelTabLabel } from "./panelTabs";

type PerClassMetric = NonNullable<TrainingMetric["per_class"]>[string];

const DATA_FILE_PATTERN = /\.(csv|json|jsonl|parquet)$/i;
const CODE_FILE_PATTERN = /\.(py|ts|tsx|js|jsx)$/i;

export function formatPanelFilename(label: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeLabel = label.replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "panel";
  return `mlagent-${safeLabel}-${timestamp}.json`;
}

export function downloadJsonFile(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function formatMetricPercent(value?: number): string {
  return typeof value === "number" ? `${(value * 100).toFixed(2)}%` : "-";
}

export function formatMetricCount(value?: number): string {
  return typeof value === "number" ? String(value) : "-";
}

export function formatHoldoutStrategy(value?: string): string {
  if (value === "stratified_holdout") return "Stratified holdout";
  if (value === "resubstitution_small_dataset") return "Small dataset reuse";
  return value || "-";
}

export function formatSampleValue(value: unknown): string {
  if (value === null || typeof value === "undefined" || value === "") return "-";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(4);
  return String(value);
}

export function perClassRows(metrics?: TrainingMetric): Array<[string, PerClassMetric]> {
  return Object.entries(metrics?.per_class ?? {}).sort(([left], [right]) => left.localeCompare(right));
}

export function previewTabForPath(path: string): RightPanelTabLabel {
  if (DATA_FILE_PATTERN.test(path)) return tabById.data;
  return tabById.code;
}

export function previewArtifactType(path: string): Artifact["type"] {
  if (DATA_FILE_PATTERN.test(path)) return "dataframe";
  if (CODE_FILE_PATTERN.test(path)) return "code";
  return "report";
}

export function artifactNameFromPath(path: string): string {
  return path.split("/").pop() || path;
}

export function formatFileSize(size?: number): string {
  if (typeof size !== "number") return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/** 二进制文件的提示语。预览层要据此切换为「下载」入口，因此必须与判定同源。 */
export const BINARY_PREVIEW_MESSAGE = "当前文件是二进制内容，暂不支持直接预览。";

export function activeFileReadError(error: unknown): string | null {
  if (!error) return null;
  const message = error instanceof Error ? error.message : "文件读取失败";
  return message.includes("415") ? BINARY_PREVIEW_MESSAGE : message;
}
