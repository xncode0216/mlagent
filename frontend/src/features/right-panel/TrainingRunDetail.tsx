import { useEffect, useMemo, useState } from "react";

import { projectFileDownloadUrl, readProjectFileContent, type ExperimentRun } from "../../lib/api";
import { deriveErrorSlices } from "./errorSlices";
import { ArtifactPathRow, GuidedEmptyState } from "./PanelPrimitives";
import {
  formatHoldoutStrategy,
  formatMetricCount,
  formatMetricPercent,
  formatSampleValue,
  perClassRows,
} from "./panelFormat";
import type { PanelActionFeedback, PredictionSamplesPreview } from "./panelTypes";
import {
  diagnosticSummary,
  filterAndSortCandidateRuns,
  filterPredictionSamples,
  predictionSampleOptions,
  type CandidateRunSort,
  type CandidateRunView,
  type PredictionSample,
  type PredictionSampleFilter,
} from "./trainingDiagnostics";

const EMPTY_SAMPLE_FILTER: PredictionSampleFilter = { status: "all", actual: "", predicted: "", query: "" };

/**
 * 选中实验的详情视图。样本读取、切片筛选与候选模型排序只服务于这一视图，
 * 因此状态留在这里；只有面板级反馈和「打开产物」需要交回父面板。
 */
export function TrainingRunDetail({
  focusedExperimentId,
  projectId,
  run,
  onExportRunBundle,
  onFeedback,
  onGenerateEvaluationReport,
  onOpenArtifactPath,
}: {
  focusedExperimentId?: string | null;
  projectId?: string;
  run: ExperimentRun;
  onExportRunBundle: (experimentId: string) => Promise<void>;
  onFeedback: (feedback: PanelActionFeedback) => void;
  onGenerateEvaluationReport: (experimentId: string) => Promise<void>;
  onOpenArtifactPath: (path: string) => void;
}) {
  const [candidateView, setCandidateView] = useState<CandidateRunView>("all");
  const [candidateSort, setCandidateSort] = useState<CandidateRunSort>("accuracy");
  const [predictionSamples, setPredictionSamples] = useState<PredictionSample[] | null>(null);
  const [predictionSampleError, setPredictionSampleError] = useState<string | null>(null);
  const [sampleFilter, setSampleFilter] = useState<PredictionSampleFilter>(EMPTY_SAMPLE_FILTER);
  const [reportExperimentId, setReportExperimentId] = useState<string | null>(null);
  const [exportExperimentId, setExportExperimentId] = useState<string | null>(null);

  const featureImportance = Array.isArray(run.model.feature_importance)
    ? (run.model.feature_importance as Array<{ feature?: string; importance?: number }>)
    : [];
  const permutationImportance = Array.isArray(run.model.permutation_importance)
    ? run.model.permutation_importance
    : [];
  const linearCoefficients = Array.isArray(run.model.linear_coefficients) ? run.model.linear_coefficients : [];
  const confusionMatrix = run.metrics.confusion_matrix;
  const confusionLabels = confusionMatrix ? Object.keys(confusionMatrix) : [];
  const candidateRuns = useMemo(
    () =>
      filterAndSortCandidateRuns(run.candidate_runs ?? [], {
        view: candidateView,
        sort: candidateSort,
        bestModelName: run.best_model_name,
      }),
    [candidateSort, candidateView, run.best_model_name, run.candidate_runs],
  );
  const selectedPerClassRows = perClassRows(run.metrics);
  const errorSlices = deriveErrorSlices(run.metrics);
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

  const samplePath = run.prediction_samples_artifact?.path;

  useEffect(() => {
    setSampleFilter(EMPTY_SAMPLE_FILTER);
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
  }, [projectId, samplePath]);

  function resetSampleFilters() {
    setSampleFilter(EMPTY_SAMPLE_FILTER);
  }

  async function regenerateEvaluationReport(experimentId: string) {
    setReportExperimentId(experimentId);
    onFeedback({ kind: "info", message: `Regenerating evaluation report for ${experimentId}...` });
    try {
      await onGenerateEvaluationReport(experimentId);
      onFeedback({ kind: "success", message: "Evaluation report regenerated and training history refreshed." });
    } catch (nextError) {
      onFeedback({
        kind: "error",
        message: nextError instanceof Error ? nextError.message : "Evaluation report regeneration failed.",
      });
    } finally {
      setReportExperimentId(null);
    }
  }

  async function exportBundle(experimentId: string) {
    setExportExperimentId(experimentId);
    onFeedback({ kind: "info", message: `Exporting handoff bundle for ${experimentId}...` });
    try {
      await onExportRunBundle(experimentId);
      onFeedback({ kind: "success", message: "Export bundle created and training history refreshed." });
    } catch (nextError) {
      onFeedback({
        kind: "error",
        message: nextError instanceof Error ? nextError.message : "Export bundle failed.",
      });
    } finally {
      setExportExperimentId(null);
    }
  }

  return (
    <div className="experiment-detail">
      <div className="experiment-detail-actions">
        <button
          className="table-title-action"
          disabled={reportExperimentId === run.experiment_id}
          onClick={() => void regenerateEvaluationReport(run.experiment_id)}
          type="button"
        >
          {reportExperimentId === run.experiment_id ? "Regenerating..." : "Regenerate Report"}
        </button>
        <button
          className="table-title-action"
          disabled={exportExperimentId === run.experiment_id}
          onClick={() => void exportBundle(run.experiment_id)}
          type="button"
        >
          {exportExperimentId === run.experiment_id ? "Exporting..." : "Export Bundle"}
        </button>
      </div>
      <div className="panel-title">实验详情</div>
      {run.experiment_id === focusedExperimentId ? (
        <div className="experiment-focus-note">来自知识图谱定位</div>
      ) : null}
      <div className="detail-grid">
        <div>
          <span>实验 ID</span>
          <code>{run.experiment_id}</code>
        </div>
        <div>
          <span>目标列</span>
          <strong>{run.target_column}</strong>
        </div>
        <div>
          <span>模型文件</span>
          <code>{run.model_artifact.path}</code>
        </div>
        <ArtifactPathRow label="Metrics JSON" path={run.metrics_artifact.path} onOpen={onOpenArtifactPath} />
        {run.evaluation_report_artifact ? (
          <ArtifactPathRow
            label="Evaluation Report"
            path={run.evaluation_report_artifact.path}
            onOpen={onOpenArtifactPath}
          />
        ) : null}
        {run.prediction_samples_artifact ? (
          <ArtifactPathRow
            label="Prediction Samples"
            path={run.prediction_samples_artifact.path}
            onOpen={onOpenArtifactPath}
          />
        ) : null}
        {run.preprocessing_plan_artifact ? (
          <ArtifactPathRow
            label="Preprocessing Plan"
            path={run.preprocessing_plan_artifact.path}
            onOpen={onOpenArtifactPath}
          />
        ) : null}
        {run.export_bundle_artifact ? (
          <ArtifactPathRow
            downloadUrl={projectId ? projectFileDownloadUrl(projectId, run.export_bundle_artifact.path) : undefined}
            label="Export Bundle"
            path={run.export_bundle_artifact.path}
            onOpen={onOpenArtifactPath}
          />
        ) : null}
      </div>
      <div className="detail-grid evaluation-summary">
        <div>
          <span>评估策略</span>
          <strong>{formatHoldoutStrategy(run.metrics.holdout_strategy)}</strong>
        </div>
        <div>
          <span>Train / Eval</span>
          <strong>
            {formatMetricCount(run.metrics.train_row_count)} /{" "}
            {formatMetricCount(run.metrics.eval_row_count ?? run.metrics.row_count)}
          </strong>
        </div>
        <div>
          <span>Class Count</span>
          <strong>{formatMetricCount(run.metrics.class_count)}</strong>
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
      {run.prediction_samples_artifact ? (
        <div className="model-compare nested prediction-sample-table">
          <div className="panel-title">
            <span>Prediction Samples</span>
            <button
              className="table-title-action"
              onClick={() => onOpenArtifactPath(run.prediction_samples_artifact!.path)}
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
      {run.model.explanation_warning ? (
        <div className="inline-alert compact-alert">{run.model.explanation_warning}</div>
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
  );
}
