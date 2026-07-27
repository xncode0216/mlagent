/**
 * 预处理变换报告（execute-plan summary）的列级 diff 派生。
 *
 * 后端已经记录了每列的填充/缩放/编码参数和编码后的输出列，但产物此前只能以原始 JSON
 * 呈现，用户无法直接看出"哪一列去了哪里"。这里把它整理成逐列的输入→输出对照。
 */

export type TransformDiffRowKind = "dropped" | "numeric" | "categorical";

export type TransformDiffRow = {
  column: string;
  kind: TransformDiffRowKind;
  detail: string;
  outputColumns: string[];
};

export type TransformDiffSummary = {
  inputRows: number;
  outputRows: number;
  inputColumns: number;
  outputColumns: number;
  droppedCount: number;
  targetColumn: string;
  rowsChanged: boolean;
};

export type TransformDiff = {
  summary: TransformDiffSummary;
  rows: TransformDiffRow[];
  sourceDatasetPath?: string;
  outputDatasetPath?: string;
};

type Shape = { rows?: number; columns?: number };

type TransformationEntry = {
  imputer?: string;
  fill_value?: unknown;
  scaler?: string;
  encoder?: string;
  mean?: number;
  std?: number;
};

type TransformationReport = {
  source_dataset_path?: string;
  output_dataset_path?: string;
  target_column?: string;
  input_shape?: Shape;
  output_shape?: Shape;
  drop_columns?: string[];
  numeric_features?: string[];
  categorical_features?: string[];
  encoded_feature_columns?: string[];
  transformations?: {
    numeric?: Record<string, TransformationEntry>;
    categorical?: Record<string, TransformationEntry>;
  };
};

export function isTransformationReport(value: unknown): value is TransformationReport {
  if (!value || typeof value !== "object") return false;
  return (
    "input_shape" in value &&
    "output_shape" in value &&
    "transformations" in value &&
    "encoded_feature_columns" in value
  );
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function formatFillValue(value: unknown) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "number") return String(Number(value.toFixed(4)));
  return String(value);
}

/**
 * one-hot 输出列形如 `{列名}_{取值}`，而列名本身可能互为前缀（contract / contract_type）。
 * 因此按最长匹配归属，避免把 contract_type_premium 误算到 contract 名下。
 */
function attributeEncodedColumns(encodedColumns: string[], categoricalFeatures: string[]) {
  const byColumn = new Map<string, string[]>(categoricalFeatures.map((column) => [column, []]));
  const byLongestFirst = [...categoricalFeatures].sort((left, right) => right.length - left.length);

  for (const encoded of encodedColumns) {
    const owner = byLongestFirst.find((column) => encoded.startsWith(`${column}_`));
    if (owner) byColumn.get(owner)?.push(encoded);
  }

  return byColumn;
}

export function buildTransformDiff(report: TransformationReport): TransformDiff {
  const dropColumns = stringList(report.drop_columns);
  const numericFeatures = stringList(report.numeric_features);
  const categoricalFeatures = stringList(report.categorical_features);
  const encodedColumns = stringList(report.encoded_feature_columns);
  const numericTransforms = report.transformations?.numeric ?? {};
  const categoricalTransforms = report.transformations?.categorical ?? {};
  const encodedByColumn = attributeEncodedColumns(encodedColumns, categoricalFeatures);

  const rows: TransformDiffRow[] = [
    ...dropColumns.map((column) => ({
      column,
      kind: "dropped" as const,
      detail: "按计划丢弃，不参与训练",
      outputColumns: [],
    })),
    ...numericFeatures.map((column) => {
      const entry = numericTransforms[column] ?? {};
      const scaler = entry.scaler && entry.scaler !== "none" ? entry.scaler : "无缩放";
      return {
        column,
        kind: "numeric" as const,
        detail: `${entry.imputer ?? "-"} 填充 ${formatFillValue(entry.fill_value)} · ${scaler}`,
        // 数值列在输出中保持同名单列
        outputColumns: [column],
      };
    }),
    ...categoricalFeatures.map((column) => {
      const entry = categoricalTransforms[column] ?? {};
      return {
        column,
        kind: "categorical" as const,
        detail: `${entry.imputer ?? "-"} 填充 ${formatFillValue(entry.fill_value)} · ${entry.encoder ?? "-"}`,
        outputColumns: encodedByColumn.get(column) ?? [],
      };
    }),
  ];

  const inputRows = report.input_shape?.rows ?? 0;
  const outputRows = report.output_shape?.rows ?? 0;

  return {
    summary: {
      inputRows,
      outputRows,
      inputColumns: report.input_shape?.columns ?? 0,
      outputColumns: report.output_shape?.columns ?? 0,
      droppedCount: dropColumns.length,
      targetColumn: report.target_column ?? "-",
      rowsChanged: inputRows !== outputRows,
    },
    rows,
    sourceDatasetPath: report.source_dataset_path,
    outputDatasetPath: report.output_dataset_path,
  };
}
