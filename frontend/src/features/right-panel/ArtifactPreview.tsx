import { Play, RefreshCw } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import type { Artifact } from "../chat/types";
import { formatSampleValue } from "./panelFormat";
import type {
  PanelActionFeedback,
  PredictionSamplesPreview,
  PreprocessingPlanPreviewValue,
} from "./panelTypes";
import {
  buildTransformDiff,
  isTransformationReport,
  type TransformDiff,
  type TransformDiffRow,
} from "./transformDiff";

// Lazy so Recharts loads only when a histogram artifact is opened, keeping it
// out of the initial bundle.
const HistogramChart = lazy(() => import("./HistogramChart"));

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

export function JsonTable({
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

export function ArtifactPreview({
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
