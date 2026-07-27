import { useQueryClient } from "@tanstack/react-query";
import { BarChart3, Database, Download, FileText, Play, RefreshCw, SearchX, Table2, XCircle } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";

import {
  projectFileDownloadUrl,
  readProjectFileContent,
  updateProjectFileContent,
  type ExperimentRun,
  type GPUStatus,
  type TrainingMetric,
  type TrainingResult,
} from "../../lib/api";
import type { RightPanelTabId } from "../../app/appDeepLink";
import {
  projectFileContentQueryKey,
  useProjectFileContentQuery,
} from "../files/useProjectFileContentQuery";
import { filesQueryKeyRoot } from "../files/useProjectFilesQuery";

// Lazy so Recharts loads only when a histogram artifact is opened, keeping it
// out of the initial bundle.
const HistogramChart = lazy(() => import("./HistogramChart"));
import { useUiStore } from "../../app/uiStore";
import type { AgentStreamEvent, Artifact } from "../chat/types";
import { LogPanel } from "../logs/LogPanel";
import { deriveWorkflowState } from "../chat/workflowState";
import { deriveErrorSlices } from "./errorSlices";
import { inspectorTabForWorkflow } from "./inspectorContext";
import {
  buildTransformDiff,
  isTransformationReport,
  type TransformDiff,
  type TransformDiffRow,
} from "./transformDiff";
import {
  diagnosticSummary,
  filterAndSortCandidateRuns,
  filterAndSortExperimentRuns,
  filterPredictionSamples,
  predictionSampleOptions,
  type CandidateRunSort,
  type CandidateRunView,
  type ExperimentRunFilter,
  type ExperimentRunSort,
  type PredictionSample,
  type PredictionSampleFilter,
} from "./trainingDiagnostics";

const tabs = ["图表", "代码", "数据", "训练", "日志"] as const;
const tabById: Record<RightPanelTabId, (typeof tabs)[number]> = {
  chart: "图表",
  code: "代码",
  data: "数据",
  training: "训练",
  logs: "日志",
};
type TrainingEngine = "baseline" | "sklearn";
type PanelActionFeedback = {
  kind: "info" | "success" | "warning" | "error";
  message: string;
};

type PredictionSamplesPreview = {
  experiment_id?: string;
  sample_source?: string;
  samples?: PredictionSample[];
};

type PreprocessingPlanPreviewValue = {
  target_column?: string;
  feature_columns?: string[];
  drop_columns?: string[];
  numeric_features?: string[];
  categorical_features?: string[];
  output_dataset_path?: string;
  sklearn_pipeline_script_path?: string;
  steps?: {
    numeric?: { imputer?: string; scaler?: string };
    categorical?: { imputer?: string; encoder?: string };
  };
  quality_summary?: { missing_cells?: number };
};

function formatPanelFilename(label: string) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeLabel = label.replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "panel";
  return `mlagent-${safeLabel}-${timestamp}.json`;
}

function downloadJsonFile(filename: string, value: unknown) {
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

function formatMetricPercent(value?: number) {
  return typeof value === "number" ? `${(value * 100).toFixed(2)}%` : "-";
}

function formatMetricCount(value?: number) {
  return typeof value === "number" ? String(value) : "-";
}

function formatHoldoutStrategy(value?: string) {
  if (value === "stratified_holdout") return "Stratified holdout";
  if (value === "resubstitution_small_dataset") return "Small dataset reuse";
  return value || "-";
}

function formatSampleValue(value: unknown) {
  if (value === null || typeof value === "undefined" || value === "") return "-";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(4);
  return String(value);
}

function perClassRows(metrics?: TrainingMetric) {
  return Object.entries(metrics?.per_class ?? {}).sort(([left], [right]) => left.localeCompare(right));
}

function previewTabForPath(path: string): (typeof tabs)[number] {
  if (/\.(csv|json|jsonl|parquet)$/i.test(path)) return tabById.data;
  return tabById.code;
}

function previewArtifactType(path: string): Artifact["type"] {
  if (/\.(csv|json|jsonl|parquet)$/i.test(path)) return "dataframe";
  if (/\.(py|ts|tsx|js|jsx)$/i.test(path)) return "code";
  return "report";
}

function artifactNameFromPath(path: string) {
  return path.split("/").pop() || path;
}

function ArtifactPathRow({
  downloadUrl,
  label,
  path,
  onOpen,
}: {
  downloadUrl?: string;
  label: string;
  path: string;
  onOpen: (path: string) => void;
}) {
  if (downloadUrl) {
    return (
      <div>
        <span>{label}</span>
        <a
          className="artifact-path-button"
          data-artifact-path={path}
          href={downloadUrl}
          title={`Download ${path}`}
        >
          <code>{path}</code>
          <span>Download</span>
        </a>
      </div>
    );
  }

  return (
    <div>
      <span>{label}</span>
      <button
        className="artifact-path-button"
        data-artifact-path={path}
        onClick={() => onOpen(path)}
        title={`Open ${path}`}
        type="button"
      >
        <code>{path}</code>
        <span>Open</span>
      </button>
    </div>
  );
}

type RightPanelProps = {
  events: AgentStreamEvent[];
  projectId?: string;
  sessionId?: string;
  trainingRuns: ExperimentRun[];
  gpuStatus: GPUStatus | null;
  onCleanDataset: () => Promise<void>;
  onExecutePreprocessingPlan: () => Promise<void>;
  onExportRunBundle: (experimentId: string) => Promise<void>;
  onGenerateReport: () => Promise<void>;
  onGenerateEvaluationReport: (experimentId: string) => Promise<void>;
  onGenerateProfile: () => Promise<void>;
  onGeneratePreprocessingPlan: () => Promise<void>;
  onTransferToMl: () => Promise<void>;
  onSelectFile: (path: string) => void;
  onTrainModel: (
    targetColumn: string,
    engine: TrainingEngine,
    useGpu: boolean,
    preprocessingPlanPath?: string | null,
  ) => Promise<void>;
  onCancelGpuTask: (taskId: string) => Promise<void>;
  onRefreshGpuStatus: () => Promise<void>;
};

function artifactEvents(events: AgentStreamEvent[]) {
  return events
    .filter((event): event is Extract<AgentStreamEvent, { type: "artifact_created" }> => {
      return event.type === "artifact_created";
    })
    .map((event) => event.artifact);
}

function ArtifactList({
  artifacts,
  selectedId,
  onSelect,
}: {
  artifacts: Artifact[];
  selectedId?: string;
  onSelect: (artifact: Artifact) => void;
}) {
  if (artifacts.length === 0) return null;

  return (
    <div className="artifact-list compact">
      {artifacts.map((artifact) => (
        <button
          className={artifact.id === selectedId ? "artifact-card selected" : "artifact-card"}
          key={artifact.id}
          onClick={() => onSelect(artifact)}
        >
          <div>
            <strong>{artifact.name}</strong>
            <span>{artifact.type}</span>
          </div>
          <code>{artifact.path}</code>
          <small>{artifact.created_at}</small>
        </button>
      ))}
    </div>
  );
}

function PreprocessingPlanPreview({
  onExecutePreprocessingPlan,
  plan,
}: {
  onExecutePreprocessingPlan?: () => Promise<void>;
  plan: PreprocessingPlanPreviewValue;
}) {
  const [executingPlan, setExecutingPlan] = useState(false);
  const [executionFeedback, setExecutionFeedback] = useState<PanelActionFeedback | null>(null);

  async function executePlan() {
    if (!onExecutePreprocessingPlan) return;
    setExecutingPlan(true);
    setExecutionFeedback({ kind: "info", message: "Executing preprocessing plan..." });
    try {
      await onExecutePreprocessingPlan();
      setExecutionFeedback({
        kind: "success",
        message: "Plan executed. The transformed dataset is now selected for training.",
      });
    } catch (error) {
      setExecutionFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Preprocessing plan execution failed.",
      });
    } finally {
      setExecutingPlan(false);
    }
  }

  return (
    <div className="data-quality-profile preprocessing-plan-preview">
      <div className="metrics-grid compact">
        <div>
          <span>Target</span>
          <strong>{plan.target_column ?? "-"}</strong>
        </div>
        <div>
          <span>Features</span>
          <strong>{plan.feature_columns?.length ?? 0}</strong>
        </div>
        <div>
          <span>Drop</span>
          <strong>{plan.drop_columns?.length ?? 0}</strong>
        </div>
        <div>
          <span>Missing</span>
          <strong>{plan.quality_summary?.missing_cells ?? 0}</strong>
        </div>
      </div>
      <div className="detail-grid evaluation-summary">
        <div>
          <span>Numeric</span>
          <code>{plan.numeric_features?.join(", ") || "-"}</code>
        </div>
        <div>
          <span>Categorical</span>
          <code>{plan.categorical_features?.join(", ") || "-"}</code>
        </div>
        <div>
          <span>Output</span>
          <code>{plan.output_dataset_path ?? "-"}</code>
        </div>
        <div>
          <span>Pipeline Script</span>
          <code>{plan.sklearn_pipeline_script_path ?? "-"}</code>
        </div>
      </div>
      <div aria-label="预处理分支对比表，可滚动" className="data-preview" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Branch</th>
              <th>Imputer</th>
              <th>Transform</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>numeric</td>
              <td>{plan.steps?.numeric?.imputer ?? "-"}</td>
              <td>{plan.steps?.numeric?.scaler ?? "-"}</td>
            </tr>
            <tr>
              <td>categorical</td>
              <td>{plan.steps?.categorical?.imputer ?? "-"}</td>
              <td>{plan.steps?.categorical?.encoder ?? "-"}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {onExecutePreprocessingPlan ? (
        <div className="artifact-action-row">
          <button disabled={executingPlan} onClick={() => void executePlan()} type="button">
            <Play size={14} />
            {executingPlan ? "Executing..." : "Execute Plan"}
          </button>
          <span>Produce a transformed dataset artifact and use it as the next training dataset.</span>
        </div>
      ) : null}
      {executionFeedback ? (
        <div
          className={`action-feedback ${executionFeedback.kind}`}
          role={executionFeedback.kind === "error" ? "alert" : "status"}
        >
          {executionFeedback.message}
        </div>
      ) : null}
    </div>
  );
}

const transformKindLabel: Record<TransformDiffRow["kind"], string> = {
  dropped: "已丢弃",
  numeric: "数值",
  categorical: "类别",
};

function TransformDiffPreview({ diff }: { diff: TransformDiff }) {
  return (
    <div className="data-quality-profile transform-diff-preview">
      <div className="metrics-grid compact">
        <div>
          <span>Rows</span>
          <strong>
            {diff.summary.inputRows} → {diff.summary.outputRows}
          </strong>
        </div>
        <div>
          <span>Columns</span>
          <strong>
            {diff.summary.inputColumns} → {diff.summary.outputColumns}
          </strong>
        </div>
        <div>
          <span>Dropped</span>
          <strong>{diff.summary.droppedCount}</strong>
        </div>
        <div>
          <span>Target</span>
          <strong>{diff.summary.targetColumn}</strong>
        </div>
      </div>
      {diff.summary.rowsChanged ? (
        <div aria-label="变换行数变化" className="inspector-async-state error" role="status">
          变换后行数由 {diff.summary.inputRows} 变为 {diff.summary.outputRows}，请确认是否符合预期。
        </div>
      ) : null}
      <div aria-label="预处理变换列对照，可滚动" className="data-preview" tabIndex={0}>
        <table aria-label="预处理变换列对照">
          <thead>
            <tr>
              <th>输入列</th>
              <th>处理</th>
              <th>变换</th>
              <th>输出列</th>
            </tr>
          </thead>
          <tbody>
            {diff.rows.map((row) => (
              <tr className={row.kind === "dropped" ? "warning-row" : ""} key={row.column}>
                <td>{row.column}</td>
                <td>{transformKindLabel[row.kind]}</td>
                <td>{row.detail}</td>
                <td>{row.outputColumns.length > 0 ? row.outputColumns.join(", ") : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function JsonTable({
  onExecutePreprocessingPlan,
  value,
}: {
  onExecutePreprocessingPlan?: () => Promise<void>;
  value: unknown;
}) {
  if (!value || typeof value !== "object") {
    return <pre className="json-preview">{JSON.stringify(value, null, 2)}</pre>;
  }

  if ("columns" in value && "target_candidates" in value && Array.isArray(value.columns)) {
    const profile = value as {
      row_count?: number;
      column_count?: number;
      missing_cells?: number;
      columns: Array<{
        name?: string;
        dtype?: string;
        kind?: string;
        missing_ratio?: number;
        unique_count?: number;
        quality_flags?: string[];
      }>;
      target_candidates?: Array<{ column?: string }>;
    };
    const bestTarget = profile.target_candidates?.[0];
    return (
      <div className="data-quality-profile">
        <div className="metrics-grid compact">
          <div>
            <span>Rows</span>
            <strong>{profile.row_count ?? "-"}</strong>
          </div>
          <div>
            <span>Columns</span>
            <strong>{profile.column_count ?? "-"}</strong>
          </div>
          <div>
            <span>Missing Cells</span>
            <strong>{profile.missing_cells ?? 0}</strong>
          </div>
          <div>
            <span>Target</span>
            <strong>{bestTarget?.column ?? "-"}</strong>
          </div>
        </div>
        <div aria-label="数据质量字段表，可滚动" className="data-preview" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>字段</th>
                <th>类型</th>
                <th>缺失</th>
                <th>唯一值</th>
                <th>质量标记</th>
              </tr>
            </thead>
            <tbody>
              {profile.columns.map((column) => (
                <tr key={column.name}>
                  <td>{column.name}</td>
                  <td>{column.kind ?? column.dtype}</td>
                  <td>{((column.missing_ratio ?? 0) * 100).toFixed(2)}%</td>
                  <td>{column.unique_count ?? "-"}</td>
                  <td>{column.quality_flags?.join(", ") || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if ("sklearn_pipeline" in value && "steps" in value && "feature_columns" in value) {
    return (
      <PreprocessingPlanPreview
        onExecutePreprocessingPlan={onExecutePreprocessingPlan}
        plan={value as PreprocessingPlanPreviewValue}
      />
    );
  }

  if (isTransformationReport(value)) {
    return <TransformDiffPreview diff={buildTransformDiff(value)} />;
  }

  if ("samples" in value && Array.isArray(value.samples)) {
    const preview = value as PredictionSamplesPreview;
    const samples = preview.samples ?? [];
    const errorCount = samples.filter((sample) => sample.is_error).length;
    const columns = Array.from(
      new Set(samples.slice(0, 10).flatMap((sample) => Object.keys(sample.features ?? {}).slice(0, 6))),
    );
    return (
      <div className="data-quality-profile prediction-samples-preview">
        <div className="metrics-grid compact">
          <div>
            <span>Samples</span>
            <strong>{samples.length}</strong>
          </div>
          <div>
            <span>Errors</span>
            <strong>{errorCount}</strong>
          </div>
          <div>
            <span>Source</span>
            <strong>{preview.sample_source ?? "-"}</strong>
          </div>
          <div>
            <span>Experiment</span>
            <strong>{preview.experiment_id ?? "-"}</strong>
          </div>
        </div>
        <div aria-label="预测样本表，可滚动" className="data-preview" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>Row</th>
                <th>Actual</th>
                <th>Predicted</th>
                <th>Status</th>
                {columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {samples.slice(0, 10).map((sample, index) => (
                <tr className={sample.is_error ? "warning-row" : ""} key={`${sample.row_index ?? index}-${index}`}>
                  <td>{formatSampleValue(sample.row_index)}</td>
                  <td>{formatSampleValue(sample.actual)}</td>
                  <td>{formatSampleValue(sample.predicted)}</td>
                  <td>{sample.is_error ? "Error" : "Correct"}</td>
                  {columns.map((column) => (
                    <td key={column}>{formatSampleValue(sample.features?.[column])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (
    "sample" in value &&
    Array.isArray(value.sample) &&
    value.sample.length > 0 &&
    typeof value.sample[0] === "object"
  ) {
    const rows = value.sample as Record<string, unknown>[];
    const columns = Object.keys(rows[0]);
    return (
      <div aria-label="产物数据样本表，可滚动" className="data-preview" tabIndex={0}>
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {columns.map((column) => (
                  <td key={column}>{String(row[column] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if ("chart_type" in value && value.chart_type === "histogram" && "bins" in value && Array.isArray(value.bins)) {
    const bins = value.bins as Array<{ start?: number; end?: number; count?: number }>;
    const summary =
      "summary" in value && value.summary && typeof value.summary === "object"
        ? (value.summary as Record<string, unknown>)
        : {};
    return (
      <div className="artifact-chart">
        <div className="dataset-strip">
          <span>分布字段</span>
          <strong>{"column" in value ? String(value.column ?? "-") : "-"}</strong>
        </div>
        <Suspense fallback={<div className="artifact-histogram-fallback">加载分布图…</div>}>
          <HistogramChart bins={bins} column={"column" in value ? String(value.column ?? "") : ""} />
        </Suspense>
        <div className="chart-summary">
          <span>均值 {typeof summary.mean === "number" ? summary.mean.toFixed(2) : "-"}</span>
          <span>中位数 {typeof summary.median === "number" ? summary.median.toFixed(2) : "-"}</span>
          <span>非空 {String(summary.non_null_count ?? "-")}</span>
        </div>
      </div>
    );
  }

  if ("columns" in value && "matrix" in value && Array.isArray(value.columns) && Array.isArray(value.matrix)) {
    const columns = value.columns as string[];
    const matrix = value.matrix as number[][];
    return (
      <div aria-label="相关性矩阵，可滚动" className="data-preview" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>字段</th>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, index) => (
              <tr key={columns[index]}>
                <th>{columns[index]}</th>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if ("columns" in value && value.columns && typeof value.columns === "object") {
    return (
      <div aria-label="缺失值字段表，可滚动" className="data-preview" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>字段</th>
              <th>缺失数量</th>
              <th>缺失比例</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(value.columns as Record<string, { missing_count?: number; missing_ratio?: number }>).map(
              ([column, profile]) => (
                <tr key={column}>
                  <td>{column}</td>
                  <td>{profile.missing_count ?? 0}</td>
                  <td>{((profile.missing_ratio ?? 0) * 100).toFixed(2)}%</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    );
  }

  return <pre className="json-preview">{JSON.stringify(value, null, 2)}</pre>;
}

function ArtifactPreview({
  artifact,
  busy,
  content,
  error,
  onExecutePreprocessingPlan,
  onRetry,
}: {
  artifact?: Artifact;
  busy: boolean;
  content: string | null;
  error: string | null;
  onExecutePreprocessingPlan?: () => Promise<void>;
  onRetry: () => void;
}) {
  if (!artifact) return null;

  let preview = null;
  try {
    preview = content === null ? null : (
      <JsonTable onExecutePreprocessingPlan={onExecutePreprocessingPlan} value={JSON.parse(content)} />
    );
  } catch {
    preview = content === null ? null : <pre className="json-preview">{content}</pre>;
  }

  return (
    <section aria-busy={busy} aria-label="产物预览" className="artifact-preview">
      {error ? (
        <div className="inspector-async-state error" role="alert">
          <span>{error}</span>
          <button aria-label="重试产物内容" onClick={onRetry} type="button">
            <RefreshCw aria-hidden="true" size={13} />
            <span>重试</span>
          </button>
        </div>
      ) : null}
      {busy && content === null ? (
        <div className="inspector-async-state loading" role="status">
          <span>正在读取产物内容…</span>
          <div aria-hidden="true" className="inspector-skeleton">
            <span className="inspector-skeleton-row" />
            <span className="inspector-skeleton-row" />
            <span className="inspector-skeleton-row" />
          </div>
        </div>
      ) : null}
      {busy && content !== null ? (
        <div className="inspector-async-state refreshing" role="status">
          正在刷新产物内容…
        </div>
      ) : null}
      {preview}
    </section>
  );
}

function GuidedEmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty-state compact-empty guided-empty" role="status">
      <SearchX aria-hidden="true" size={18} />
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      {actionLabel && onAction ? (
        <button onClick={onAction} type="button">
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function formatFileSize(size?: number) {
  if (typeof size !== "number") return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function parseCsvPreview(content: string, maxRows = 50) {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      row.push(current);
      current = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      if (rows.length > maxRows) break;
      continue;
    }
    current += char;
  }

  if (current || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  const [headers = [], ...body] = rows.filter((item) => item.some((cell) => cell.length > 0));
  return { headers, rows: body.slice(0, maxRows) };
}

function CsvFilePreview({ content }: { content: string }) {
  const preview = useMemo(() => parseCsvPreview(content), [content]);
  if (preview.headers.length === 0) {
    return <GuidedEmptyState description="添加表头和数据后，这里会显示可检查的表格预览。" title="CSV 文件为空" />;
  }

  return (
    <div aria-label="CSV 数据预览表，可滚动" className="data-preview" tabIndex={0}>
      <table>
        <thead>
          <tr>
            {preview.headers.map((header, index) => (
              <th key={`${header}-${index}`}>{header || `列 ${index + 1}`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {preview.headers.map((_, columnIndex) => (
                <td key={columnIndex}>{row[columnIndex] ?? ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function activeFileReadError(error: unknown) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : "文件读取失败";
  return message.includes("415") ? "当前文件是二进制内容，暂不支持直接预览。" : message;
}

function ActiveFilePreview({
  activeFile,
  mode,
  onExecutePreprocessingPlan,
  projectId,
}: {
  activeFile: string;
  mode: "code" | "data";
  onExecutePreprocessingPlan?: () => Promise<void>;
  projectId?: string;
}) {
  const queryClient = useQueryClient();
  const fileContentQuery = useProjectFileContentQuery(projectId, activeFile);
  const fileContent = fileContentQuery.data ?? null;
  const readError = activeFileReadError(fileContentQuery.error);
  const isBinary = readError === "当前文件是二进制内容，暂不支持直接预览。";
  const fileKey = projectId && activeFile ? `${projectId}:${activeFile}` : "";
  const [draft, setDraft] = useState<{ fileKey: string; content: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const draftContent = draft?.fileKey === fileKey ? draft.content : fileContent?.content ?? "";

  useEffect(() => {
    setDraft(null);
    setSaveError(null);
    setSaveState("idle");
  }, [fileKey]);

  async function saveFile() {
    if (!projectId || !fileContent) return;
    setSaveState("saving");
    setSaveError(null);
    try {
      const result = await updateProjectFileContent(projectId, fileContent.path, draftContent);
      queryClient.setQueryData(projectFileContentQueryKey(projectId, fileContent.path), result);
      setDraft(null);
      setSaveState("saved");
      void queryClient.invalidateQueries({ queryKey: filesQueryKeyRoot(projectId) });
    } catch (nextError) {
      setSaveState("error");
      setSaveError(nextError instanceof Error ? nextError.message : "文件保存失败");
    }
  }

  const previewClassName = `active-file-preview ${mode === "data" ? "data-workspace" : "code-workspace"}`;

  if (!projectId) {
    return (
      <section aria-busy="false" aria-label="活动文件预览" className={previewClassName}>
        <GuidedEmptyState description="从左侧项目面板选择或创建项目，再打开需要检查的文件。" title="尚未选择项目" />
      </section>
    );
  }
  if (!activeFile) {
    return (
      <section aria-busy="false" aria-label="活动文件预览" className={previewClassName}>
        <GuidedEmptyState description="从左侧文件树选择 CSV、JSON 或代码文件进行检查。" title="尚未选择文件" />
      </section>
    );
  }
  if (fileContentQuery.isFetching && !fileContent) {
    return (
      <section aria-busy="true" aria-label="活动文件预览" className={previewClassName}>
        <div className="active-file-loading" role="status">
          <span>正在读取文件内容…</span>
          <div aria-hidden="true" className="inspector-skeleton">
            <span className="inspector-skeleton-row" />
            <span className="inspector-skeleton-row" />
            <span className="inspector-skeleton-row" />
          </div>
        </div>
      </section>
    );
  }
  if (readError && !fileContent) {
    return (
      <section aria-busy={fileContentQuery.isFetching} aria-label="活动文件预览" className={previewClassName}>
        <div className="inspector-async-state error" role="alert">
          <span>{readError}</span>
          {isBinary ? (
            <a
              aria-label="下载二进制文件"
              download
              href={projectFileDownloadUrl(projectId, activeFile)}
            >
              <Download aria-hidden="true" size={14} />
              下载文件
            </a>
          ) : (
            <button
              aria-label="重试文件内容"
              disabled={fileContentQuery.isFetching}
              onClick={() => void fileContentQuery.refetch()}
              type="button"
            >
              <RefreshCw aria-hidden="true" size={14} />
              重试
            </button>
          )}
        </div>
      </section>
    );
  }
  if (!fileContent) return null;

  const isCsv = activeFile.toLowerCase().endsWith(".csv") || fileContent.mime_type === "text/csv";
  const isJson = activeFile.toLowerCase().endsWith(".json") || fileContent.mime_type === "application/json";
  const hasUnsavedDraft = draftContent !== fileContent.content;

  return (
    <section aria-busy={fileContentQuery.isFetching} aria-label="活动文件预览" className={previewClassName}>
      <div className="dataset-strip">
        <div className="active-file-identity">
          <span>当前文件</span>
          <strong title={fileContent.path}>{fileContent.path}</strong>
        </div>
        <button
          aria-label="刷新文件内容"
          className="active-file-refresh"
          disabled={fileContentQuery.isFetching}
          onClick={() => void fileContentQuery.refetch()}
          title="刷新文件内容"
          type="button"
        >
          <RefreshCw aria-hidden="true" size={14} />
        </button>
      </div>
      <div className="file-meta-row">
        <span>{fileContent.mime_type}</span>
        <span>{formatFileSize(fileContent.size)}</span>
        {fileContentQuery.isFetching ? <span role="status">正在刷新文件内容…</span> : null}
        {mode === "code" && hasUnsavedDraft ? <span>未保存</span> : null}
        {mode === "code" && saveState === "saved" ? <span>已保存</span> : null}
      </div>
      {readError ? (
        <div className="inspector-async-state error" role="alert">
          <span>{readError}</span>
          <button
            aria-label="重试文件内容"
            disabled={fileContentQuery.isFetching}
            onClick={() => void fileContentQuery.refetch()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={14} />
            重试
          </button>
        </div>
      ) : null}
      {saveError ? (
        <div className="inspector-async-state error" role="alert">
          <span>{saveError}</span>
          <button disabled={saveState === "saving"} onClick={() => void saveFile()} type="button">
            重试保存
          </button>
        </div>
      ) : null}
      {mode === "data" && isCsv ? <CsvFilePreview content={fileContent.content} /> : null}
      {mode === "data" && isJson ? (
        (() => {
          try {
            return <JsonTable onExecutePreprocessingPlan={onExecutePreprocessingPlan} value={JSON.parse(fileContent.content)} />;
          } catch {
            return <pre className="json-preview">{fileContent.content}</pre>;
          }
        })()
      ) : null}
      {mode === "data" && !isCsv && !isJson ? (
        <pre className="json-preview">{fileContent.content}</pre>
      ) : null}
      {mode === "code" ? (
        <div className="code-editor">
          <textarea
            aria-label="文件内容编辑器"
            spellCheck={false}
            value={draftContent}
            onChange={(event) => {
              setDraft({ fileKey, content: event.target.value });
              setSaveState("idle");
              setSaveError(null);
            }}
          />
          <div className="editor-actions">
            <button
              disabled={saveState === "saving" || !hasUnsavedDraft}
              onClick={() => void saveFile()}
              type="button"
            >
              {saveState === "saving" ? "保存中..." : "保存文件"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ChartsEmptyState({
  onCleanDataset,
  onGenerateReport,
  onGenerateProfile,
  onGeneratePreprocessingPlan,
  onTransferToMl,
}: {
  onCleanDataset: () => Promise<void>;
  onGenerateReport: () => Promise<void>;
  onGenerateProfile: () => Promise<void>;
  onGeneratePreprocessingPlan: () => Promise<void>;
  onTransferToMl: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState<"profile" | "report" | "preprocess" | "clean" | "handoff" | null>(null);

  async function generateProfile() {
    setSubmitting("profile");
    try {
      await onGenerateProfile();
    } finally {
      setSubmitting(null);
    }
  }

  async function generateReport() {
    setSubmitting("report");
    try {
      await onGenerateReport();
    } finally {
      setSubmitting(null);
    }
  }

  async function generatePreprocessingPlan() {
    setSubmitting("preprocess");
    try {
      await onGeneratePreprocessingPlan();
    } finally {
      setSubmitting(null);
    }
  }

  async function cleanDataset() {
    setSubmitting("clean");
    try {
      await onCleanDataset();
    } finally {
      setSubmitting(null);
    }
  }

  async function transferToMl() {
    setSubmitting("handoff");
    try {
      await onTransferToMl();
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="chart-gallery">
      <section className="charts-empty">
        <BarChart3 size={22} />
        <strong>还没有图表产物</strong>
        <p>运行数据画像、报告或预处理，生成的分布、相关性等图表会显示在这里。</p>
      </section>
      <div className="panel-actions">
        <button disabled={submitting !== null} onClick={() => void generateProfile()}>
          <Table2 size={15} />
          {submitting === "profile" ? "画像中..." : "生成画像"}
        </button>
        <button disabled={submitting !== null} onClick={() => void generateReport()}>
          <FileText size={15} />
          {submitting === "report" ? "生成中..." : "生成报告"}
        </button>
        <button disabled={submitting !== null} onClick={() => void generatePreprocessingPlan()}>
          <RefreshCw size={15} />
          {submitting === "preprocess" ? "Planning..." : "Preprocess Plan"}
        </button>
        <button disabled={submitting !== null} onClick={() => void cleanDataset()}>
          <Database size={15} />
          {submitting === "clean" ? "清洗中..." : "清洗数据"}
        </button>
        <button disabled={submitting !== null} onClick={() => void transferToMl()}>
          <Play size={15} />
          {submitting === "handoff" ? "交接中..." : "传给 ML Agent"}
        </button>
      </div>
    </div>
  );
}

function TrainingPanel({
  activeFile,
  disabled,
  error,
  preprocessingPlanPath,
  result,
  runs,
  gpuStatus,
  gpuActionError,
  focusedExperimentId,
  projectId,
  suggestedTargetColumn,
  trainingDatasetPath,
  onCancelGpuTask,
  onRefreshGpuStatus,
  onOpenArtifactPath,
  onExportRunBundle,
  onTrainModel,
  onGenerateEvaluationReport,
}: {
  activeFile: string;
  disabled: boolean;
  error: string | null;
  preprocessingPlanPath?: string | null;
  result: TrainingResult | null;
  runs: ExperimentRun[];
  gpuStatus: GPUStatus | null;
  gpuActionError: string | null;
  focusedExperimentId?: string | null;
  projectId?: string;
  suggestedTargetColumn?: string;
  trainingDatasetPath?: string;
  onCancelGpuTask: (taskId: string) => Promise<void>;
  onRefreshGpuStatus: () => Promise<void>;
  onOpenArtifactPath: (path: string) => void;
  onExportRunBundle: (experimentId: string) => Promise<void>;
  onGenerateEvaluationReport: (experimentId: string) => Promise<void>;
  onTrainModel: (
    targetColumn: string,
    engine: TrainingEngine,
    useGpu: boolean,
    preprocessingPlanPath?: string | null,
  ) => Promise<void>;
}) {
  const [targetColumn, setTargetColumn] = useState(suggestedTargetColumn || "churn");
  const [engine, setEngine] = useState<TrainingEngine>("sklearn");
  const [useGpu, setUseGpu] = useState(false);
  const [usePreprocessingPlan, setUsePreprocessingPlan] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [predictionSamples, setPredictionSamples] = useState<PredictionSample[] | null>(null);
  const [predictionSampleError, setPredictionSampleError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [gpuBusyTaskId, setGpuBusyTaskId] = useState<string | null>(null);
  const [refreshingGpu, setRefreshingGpu] = useState(false);
  const [feedback, setFeedback] = useState<PanelActionFeedback | null>(null);
  const [reportExperimentId, setReportExperimentId] = useState<string | null>(null);
  const [exportExperimentId, setExportExperimentId] = useState<string | null>(null);
  const [runFilter, setRunFilter] = useState<ExperimentRunFilter>("all");
  const [runSort, setRunSort] = useState<ExperimentRunSort>("newest");
  const [candidateView, setCandidateView] = useState<CandidateRunView>("all");
  const [candidateSort, setCandidateSort] = useState<CandidateRunSort>("accuracy");
  const [sampleFilter, setSampleFilter] = useState<PredictionSampleFilter>({
    status: "all",
    actual: "",
    predicted: "",
    query: "",
  });
  const visibleRuns = useMemo(
    () => filterAndSortExperimentRuns(runs, { filter: runFilter, sort: runSort, focusedExperimentId }),
    [focusedExperimentId, runFilter, runSort, runs],
  );
  const selectedRun = runs.find((run) => run.experiment_id === selectedRunId) ?? visibleRuns[0] ?? runs[0];
  const featureImportance = Array.isArray(selectedRun?.model.feature_importance)
    ? (selectedRun.model.feature_importance as Array<{ feature?: string; importance?: number }>)
    : [];
  const permutationImportance = Array.isArray(selectedRun?.model.permutation_importance)
    ? selectedRun.model.permutation_importance
    : [];
  const linearCoefficients = Array.isArray(selectedRun?.model.linear_coefficients)
    ? selectedRun.model.linear_coefficients
    : [];
  const confusionMatrix = selectedRun?.metrics.confusion_matrix;
  const confusionLabels = confusionMatrix ? Object.keys(confusionMatrix) : [];
  const candidateRuns = useMemo(
    () =>
      filterAndSortCandidateRuns(selectedRun?.candidate_runs ?? [], {
        view: candidateView,
        sort: candidateSort,
        bestModelName: selectedRun?.best_model_name,
      }),
    [candidateSort, candidateView, selectedRun?.best_model_name, selectedRun?.candidate_runs],
  );
  const selectedPerClassRows = perClassRows(selectedRun?.metrics);
  const errorSlices = deriveErrorSlices(selectedRun?.metrics);
  const diagnosis = diagnosticSummary(errorSlices);
  const sampleOptions = useMemo(() => predictionSampleOptions(predictionSamples ?? []), [predictionSamples]);
  const filteredPredictionSamples = useMemo(
    () => filterPredictionSamples(predictionSamples ?? [], sampleFilter),
    [predictionSamples, sampleFilter],
  );
  const selectedSampleRows = filteredPredictionSamples.slice(0, 8);
  const selectedSampleErrorCount = predictionSamples?.filter((sample) => sample.is_error).length ?? 0;
  const selectedSampleFeatureColumns = Array.from(
    new Set(selectedSampleRows.flatMap((sample) => Object.keys(sample.features ?? {}).slice(0, 4))),
  );
  const activeDatasetPath = trainingDatasetPath || activeFile;
  const activePreprocessingPlanPath =
    engine === "sklearn" && usePreprocessingPlan && preprocessingPlanPath ? preprocessingPlanPath : null;

  useEffect(() => {
    if (suggestedTargetColumn) {
      setTargetColumn(suggestedTargetColumn);
    }
  }, [suggestedTargetColumn]);

  useEffect(() => {
    if (!focusedExperimentId) return;
    if (runs.some((run) => run.experiment_id === focusedExperimentId)) {
      setSelectedRunId(focusedExperimentId);
    }
  }, [focusedExperimentId, runs]);

  useEffect(() => {
    if (preprocessingPlanPath) {
      setUsePreprocessingPlan(true);
    }
  }, [preprocessingPlanPath]);

  useEffect(() => {
    const samplePath = selectedRun?.prediction_samples_artifact?.path;
    setSampleFilter({ status: "all", actual: "", predicted: "", query: "" });
    if (!projectId || !samplePath) {
      setPredictionSamples(null);
      setPredictionSampleError(null);
      return;
    }

    let cancelled = false;
    setPredictionSamples(null);
    setPredictionSampleError(null);
    readProjectFileContent(projectId, samplePath)
      .then((fileContent) => {
        if (cancelled) return;
        const parsed = JSON.parse(fileContent.content) as PredictionSamplesPreview;
        setPredictionSamples(Array.isArray(parsed.samples) ? parsed.samples : []);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setPredictionSampleError(
            nextError instanceof Error ? nextError.message : "Prediction samples could not be loaded.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, selectedRun?.prediction_samples_artifact?.path]);

  function resetRunFilters() {
    setRunFilter("all");
    setRunSort("newest");
  }

  function resetSampleFilters() {
    setSampleFilter({ status: "all", actual: "", predicted: "", query: "" });
  }

  async function submitTraining() {
    const normalizedTarget = targetColumn.trim();
    if (!normalizedTarget) {
      setFeedback({ kind: "warning", message: "请先填写目标列，例如 churn。" });
      return;
    }

    setSubmitting(true);
    setFeedback({
      kind: "info",
      message: `已提交 ${engine} 训练任务，数据集 ${activeDatasetPath}，目标列 ${normalizedTarget}${
        activePreprocessingPlanPath ? `，使用预处理计划 ${activePreprocessingPlanPath}` : ""
      }${useGpu ? "，已请求 GPU" : ""}。`,
    });
    try {
      await onTrainModel(normalizedTarget, engine, useGpu, activePreprocessingPlanPath);
      setFeedback({ kind: "success", message: "训练任务完成，指标、模型产物和实验历史已刷新。" });
    } catch (nextError) {
      setFeedback({
        kind: "error",
        message: nextError instanceof Error ? nextError.message : "训练任务失败，请查看日志详情。",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function refreshGpuStatus() {
    setRefreshingGpu(true);
    setFeedback({ kind: "info", message: "正在刷新 GPU 调度状态..." });
    try {
      await onRefreshGpuStatus();
      setFeedback({ kind: "success", message: "GPU 调度状态已刷新。" });
    } catch (nextError) {
      setFeedback({
        kind: "error",
        message: nextError instanceof Error ? nextError.message : "GPU 状态刷新失败。",
      });
    } finally {
      setRefreshingGpu(false);
    }
  }

  async function cancelGpuTask(taskId: string) {
    setGpuBusyTaskId(taskId);
    setFeedback({ kind: "info", message: `正在取消 GPU 任务 ${taskId}...` });
    try {
      await onCancelGpuTask(taskId);
      setFeedback({ kind: "success", message: `GPU 任务 ${taskId} 已取消。` });
    } catch (nextError) {
      setFeedback({
        kind: "error",
        message: nextError instanceof Error ? nextError.message : `GPU 任务 ${taskId} 取消失败。`,
      });
    } finally {
      setGpuBusyTaskId(null);
    }
  }

  async function regenerateEvaluationReport(experimentId: string) {
    setReportExperimentId(experimentId);
    setFeedback({ kind: "info", message: `Regenerating evaluation report for ${experimentId}...` });
    try {
      await onGenerateEvaluationReport(experimentId);
      setFeedback({ kind: "success", message: "Evaluation report regenerated and training history refreshed." });
    } catch (nextError) {
      setFeedback({
        kind: "error",
        message: nextError instanceof Error ? nextError.message : "Evaluation report regeneration failed.",
      });
    } finally {
      setReportExperimentId(null);
    }
  }

  async function exportBundle(experimentId: string) {
    setExportExperimentId(experimentId);
    setFeedback({ kind: "info", message: `Exporting handoff bundle for ${experimentId}...` });
    try {
      await onExportRunBundle(experimentId);
      setFeedback({ kind: "success", message: "Export bundle created and training history refreshed." });
    } catch (nextError) {
      setFeedback({
        kind: "error",
        message: nextError instanceof Error ? nextError.message : "Export bundle failed.",
      });
    } finally {
      setExportExperimentId(null);
    }
  }

  return (
    <div className="training-panel">
      <div className="segmented-control" aria-label="训练引擎">
        <button
          className={engine === "sklearn" ? "active" : ""}
          onClick={() => {
            setEngine("sklearn");
            setFeedback({ kind: "info", message: "已切换到 sklearn 实验，可按需申请 GPU 并生成候选模型对比。" });
          }}
        >
          sklearn 实验
        </button>
        <button
          className={engine === "baseline" ? "active" : ""}
          onClick={() => {
            setEngine("baseline");
            if (useGpu) setUseGpu(false);
            if (usePreprocessingPlan) setUsePreprocessingPlan(false);
            setFeedback({ kind: "info", message: "已切换到快速 baseline。baseline 不使用 GPU，适合先建立对照。" });
          }}
        >
          快速 baseline
        </button>
      </div>
      <div className="training-form">
        <label>
          目标列
          <input value={targetColumn} onChange={(event) => setTargetColumn(event.target.value)} />
        </label>
        <button disabled={disabled || submitting || !targetColumn.trim()} onClick={submitTraining}>
          {submitting ? "训练中..." : engine === "sklearn" ? "启动 sklearn 训练" : "训练 baseline"}
        </button>
      </div>
      <label className="gpu-toggle">
        <input
          checked={useGpu}
          disabled={engine !== "sklearn"}
          type="checkbox"
          onChange={(event) => {
            setUseGpu(event.target.checked);
            setFeedback({
              kind: event.target.checked ? "info" : "success",
              message: event.target.checked ? "下一次 sklearn 训练会申请 GPU 资源。" : "已关闭 GPU 请求，下一次训练将使用普通执行。",
            });
          }}
        />
        <span>请求 GPU 执行</span>
      </label>
      <label className="gpu-toggle plan-toggle">
        <input
          checked={Boolean(activePreprocessingPlanPath)}
          disabled={engine !== "sklearn" || !preprocessingPlanPath}
          type="checkbox"
          onChange={(event) => {
            setUsePreprocessingPlan(event.target.checked);
            setFeedback({
              kind: event.target.checked ? "info" : "warning",
              message: event.target.checked
                ? `下一次 sklearn 训练会使用预处理计划 ${preprocessingPlanPath}。`
                : "已关闭预处理计划，下一次 sklearn 训练会直接从原始数据建模。",
            });
          }}
        />
        <span>使用 Preprocessing Plan</span>
      </label>
      {preprocessingPlanPath ? (
        <div className="plan-reference" role="status">
          <span>Plan</span>
          <code>{preprocessingPlanPath}</code>
        </div>
      ) : (
        <div className="plan-reference muted" role="status">
          <span>Plan</span>
          <code>Run Preprocess Plan in analysis first to enable planned sklearn training.</code>
        </div>
      )}
      {engine !== "sklearn" && useGpu ? (
        <div className="action-feedback warning" role="status">
          baseline 训练不支持 GPU，请切回 sklearn 实验后再申请 GPU。
        </div>
      ) : null}
      <div className="gpu-resource-panel" aria-label="GPU 队列状态">
        <div className="gpu-resource-header">
          <div>
            <span>GPU 调度</span>
            <strong>{gpuStatus?.status === "busy" ? "繁忙" : gpuStatus?.status === "idle" ? "空闲" : "未知"}</strong>
          </div>
          <button disabled={disabled || refreshingGpu} onClick={() => void refreshGpuStatus()} title="刷新 GPU 状态">
            <RefreshCw size={14} />
            {refreshingGpu ? "刷新中" : "刷新"}
          </button>
        </div>
        {gpuActionError ? <div className="inline-alert compact-alert">{gpuActionError}</div> : null}
        {gpuStatus?.active_task ? (
          <div className="gpu-task-row active">
            <div>
              <span>运行中</span>
              <code>{gpuStatus.active_task.task_id}</code>
              <small>{gpuStatus.active_task.started_at}</small>
            </div>
            <button
              disabled={gpuBusyTaskId === gpuStatus.active_task.task_id}
              onClick={() => {
                if (gpuStatus.active_task) void cancelGpuTask(gpuStatus.active_task.task_id);
              }}
              title="取消运行中的 GPU 任务"
            >
              <XCircle size={14} />
              {gpuBusyTaskId === gpuStatus.active_task.task_id ? "取消中" : "取消"}
            </button>
          </div>
        ) : (
          <div className="gpu-empty">当前没有运行中的 GPU 任务。</div>
        )}
        {gpuStatus && gpuStatus.queue_length > 0 ? (
          <div className="gpu-queue-list">
            {gpuStatus.queue.map((item) => (
              <div className="gpu-task-row" key={item.task_id}>
                <div>
                  <span>排队 #{item.position}</span>
                  <code>{item.task_id}</code>
                  <small>{item.requested_at}</small>
                </div>
                <button
                  disabled={gpuBusyTaskId === item.task_id}
                  onClick={() => void cancelGpuTask(item.task_id)}
                  title="取消排队中的 GPU 任务"
                >
                  <XCircle size={14} />
                  {gpuBusyTaskId === item.task_id ? "取消中" : "取消"}
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {feedback ? (
        <div className={`action-feedback ${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>
          {feedback.message}
        </div>
      ) : null}
      <div className="training-snapshot">
        <div>
          <span>数据集</span>
          <strong>{activeDatasetPath}</strong>
        </div>
        <div>
          <span>引擎</span>
          <strong>{result?.engine ?? engine}</strong>
        </div>
        <div>
          <span>GPU</span>
          <strong>{result?.use_gpu || useGpu ? "已请求" : "未请求"}</strong>
        </div>
        <div>
          <span>状态</span>
          <strong>{result ? "已完成" : submitting ? "运行中" : "等待建模任务"}</strong>
        </div>
        <div>
          <span>Plan</span>
          <strong>{activePreprocessingPlanPath ?? "未使用"}</strong>
        </div>
      </div>
      {error ? <div className="inline-alert">{error}</div> : null}
      {result ? (
        <div className="metrics-grid">
          <div>
            <span>Accuracy</span>
            <strong>{formatMetricPercent(result.metrics.accuracy)}</strong>
          </div>
          <div>
            <span>F1 weighted</span>
            <strong>{formatMetricPercent(result.metrics.f1_weighted)}</strong>
          </div>
          <div>
            <span>Rows</span>
            <strong>{formatMetricCount(result.metrics.row_count)}</strong>
          </div>
          <div>
            <span>Best Model</span>
            <strong>{String(result.model.strategy ?? result.model.algorithm)}</strong>
          </div>
        </div>
      ) : null}
      <div className="model-compare">
        <div className="panel-title">历史实验</div>
        {runs.length === 0 ? (
          <GuidedEmptyState description="配置目标列并启动一次训练后，这里会显示可比较的实验历史。" title="还没有训练记录" />
        ) : (
          <>
            <div className="table-controls">
              <label>
                Filter
                <select value={runFilter} onChange={(event) => setRunFilter(event.target.value as ExperimentRunFilter)}>
                  <option value="all">All runs</option>
                  <option value="sklearn">sklearn</option>
                  <option value="baseline">baseline</option>
                  <option value="gpu">GPU only</option>
                  <option value="focused">Focused</option>
                </select>
              </label>
              <label>
                Sort
                <select value={runSort} onChange={(event) => setRunSort(event.target.value as ExperimentRunSort)}>
                  <option value="newest">Newest</option>
                  <option value="accuracy">Accuracy</option>
                  <option value="f1">F1</option>
                  <option value="evalRows">Eval rows</option>
                </select>
              </label>
            </div>
            {visibleRuns.length === 0 ? (
              <GuidedEmptyState
                actionLabel="重置实验筛选"
                description="重置筛选后可查看全部历史运行。"
                onAction={resetRunFilters}
                title="当前筛选没有匹配的实验"
              />
            ) : (
              <table>
            <thead>
              <tr>
                <th>引擎</th>
                <th>最佳模型</th>
                <th>Accuracy</th>
                <th>F1</th>
                <th>Eval</th>
                <th>GPU</th>
              </tr>
            </thead>
            <tbody>
              {visibleRuns.map((run) => {
                const rowClassName = [
                  run.experiment_id === selectedRun?.experiment_id ? "selected-row" : "",
                  run.experiment_id === focusedExperimentId ? "graph-focused-row" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <tr className={rowClassName} key={run.experiment_id} onClick={() => setSelectedRunId(run.experiment_id)}>
                    <td>{run.engine}</td>
                    <td>{run.best_model_name}</td>
                    <td>{formatMetricPercent(run.metrics.accuracy)}</td>
                    <td>{formatMetricPercent(run.metrics.f1_weighted)}</td>
                    <td>{formatMetricCount(run.metrics.eval_row_count ?? run.metrics.row_count)}</td>
                    <td>{run.use_gpu ? "是" : "否"}</td>
                  </tr>
                );
              })}
            </tbody>
              </table>
            )}
          </>
        )}
      </div>
      {selectedRun ? (
        <div className="experiment-detail">
          <div className="experiment-detail-actions">
            <button
              className="table-title-action"
              disabled={reportExperimentId === selectedRun.experiment_id}
              onClick={() => void regenerateEvaluationReport(selectedRun.experiment_id)}
              type="button"
            >
              {reportExperimentId === selectedRun.experiment_id ? "Regenerating..." : "Regenerate Report"}
            </button>
            <button
              className="table-title-action"
              disabled={exportExperimentId === selectedRun.experiment_id}
              onClick={() => void exportBundle(selectedRun.experiment_id)}
              type="button"
            >
              {exportExperimentId === selectedRun.experiment_id ? "Exporting..." : "Export Bundle"}
            </button>
          </div>
          <div className="panel-title">实验详情</div>
          {selectedRun.experiment_id === focusedExperimentId ? (
            <div className="experiment-focus-note">来自知识图谱定位</div>
          ) : null}
          <div className="detail-grid">
            <div>
              <span>实验 ID</span>
              <code>{selectedRun.experiment_id}</code>
            </div>
            <div>
              <span>目标列</span>
              <strong>{selectedRun.target_column}</strong>
            </div>
            <div>
              <span>模型文件</span>
              <code>{selectedRun.model_artifact.path}</code>
            </div>
            <ArtifactPathRow label="Metrics JSON" path={selectedRun.metrics_artifact.path} onOpen={onOpenArtifactPath} />
            {selectedRun.evaluation_report_artifact ? (
              <ArtifactPathRow
                label="Evaluation Report"
                path={selectedRun.evaluation_report_artifact.path}
                onOpen={onOpenArtifactPath}
              />
            ) : null}
            {selectedRun.prediction_samples_artifact ? (
              <ArtifactPathRow
                label="Prediction Samples"
                path={selectedRun.prediction_samples_artifact.path}
                onOpen={onOpenArtifactPath}
              />
            ) : null}
            {selectedRun.preprocessing_plan_artifact ? (
              <ArtifactPathRow
                label="Preprocessing Plan"
                path={selectedRun.preprocessing_plan_artifact.path}
                onOpen={onOpenArtifactPath}
              />
            ) : null}
            {selectedRun.export_bundle_artifact ? (
              <ArtifactPathRow
                downloadUrl={
                  projectId ? projectFileDownloadUrl(projectId, selectedRun.export_bundle_artifact.path) : undefined
                }
                label="Export Bundle"
                path={selectedRun.export_bundle_artifact.path}
                onOpen={onOpenArtifactPath}
              />
            ) : null}
          </div>
          <div className="detail-grid evaluation-summary">
            <div>
              <span>璇勪及绛栫暐</span>
              <strong>{formatHoldoutStrategy(selectedRun.metrics.holdout_strategy)}</strong>
            </div>
            <div>
              <span>Train / Eval</span>
              <strong>
                {formatMetricCount(selectedRun.metrics.train_row_count)} /{" "}
                {formatMetricCount(selectedRun.metrics.eval_row_count ?? selectedRun.metrics.row_count)}
              </strong>
            </div>
            <div>
              <span>Class Count</span>
              <strong>{formatMetricCount(selectedRun.metrics.class_count)}</strong>
            </div>
          </div>
          <div className="diagnostic-summary">
            <div>
              <span>Worst class</span>
              <strong>{diagnosis.worstClass ?? "None"}</strong>
            </div>
            <div>
              <span>Main confusion</span>
              <strong>{diagnosis.mainConfusion ?? "None"}</strong>
            </div>
            <div>
              <span>Error rows</span>
              <strong>{diagnosis.errorCount}</strong>
            </div>
            <p>{diagnosis.recommendation}</p>
          </div>
          {candidateRuns.length > 0 ? (
            <div className="model-compare nested candidate-run-table">
              <div className="panel-title">候选模型对比</div>
              <div className="table-controls">
                <label>
                  View
                  <select value={candidateView} onChange={(event) => setCandidateView(event.target.value as CandidateRunView)}>
                    <option value="all">All candidates</option>
                    <option value="best">Best only</option>
                  </select>
                </label>
                <label>
                  Sort
                  <select value={candidateSort} onChange={(event) => setCandidateSort(event.target.value as CandidateRunSort)}>
                    <option value="accuracy">Accuracy</option>
                    <option value="f1">F1</option>
                    <option value="evalRows">Eval rows</option>
                    <option value="model">Model</option>
                  </select>
                </label>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Accuracy</th>
                    <th>F1</th>
                    <th>Eval</th>
                    <th>Strategy</th>
                  </tr>
                </thead>
                <tbody>
                  {candidateRuns.map((candidate) => (
                    <tr key={candidate.model_name}>
                      <td>{candidate.model_name}</td>
                      <td>{formatMetricPercent(candidate.metrics.accuracy)}</td>
                      <td>{formatMetricPercent(candidate.metrics.f1_weighted)}</td>
                      <td>{formatMetricCount(candidate.metrics.eval_row_count ?? candidate.metrics.row_count)}</td>
                      <td>{formatHoldoutStrategy(candidate.metrics.holdout_strategy)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {selectedPerClassRows.length > 0 ? (
            <div className="model-compare nested per-class-table">
              <div className="panel-title">类别质量</div>
              <table>
                <thead>
                  <tr>
                    <th>Class</th>
                    <th>Precision</th>
                    <th>Recall</th>
                    <th>F1</th>
                    <th>Support</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedPerClassRows.map(([label, metrics]) => (
                    <tr key={label}>
                      <td>{label}</td>
                      <td>{formatMetricPercent(metrics.precision)}</td>
                      <td>{formatMetricPercent(metrics.recall)}</td>
                      <td>{formatMetricPercent(metrics.f1)}</td>
                      <td>{formatMetricCount(metrics.support)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {errorSlices.length > 0 ? (
            <div className="model-compare nested error-slice-table">
              <div className="panel-title">Error Slices</div>
              <table>
                <thead>
                  <tr>
                    <th>True Class</th>
                    <th>Support</th>
                    <th>Errors</th>
                    <th>Error Rate</th>
                    <th>Main Confusion</th>
                  </tr>
                </thead>
                <tbody>
                  {errorSlices.map((slice) => (
                    <tr
                      key={slice.label}
                      className={slice.errors > 0 ? "warning-row clickable-row" : "clickable-row"}
                      onClick={() => {
                        setSampleFilter({
                          status: slice.errors > 0 ? "errors" : "all",
                          actual: slice.label,
                          predicted: slice.primaryConfusion?.label ?? "",
                          query: "",
                        });
                      }}
                      title="Filter prediction samples for this class"
                    >
                      <td>{slice.label}</td>
                      <td>{formatMetricCount(slice.support)}</td>
                      <td>{formatMetricCount(slice.errors)}</td>
                      <td>{formatMetricPercent(slice.errorRate)}</td>
                      <td>
                        {slice.primaryConfusion
                          ? `${slice.primaryConfusion.label} (${slice.primaryConfusion.count}, ${formatMetricPercent(
                              slice.primaryConfusion.rate,
                            )})`
                          : "No errors"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {selectedRun.prediction_samples_artifact ? (
            <div className="model-compare nested prediction-sample-table">
              <div className="panel-title">
                <span>Prediction Samples</span>
                <button
                  className="table-title-action"
                  onClick={() => onOpenArtifactPath(selectedRun.prediction_samples_artifact!.path)}
                  type="button"
                >
                  Open
                </button>
              </div>
              {predictionSampleError ? <div className="inline-alert compact-alert">{predictionSampleError}</div> : null}
              {predictionSamples === null && !predictionSampleError ? (
                <div className="empty-state compact-empty" role="status">正在读取预测样本…</div>
              ) : null}
              {predictionSamples && predictionSamples.length === 0 ? (
                <GuidedEmptyState
                  description="该运行没有可供诊断的行级样本；可打开样本产物检查生成结果，或重新运行评估。"
                  title="当前运行没有记录预测样本"
                />
              ) : null}
              {predictionSamples && predictionSamples.length > 0 ? (
                <>
                  <div className="table-controls sample-controls">
                    <label>
                      Status
                      <select
                        value={sampleFilter.status}
                        onChange={(event) =>
                          setSampleFilter((current) => ({
                            ...current,
                            status: event.target.value as PredictionSampleFilter["status"],
                          }))
                        }
                      >
                        <option value="all">All samples</option>
                        <option value="errors">Errors only</option>
                      </select>
                    </label>
                    <label>
                      Actual
                      <select
                        value={sampleFilter.actual}
                        onChange={(event) => setSampleFilter((current) => ({ ...current, actual: event.target.value }))}
                      >
                        <option value="">Any actual</option>
                        {sampleOptions.actualLabels.map((label) => (
                          <option key={label} value={label}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Predicted
                      <select
                        value={sampleFilter.predicted}
                        onChange={(event) => setSampleFilter((current) => ({ ...current, predicted: event.target.value }))}
                      >
                        <option value="">Any predicted</option>
                        {sampleOptions.predictedLabels.map((label) => (
                          <option key={label} value={label}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Search
                      <input
                        value={sampleFilter.query}
                        onChange={(event) => setSampleFilter((current) => ({ ...current, query: event.target.value }))}
                        placeholder="row, label, feature"
                      />
                    </label>
                  </div>
                  <div className="sample-summary-strip">
                    <span>
                      {filteredPredictionSamples.length} / {predictionSamples.length} samples
                    </span>
                    <strong>{selectedSampleErrorCount} total errors</strong>
                  </div>
                  {selectedSampleRows.length > 0 ? (
                    <table>
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Actual</th>
                          <th>Predicted</th>
                          <th>Status</th>
                          {selectedSampleFeatureColumns.map((column) => (
                            <th key={column}>{column}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedSampleRows.map((sample, index) => (
                          <tr className={sample.is_error ? "warning-row" : ""} key={`${sample.row_index ?? index}-${index}`}>
                            <td>{formatSampleValue(sample.row_index)}</td>
                            <td>{formatSampleValue(sample.actual)}</td>
                            <td>{formatSampleValue(sample.predicted)}</td>
                            <td>{sample.is_error ? "Error" : "Correct"}</td>
                            {selectedSampleFeatureColumns.map((column) => (
                              <td key={column}>{formatSampleValue(sample.features?.[column])}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <GuidedEmptyState
                      actionLabel="重置样本筛选"
                      description="调整条件，或重置筛选后查看全部样本。"
                      onAction={resetSampleFilters}
                      title="当前筛选没有匹配的预测样本"
                    />
                  )}
                </>
              ) : null}
            </div>
          ) : null}
          {permutationImportance.length > 0 ? (
            <div className="model-compare nested explanation-table">
              <div className="panel-title">Permutation Importance</div>
              <table>
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th>Mean</th>
                    <th>Std</th>
                  </tr>
                </thead>
                <tbody>
                  {permutationImportance.slice(0, 8).map((item) => (
                    <tr key={String(item.feature)}>
                      <td>{item.feature}</td>
                      <td>{typeof item.mean_importance === "number" ? item.mean_importance.toFixed(4) : "-"}</td>
                      <td>{typeof item.std_importance === "number" ? item.std_importance.toFixed(4) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {linearCoefficients.length > 0 ? (
            <div className="model-compare nested coefficient-table">
              <div className="panel-title">Linear Coefficients</div>
              <table>
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th>Coefficient</th>
                    <th>Abs</th>
                  </tr>
                </thead>
                <tbody>
                  {linearCoefficients.slice(0, 8).map((item) => (
                    <tr key={String(item.feature)}>
                      <td>{item.feature}</td>
                      <td>{typeof item.coefficient === "number" ? item.coefficient.toFixed(4) : "-"}</td>
                      <td>{typeof item.abs_coefficient === "number" ? item.abs_coefficient.toFixed(4) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {selectedRun.model.explanation_warning ? (
            <div className="inline-alert compact-alert">{selectedRun.model.explanation_warning}</div>
          ) : null}
          {featureImportance.length > 0 ? (
            <div className="model-compare nested">
              <div className="panel-title">特征重要性</div>
              <table>
                <tbody>
                  {featureImportance.slice(0, 8).map((item) => (
                    <tr key={String(item.feature)}>
                      <td>{item.feature}</td>
                      <td>{typeof item.importance === "number" ? item.importance.toFixed(4) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {confusionMatrix && confusionLabels.length > 0 ? (
            <div className="model-compare nested">
              <div className="panel-title">混淆矩阵</div>
              <table>
                <thead>
                  <tr>
                    <th>真实 \\ 预测</th>
                    {confusionLabels.map((label) => (
                      <th key={label}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {confusionLabels.map((label) => (
                    <tr key={label}>
                      <th>{label}</th>
                      {confusionLabels.map((predicted) => (
                        <td key={predicted}>{confusionMatrix[label]?.[predicted] ?? 0}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function RightPanel({
  events,
  projectId,
  sessionId,
  trainingRuns,
  gpuStatus,
  onCleanDataset,
  onExecutePreprocessingPlan,
  onExportRunBundle,
  onGenerateReport,
  onGenerateEvaluationReport,
  onGenerateProfile,
  onGeneratePreprocessingPlan,
  onTransferToMl,
  onSelectFile,
  onTrainModel,
  onCancelGpuTask,
  onRefreshGpuStatus,
}: RightPanelProps) {
  // 这些 UI 字段已迁入 uiStore，改为直接订阅（替代原先经 AppShell 钻取的 props）。
  const trainingError = useUiStore((state) => state.trainingError);
  const trainingResult = useUiStore((state) => state.trainingResult);
  const gpuActionError = useUiStore((state) => state.gpuActionError);
  const focusedLogTaskId = useUiStore((state) => state.focusedLogTaskId);
  const rightPanelTab = useUiStore((state) => state.rightPanelTab);
  const mode = useUiStore((state) => state.activeMode);
  const activeFile = useUiStore((state) => state.activeFile);
  const focusedExperimentId = useUiStore((state) => state.focusedExperimentId);
  const preprocessingPlanPath = useUiStore((state) => state.selectedPreprocessingPlanPath);
  const trainingDatasetPath = useUiStore((state) => state.trainingDatasetPath);
  const suggestedTargetColumn = useUiStore((state) => state.suggestedTargetColumn);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>(() => (rightPanelTab ? tabById[rightPanelTab] : "图表"));
  const [tabPinnedByUser, setTabPinnedByUser] = useState(false);
  // evolution 模式的主区是自进化工作台，不该被数据/训练工作流拽动检查器
  const workflowTab = useMemo(
    () =>
      mode === "evolution"
        ? null
        : inspectorTabForWorkflow(deriveWorkflowState(events, mode, activeFile)),
    [activeFile, events, mode],
  );

  function selectTab(tab: (typeof tabs)[number]) {
    setTabPinnedByUser(true);
    setActiveTab(tab);
  }
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | undefined>();
  const [panelFeedback, setPanelFeedback] = useState<PanelActionFeedback | null>(null);
  const artifactContentQuery = useProjectFileContentQuery(projectId, selectedArtifact?.path, selectedArtifact?.id);
  const artifactContent = artifactContentQuery.data?.content ?? null;
  const artifactError =
    artifactContentQuery.error instanceof Error
      ? artifactContentQuery.error.message
      : artifactContentQuery.error
        ? "产物读取失败"
        : null;
  const artifacts = useMemo(() => artifactEvents(events), [events]);
  const chartArtifacts = artifacts.filter((artifact) => artifact.type === "chart");
  const dataArtifacts = artifacts.filter((artifact) => artifact.type === "dataframe");
  const codeArtifacts = artifacts.filter((artifact) => ["code", "markdown", "report"].includes(artifact.type));
  const activeArtifacts =
    activeTab === "图表" ? chartArtifacts : activeTab === "数据" ? dataArtifacts : codeArtifacts;

  function virtualArtifactForPath(path: string, openedFrom: string): Artifact {
    return {
      id: `path:${path}`,
      project_id: projectId ?? "",
      session_id: sessionId ?? "manual",
      type: previewArtifactType(path),
      name: artifactNameFromPath(path),
      path,
      metadata: { opened_from: openedFrom },
      created_at: new Date().toISOString(),
    };
  }

  function openArtifactPath(path: string) {
    onSelectFile(path);
    setActiveTab(previewTabForPath(path));
    setSelectedArtifact(virtualArtifactForPath(path, "training_detail"));
    setPanelFeedback({ kind: "info", message: `Opening ${path}` });
  }

  // 选中产物同时设为活动文件：两者都表示"右侧正在看什么"，各自为政会让
  // cockpit 打开产物后预览仍停在旧产物上。
  function selectArtifact(artifact: Artifact) {
    setSelectedArtifact(artifact);
    onSelectFile(artifact.path);
  }

  // 切换主模式或跟随深链都是显式导航，会重新交还给自动跟随。
  useEffect(() => {
    setTabPinnedByUser(false);
    if (rightPanelTab) {
      setActiveTab(tabById[rightPanelTab]);
      return;
    }
    setActiveTab(mode === "machine-learning" ? "训练" : mode === "evolution" ? "日志" : "图表");
  }, [rightPanelTab, mode]);

  // 检查器跟随工作流所处阶段：训练完成后不该还停在图表页。
  // 深链和用户手动选择都优先于自动跟随。
  useEffect(() => {
    if (rightPanelTab || tabPinnedByUser || !workflowTab) return;
    setActiveTab(tabById[workflowTab]);
  }, [rightPanelTab, tabPinnedByUser, workflowTab]);

  useEffect(() => {
    if (!["图表", "代码", "数据"].includes(activeTab)) {
      setSelectedArtifact(undefined);
      return;
    }
    // 活动文件由 cockpit 的打开产物、文件树和深链共同驱动，预览应当跟随它。
    // 命中已知产物时选中该产物；否则清空选中，交给功能更完整的活动文件预览
    // （它同样渲染结构化 JSON，并额外提供刷新、编辑、保存与二进制下载）。
    if (activeFile && selectedArtifact?.path !== activeFile) {
      setSelectedArtifact(artifacts.find((artifact) => artifact.path === activeFile));
      return;
    }
    if (!selectedArtifact && !activeFile) {
      setSelectedArtifact(activeArtifacts[0]);
    }
  }, [activeArtifacts, activeFile, activeTab, artifacts, selectedArtifact]);

  function exportCurrentPanel() {
    const payload = {
      exported_at: new Date().toISOString(),
      panel: activeTab,
      mode,
      project_id: projectId ?? null,
      session_id: sessionId ?? null,
      active_file: activeFile,
      selected_artifact: selectedArtifact ?? null,
      artifact_content: artifactContent,
      artifact_error: artifactError,
      training: {
        error: trainingError,
        latest_result: trainingResult,
        runs: trainingRuns,
        focused_experiment_id: focusedExperimentId ?? null,
      },
      gpu: {
        status: gpuStatus,
        action_error: gpuActionError,
      },
      events: events.slice(-50),
    };

    downloadJsonFile(formatPanelFilename(activeTab), payload);
    setPanelFeedback({ kind: "success", message: `已导出 ${activeTab} 面板摘要。` });
  }

  return (
    <section className="right-panel">
      <div className="right-tabs">
        {tabs.map((tab) => (
          <button
            aria-pressed={tab === activeTab}
            key={tab}
            className={tab === activeTab ? "active" : ""}
            onClick={() => selectTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>
      {activeTab === "图表" ? (
        <>
          <ArtifactList artifacts={chartArtifacts} selectedId={selectedArtifact?.id} onSelect={selectArtifact} />
          {selectedArtifact ? (
            <ArtifactPreview
              artifact={selectedArtifact}
              busy={artifactContentQuery.isFetching}
              content={artifactContent}
              error={artifactError}
              onRetry={() => void artifactContentQuery.refetch()}
            />
          ) : (
            <ChartsEmptyState
              onCleanDataset={onCleanDataset}
              onGenerateReport={onGenerateReport}
              onGenerateProfile={onGenerateProfile}
              onGeneratePreprocessingPlan={onGeneratePreprocessingPlan}
              onTransferToMl={onTransferToMl}
            />
          )}
        </>
      ) : null}
      {activeTab === "代码" ? (
        <>
          <ArtifactList artifacts={codeArtifacts} selectedId={selectedArtifact?.id} onSelect={selectArtifact} />
          {selectedArtifact ? (
            <ArtifactPreview
              artifact={selectedArtifact}
              busy={artifactContentQuery.isFetching}
              content={artifactContent}
              error={artifactError}
              onRetry={() => void artifactContentQuery.refetch()}
            />
          ) : (
            <ActiveFilePreview activeFile={activeFile} mode="code" projectId={projectId} />
          )}
        </>
      ) : null}
      {activeTab === "数据" ? (
        <>
          <ArtifactList artifacts={dataArtifacts} selectedId={selectedArtifact?.id} onSelect={selectArtifact} />
          {selectedArtifact ? (
            <ArtifactPreview
              artifact={selectedArtifact}
              busy={artifactContentQuery.isFetching}
              content={artifactContent}
              error={artifactError}
              onExecutePreprocessingPlan={onExecutePreprocessingPlan}
              onRetry={() => void artifactContentQuery.refetch()}
            />
          ) : (
            <ActiveFilePreview
              activeFile={activeFile}
              mode="data"
              onExecutePreprocessingPlan={onExecutePreprocessingPlan}
              projectId={projectId}
            />
          )}
        </>
      ) : null}
      {activeTab === "训练" ? (
        <TrainingPanel
          activeFile={activeFile}
          disabled={!projectId}
          error={trainingError}
          preprocessingPlanPath={preprocessingPlanPath}
          result={trainingResult}
          runs={trainingRuns}
          gpuStatus={gpuStatus}
          gpuActionError={gpuActionError}
          focusedExperimentId={focusedExperimentId}
          projectId={projectId}
          suggestedTargetColumn={suggestedTargetColumn}
          trainingDatasetPath={trainingDatasetPath}
          onCancelGpuTask={onCancelGpuTask}
          onExportRunBundle={onExportRunBundle}
          onGenerateEvaluationReport={onGenerateEvaluationReport}
          onOpenArtifactPath={openArtifactPath}
          onRefreshGpuStatus={onRefreshGpuStatus}
          onTrainModel={onTrainModel}
        />
      ) : null}
      {activeTab === "日志" ? <LogPanel events={events} focusedTaskId={focusedLogTaskId} sessionId={sessionId} /> : null}
      {panelFeedback ? (
        <div className={`action-feedback ${panelFeedback.kind}`} role={panelFeedback.kind === "error" ? "alert" : "status"}>
          {panelFeedback.message}
        </div>
      ) : null}
      <div className="right-panel-footer">
        <button onClick={exportCurrentPanel} type="button">
          <Download size={14} />
          导出当前面板
        </button>
      </div>
    </section>
  );
}
