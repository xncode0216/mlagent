import { RefreshCw, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { ExperimentRun, GPUStatus, TrainingResult } from "../../lib/api";
import { GuidedEmptyState } from "./PanelPrimitives";
import { formatMetricCount, formatMetricPercent } from "./panelFormat";
import type { PanelActionFeedback, TrainingEngine } from "./panelTypes";
import { TrainingRunDetail } from "./TrainingRunDetail";
import {
  filterAndSortExperimentRuns,
  type ExperimentRunFilter,
  type ExperimentRunSort,
} from "./trainingDiagnostics";

export function TrainingPanel({
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
  const [submitting, setSubmitting] = useState(false);
  const [gpuBusyTaskId, setGpuBusyTaskId] = useState<string | null>(null);
  const [refreshingGpu, setRefreshingGpu] = useState(false);
  const [feedback, setFeedback] = useState<PanelActionFeedback | null>(null);
  const [runFilter, setRunFilter] = useState<ExperimentRunFilter>("all");
  const [runSort, setRunSort] = useState<ExperimentRunSort>("newest");
  const visibleRuns = useMemo(
    () => filterAndSortExperimentRuns(runs, { filter: runFilter, sort: runSort, focusedExperimentId }),
    [focusedExperimentId, runFilter, runSort, runs],
  );
  const selectedRun = runs.find((run) => run.experiment_id === selectedRunId) ?? visibleRuns[0] ?? runs[0];
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

  function resetRunFilters() {
    setRunFilter("all");
    setRunSort("newest");
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
        <TrainingRunDetail
          focusedExperimentId={focusedExperimentId}
          onExportRunBundle={onExportRunBundle}
          onFeedback={setFeedback}
          onGenerateEvaluationReport={onGenerateEvaluationReport}
          onOpenArtifactPath={onOpenArtifactPath}
          projectId={projectId}
          run={selectedRun}
        />
      ) : null}
    </div>
  );
}
