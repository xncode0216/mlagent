import type { Dispatch, SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { AgentStreamEvent, Artifact } from "../chat/types";
import { useUiStore } from "../../app/uiStore";
import {
  cancelGPUTask,
  exportRunBundle,
  extractLesson,
  generateEvaluationReport,
  getGPUStatus,
  resumeEvaluationReport,
  resumeExportBundle,
  resumeSklearnTraining,
  trainBaselineModel,
  trainSklearnModel,
  type AgentSession,
  type EvaluationReportResult,
  type ExportBundleResult,
  type Project,
} from "../../lib/api";
import { gpuStatusQueryKey } from "./useGpuStatusQuery";
import { trainingRunsQueryKey } from "./useTrainingRunsQuery";
import { filesQueryKeyRoot } from "../files/useProjectFilesQuery";
import { invalidateEvolutionKnowledgeQueries } from "../evolution/useEvolutionQueries";
import { sessionTaskStatesQueryKey } from "../sessions/useSessionQueries";

/** 训练引擎类型：baseline（轻量基线）或 sklearn（完整 ML 搜索）。 */
export type TrainingEngine = "baseline" | "sklearn";

// 纯辅助函数：构造评估报告的 artifact_created 事件。
function buildEvaluationReportArtifactEvent(
  projectId: string,
  sessionId: string,
  result: EvaluationReportResult,
): AgentStreamEvent {
  return {
    type: "artifact_created",
    artifact: {
      id: result.evaluation_report_artifact.id,
      project_id: projectId,
      session_id: sessionId,
      type: "report",
      name: result.evaluation_report_artifact.name,
      path: result.evaluation_report_artifact.path,
      metadata: {
        experiment_id: result.experiment_id,
        metrics_path: result.run.metrics_artifact.path,
        model_path: result.run.model_artifact.path,
        prediction_samples_path: result.run.prediction_samples_artifact?.path,
        preprocessing_plan_path: result.run.preprocessing_plan_artifact?.path,
      },
      created_at: result.evaluation_report_artifact.created_at,
    } satisfies Artifact,
  };
}

// 纯辅助函数：构造导出包的 artifact_created 事件。
function buildExportBundleArtifactEvent(
  projectId: string,
  sessionId: string,
  result: ExportBundleResult,
): AgentStreamEvent {
  return {
    type: "artifact_created",
    artifact: {
      id: result.export_bundle_artifact.id,
      project_id: projectId,
      session_id: sessionId,
      type: "archive",
      name: result.export_bundle_artifact.name,
      path: result.export_bundle_artifact.path,
      metadata: {
        experiment_id: result.experiment_id,
        artifact_role: "export_bundle",
        metrics_path: result.run.metrics_artifact.path,
        model_path: result.run.model_artifact.path,
        report_path: result.run.evaluation_report_artifact?.path,
      },
      created_at: result.export_bundle_artifact.created_at,
    } satisfies Artifact,
  };
}

interface TrainingActionsParams {
  project: Project | null;
  activeSession: AgentSession | null;
  setLocalEvents: Dispatch<SetStateAction<AgentStreamEvent[]>>;
}

interface TrainingActions {
  handleTrainModel: (
    targetColumn: string,
    engine: TrainingEngine,
    useGpu: boolean,
    preprocessingPlanPath?: string | null,
    datasetPathOverride?: string,
  ) => Promise<void>;
  handleRetrySklearnTraining: () => Promise<void>;
  handleGenerateEvaluationReport: (experimentId: string) => Promise<void>;
  handleRetryEvaluationReport: () => Promise<void>;
  handleExportRunBundle: (experimentId: string) => Promise<void>;
  handleRetryExportBundle: () => Promise<void>;
  handleRefreshGpuStatus: () => Promise<void>;
  handleCancelGpuTask: (taskId: string) => Promise<void>;
}

/**
 * 训练域操作 hook：封装 train/retry/evaluate/export/GPU 等命令式 handler，
 * 内部直接访问 queryClient 和 uiStore，消除 AppShell 的 props drilling。
 */
export function useTrainingActions({
  project,
  activeSession,
  setLocalEvents,
}: TrainingActionsParams): TrainingActions {
  const queryClient = useQueryClient();
  // uiStore — 训练结果与错误
  const setTrainingError = useUiStore((s) => s.setTrainingError);
  const setTrainingResult = useUiStore((s) => s.setTrainingResult);
  const setGpuActionError = useUiStore((s) => s.setGpuActionError);
  // uiStore — 导航/面板切换（评估/导出完成后自动跳转）
  const setFocusedExperimentId = useUiStore((s) => s.setFocusedExperimentId);
  const setActiveMode = useUiStore((s) => s.setActiveMode);
  const setRightPanelTab = useUiStore((s) => s.setRightPanelTab);
  // uiStore — 训练上下文（handleTrainModel 读取当前数据集路径）
  const trainingDatasetPath = useUiStore((s) => s.trainingDatasetPath);
  const activeFile = useUiStore((s) => s.activeFile);

  // 局部辅助：使任务态缓存失效，触发重取。
  function invalidateSessionTaskStates(sessionId: string | undefined) {
    if (!sessionId) return Promise.resolve();
    return queryClient.invalidateQueries({ queryKey: sessionTaskStatesQueryKey(sessionId) });
  }

  // 局部辅助：训练会改变演进证据，因此同步刷新课程、注入日志与知识图谱。
  function invalidateEvolutionLists(projectId: string) {
    return invalidateEvolutionKnowledgeQueries(queryClient, projectId);
  }

  // 局部辅助：评估报告完成后统一更新缓存、跳转面板、追加 localEvents。
  async function applyEvaluationReportResult(
    result: EvaluationReportResult,
    sessionId: string,
    label: string,
  ) {
    if (!project) return;
    await queryClient.invalidateQueries({ queryKey: filesQueryKeyRoot(project.id) });
    await queryClient.invalidateQueries({ queryKey: trainingRunsQueryKey(project.id) });
    await invalidateSessionTaskStates(sessionId);
    setFocusedExperimentId(result.experiment_id);
    setActiveMode("machine-learning");
    setRightPanelTab("training");
    setLocalEvents((current) => [
      ...current,
      buildEvaluationReportArtifactEvent(project.id, sessionId, result),
      {
        type: "stage_completed",
        task_id: sessionId,
        stage: "evaluate",
        label,
        completed_at: new Date().toISOString(),
      },
    ]);
  }

  // 局部辅助：导出包完成后统一更新缓存、跳转面板、追加 localEvents。
  async function applyExportBundleResult(
    result: ExportBundleResult,
    sessionId: string,
    label: string,
  ) {
    if (!project) return;
    await queryClient.invalidateQueries({ queryKey: filesQueryKeyRoot(project.id) });
    await queryClient.invalidateQueries({ queryKey: trainingRunsQueryKey(project.id) });
    await invalidateSessionTaskStates(sessionId);
    setFocusedExperimentId(result.experiment_id);
    setActiveMode("machine-learning");
    setRightPanelTab("training");
    setLocalEvents((current) => [
      ...current,
      buildExportBundleArtifactEvent(project.id, sessionId, result),
      {
        type: "stage_completed",
        task_id: sessionId,
        stage: "export",
        label,
        completed_at: new Date().toISOString(),
      },
    ]);
  }

  async function handleTrainModel(
    targetColumn: string,
    engine: TrainingEngine,
    useGpu: boolean,
    preprocessingPlanPath?: string | null,
    datasetPathOverride?: string,
  ) {
    if (!project) return;
    const trainingSessionId = activeSession?.id ?? "manual-training";
    const datasetPath = datasetPathOverride || trainingDatasetPath || activeFile;
    setTrainingError(null);
    setGpuActionError(null);
    if (useGpu) {
      try {
        queryClient.setQueryData(gpuStatusQueryKey(project.id), await getGPUStatus(project.id));
      } catch {
        // Training can continue even if the status refresh fails.
      }
    }
    setLocalEvents((current) => [
      ...current,
      {
        type: "task_progress",
        task_id: trainingSessionId,
        progress: 0.2,
        label: `Starting ${engine} training`,
      },
    ]);
    try {
      const result =
        engine === "sklearn"
          ? await trainSklearnModel(
              project.id,
              datasetPath,
              targetColumn,
              trainingSessionId,
              useGpu,
              preprocessingPlanPath,
            )
          : await trainBaselineModel(project.id, datasetPath, targetColumn, trainingSessionId);
      setTrainingResult(result);
      try {
        queryClient.setQueryData(gpuStatusQueryKey(project.id), await getGPUStatus(project.id));
      } catch {
        // Training completed; keep the result visible even if status refresh fails.
      }
      await queryClient.invalidateQueries({ queryKey: filesQueryKeyRoot(project.id) });
      await queryClient.invalidateQueries({ queryKey: trainingRunsQueryKey(project.id) });
      await invalidateSessionTaskStates(trainingSessionId);
      const lesson = await extractLesson(project.id, {
        source_type: "training",
        source_id: result.experiment_id,
        // 与抽取器和情境标签使用同一套连字符词汇；写成 machine_learning
        // 会让这条经验的标签维度永远对不上，从而注定匹配不到。
        domain: ["machine-learning", result.engine],
        observation: `Dataset ${datasetPath} completed a ${result.engine} training run with best model ${String(
          result.model.strategy ?? result.model.algorithm,
        )} and accuracy ${(result.metrics.accuracy * 100).toFixed(2)}%.`,
        recommendation:
          result.engine === "sklearn"
            ? "Use the sklearn result as the baseline for follow-up feature engineering, model search, and deployment evaluation."
            : "Use the baseline run as a cheap comparison point before running heavier sklearn experiments.",
        confidence: Math.min(0.95, Math.max(0.5, result.metrics.accuracy)),
        evidence: {
          accuracy: result.metrics.accuracy,
          f1_weighted: result.metrics.f1_weighted,
          runs: result.runs.map((run) => run.model_name),
          model_path: result.model_artifact.path,
          evaluation_report_path: result.evaluation_report_artifact?.path,
          prediction_samples_path: result.prediction_samples_artifact?.path,
          preprocessing_plan_path: result.preprocessing_plan_artifact?.path ?? preprocessingPlanPath,
          engine: result.engine,
        },
      });
      await invalidateEvolutionLists(project.id);
      const reportEvent: AgentStreamEvent | null = result.evaluation_report_artifact
        ? {
            type: "artifact_created",
            artifact: {
              id: result.evaluation_report_artifact.id,
              project_id: project.id,
              session_id: trainingSessionId,
              type: "report",
              name: result.evaluation_report_artifact.name,
              path: result.evaluation_report_artifact.path,
              metadata: {
                experiment_id: result.experiment_id,
                metrics_path: result.metrics_artifact.path,
                model_path: result.model_artifact.path,
                prediction_samples_path: result.prediction_samples_artifact?.path,
                preprocessing_plan_path: result.preprocessing_plan_artifact?.path,
              },
              created_at: result.evaluation_report_artifact.created_at,
            } satisfies Artifact,
          }
        : null;
      setLocalEvents((current) => [
        ...current,
        {
          type: "artifact_created",
          artifact: {
            id: result.metrics_artifact.id,
            project_id: project.id,
            session_id: trainingSessionId,
            type: "training",
            name: result.metrics_artifact.name,
            path: result.metrics_artifact.path,
            metadata: { experiment_id: result.experiment_id },
            created_at: result.metrics_artifact.created_at,
          },
        },
        ...(reportEvent ? [reportEvent] : []),
        ...(result.prediction_samples_artifact
          ? [
              {
                type: "artifact_created" as const,
                artifact: {
                  id: result.prediction_samples_artifact.id,
                  project_id: project.id,
                  session_id: trainingSessionId,
                  type: "dataframe" as const,
                  name: result.prediction_samples_artifact.name,
                  path: result.prediction_samples_artifact.path,
                  metadata: {
                    experiment_id: result.experiment_id,
                    role: "prediction_samples",
                  },
                  created_at: result.prediction_samples_artifact.created_at,
                } satisfies Artifact,
              },
            ]
          : []),
        {
          type: "artifact_created",
          artifact: {
            id: `${result.experiment_id}-model`,
            project_id: project.id,
            session_id: trainingSessionId,
            type: "model",
            name: result.model_artifact.name,
            path: result.model_artifact.path,
            metadata: { experiment_id: result.experiment_id },
            created_at: new Date().toISOString(),
          },
        },
        {
          type: "task_progress",
          task_id: trainingSessionId,
          progress: 1,
          label: `${result.engine} training completed`,
        },
        {
          type: "lesson_extracted",
          lesson_id: lesson.id,
          confidence: lesson.confidence,
        },
      ]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Training task failed";
      setTrainingError(errorMessage);
      await invalidateSessionTaskStates(trainingSessionId);
      try {
        queryClient.setQueryData(gpuStatusQueryKey(project.id), await getGPUStatus(project.id));
      } catch {
        // Preserve the original training error in the UI.
      }
      setLocalEvents((current) => [
        ...current,
        {
          type: "step_failed",
          task_id: trainingSessionId,
          stage: "train",
          label: `${engine} training failed`,
          error: errorMessage,
          retryable: engine === "sklearn",
          resume_stage: "train",
        },
        { type: "error", code: "training_failed", message: `${engine} training failed` },
      ]);
      throw error;
    }
  }

  async function handleRetrySklearnTraining() {
    if (!project) return;
    const trainingSessionId = activeSession?.id ?? "manual-training";
    setTrainingError(null);
    setGpuActionError(null);
    setLocalEvents((current) => [
      ...current,
      {
        type: "task_resumed",
        task_id: trainingSessionId,
        stage: "train",
        label: "Retrying sklearn training",
      },
    ]);
    try {
      const result = await resumeSklearnTraining(project.id, trainingSessionId);
      setTrainingResult(result);
      try {
        queryClient.setQueryData(gpuStatusQueryKey(project.id), await getGPUStatus(project.id));
      } catch {
        // Training completed; keep the result visible even if status refresh fails.
      }
      await queryClient.invalidateQueries({ queryKey: filesQueryKeyRoot(project.id) });
      await queryClient.invalidateQueries({ queryKey: trainingRunsQueryKey(project.id) });
      await invalidateSessionTaskStates(trainingSessionId);
      setLocalEvents((current) => [
        ...current,
        {
          type: "artifact_created",
          artifact: {
            id: result.metrics_artifact.id,
            project_id: project.id,
            session_id: trainingSessionId,
            type: "training",
            name: result.metrics_artifact.name,
            path: result.metrics_artifact.path,
            metadata: { experiment_id: result.experiment_id },
            created_at: result.metrics_artifact.created_at,
          },
        },
        ...(result.evaluation_report_artifact
          ? [
              {
                type: "artifact_created" as const,
                artifact: {
                  id: result.evaluation_report_artifact.id,
                  project_id: project.id,
                  session_id: trainingSessionId,
                  type: "report" as const,
                  name: result.evaluation_report_artifact.name,
                  path: result.evaluation_report_artifact.path,
                  metadata: {
                    experiment_id: result.experiment_id,
                    metrics_path: result.metrics_artifact.path,
                    model_path: result.model_artifact.path,
                    prediction_samples_path: result.prediction_samples_artifact?.path,
                    preprocessing_plan_path: result.preprocessing_plan_artifact?.path,
                  },
                  created_at: result.evaluation_report_artifact.created_at,
                } satisfies Artifact,
              },
            ]
          : []),
        {
          type: "artifact_created",
          artifact: {
            id: `${result.experiment_id}-model`,
            project_id: project.id,
            session_id: trainingSessionId,
            type: "model",
            name: result.model_artifact.name,
            path: result.model_artifact.path,
            metadata: { experiment_id: result.experiment_id },
            created_at: new Date().toISOString(),
          },
        },
        {
          type: "task_progress",
          task_id: trainingSessionId,
          progress: 1,
          label: "sklearn training completed after retry",
        },
      ]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Training task failed";
      setTrainingError(errorMessage);
      await invalidateSessionTaskStates(trainingSessionId);
      setLocalEvents((current) => [
        ...current,
        {
          type: "step_failed",
          task_id: trainingSessionId,
          stage: "train",
          label: "sklearn training retry failed",
          error: errorMessage,
          retryable: true,
          resume_stage: "train",
        },
      ]);
      throw error;
    }
  }

  async function handleGenerateEvaluationReport(experimentId: string) {
    if (!project) return;
    const sessionId = activeSession?.id ?? "manual-training";
    setTrainingError(null);
    setLocalEvents((current) => [
      ...current,
      {
        type: "stage_started",
        task_id: sessionId,
        stage: "evaluate",
        label: "Regenerating evaluation report",
        started_at: new Date().toISOString(),
      },
    ]);
    try {
      const result = await generateEvaluationReport(project.id, experimentId, sessionId);
      await applyEvaluationReportResult(result, sessionId, "Evaluation report regenerated");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Evaluation report generation failed";
      setTrainingError(errorMessage);
      await invalidateSessionTaskStates(sessionId);
      setLocalEvents((current) => [
        ...current,
        {
          type: "step_failed",
          task_id: sessionId,
          stage: "evaluate",
          label: "Evaluation report generation failed",
          error: errorMessage,
          retryable: true,
          resume_stage: "evaluate",
        },
      ]);
      throw error;
    }
  }

  async function handleRetryEvaluationReport() {
    if (!project) return;
    const sessionId = activeSession?.id ?? "manual-training";
    setTrainingError(null);
    setLocalEvents((current) => [
      ...current,
      {
        type: "task_resumed",
        task_id: sessionId,
        stage: "evaluate",
        label: "Retrying evaluation report",
      },
    ]);
    try {
      const result = await resumeEvaluationReport(project.id, sessionId);
      await applyEvaluationReportResult(result, sessionId, "Evaluation report completed after retry");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Evaluation report retry failed";
      setTrainingError(errorMessage);
      await invalidateSessionTaskStates(sessionId);
      setLocalEvents((current) => [
        ...current,
        {
          type: "step_failed",
          task_id: sessionId,
          stage: "evaluate",
          label: "Evaluation report retry failed",
          error: errorMessage,
          retryable: true,
          resume_stage: "evaluate",
        },
      ]);
      throw error;
    }
  }

  async function handleExportRunBundle(experimentId: string) {
    if (!project) return;
    const sessionId = activeSession?.id ?? "manual-training";
    setTrainingError(null);
    setLocalEvents((current) => [
      ...current,
      {
        type: "stage_started",
        task_id: sessionId,
        stage: "export",
        label: "Exporting model handoff bundle",
        started_at: new Date().toISOString(),
      },
    ]);
    try {
      const result = await exportRunBundle(project.id, experimentId, sessionId);
      await applyExportBundleResult(result, sessionId, "Model handoff bundle exported");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Export bundle failed";
      setTrainingError(errorMessage);
      await invalidateSessionTaskStates(sessionId);
      setLocalEvents((current) => [
        ...current,
        {
          type: "step_failed",
          task_id: sessionId,
          stage: "export",
          label: "Export bundle failed",
          error: errorMessage,
          retryable: true,
          resume_stage: "export",
        },
      ]);
      throw error;
    }
  }

  async function handleRetryExportBundle() {
    if (!project) return;
    const sessionId = activeSession?.id ?? "manual-training";
    setTrainingError(null);
    setLocalEvents((current) => [
      ...current,
      {
        type: "task_resumed",
        task_id: sessionId,
        stage: "export",
        label: "Retrying export bundle",
      },
    ]);
    try {
      const result = await resumeExportBundle(project.id, sessionId);
      await applyExportBundleResult(result, sessionId, "Model handoff bundle exported after retry");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Export bundle retry failed";
      setTrainingError(errorMessage);
      await invalidateSessionTaskStates(sessionId);
      setLocalEvents((current) => [
        ...current,
        {
          type: "step_failed",
          task_id: sessionId,
          stage: "export",
          label: "Export bundle retry failed",
          error: errorMessage,
          retryable: true,
          resume_stage: "export",
        },
      ]);
      throw error;
    }
  }

  async function handleRefreshGpuStatus() {
    if (!project) return;
    setGpuActionError(null);
    try {
      queryClient.setQueryData(gpuStatusQueryKey(project.id), await getGPUStatus(project.id));
    } catch (error) {
      setGpuActionError(error instanceof Error ? error.message : "GPU status refresh failed");
      throw error;
    }
  }

  async function handleCancelGpuTask(taskId: string) {
    if (!project) return;
    setGpuActionError(null);
    try {
      await cancelGPUTask(project.id, taskId);
      queryClient.setQueryData(gpuStatusQueryKey(project.id), await getGPUStatus(project.id));
      setLocalEvents((current) => [
        ...current,
        {
          type: "task_progress",
          task_id: taskId,
          progress: 1,
          label: "GPU task cancellation requested",
        },
      ]);
    } catch (error) {
      setGpuActionError(error instanceof Error ? error.message : "GPU task cancellation failed");
      throw error;
    }
  }

  return {
    handleTrainModel,
    handleRetrySklearnTraining,
    handleGenerateEvaluationReport,
    handleRetryEvaluationReport,
    handleExportRunBundle,
    handleRetryExportBundle,
    handleRefreshGpuStatus,
    handleCancelGpuTask,
  };
}
