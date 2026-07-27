import type { Dispatch, SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { AgentStreamEvent, WorkflowStageId } from "./types";
import { useUiStore } from "../../app/uiStore";
import {
  cleanAnalysisDataset,
  executePreprocessingPlan,
  generateAnalysisReport,
  generateDataQualityProfile,
  generatePreprocessingPlan,
  handoffDatasetToMl,
  type AgentSession,
  type Project,
} from "../../lib/api";
import { filesQueryKeyRoot } from "../files/useProjectFilesQuery";

/** sendApprovalResponse 的参数类型（与 useAgentStream 内部 ApprovalResponse 保持兼容）。 */
interface ApprovalResponsePayload {
  approvalId: string;
  decision: string;
  context: {
    projectId?: string;
    activeFile?: string;
    mode?: string;
    preprocessingPlanPath?: string | null;
  };
}

/** sendResumeStep 的参数类型（与 useAgentStream 内部 ResumeStepRequest 保持兼容）。 */
interface ResumeStepPayload {
  stage: string;
  context: {
    projectId?: string;
    activeFile?: string;
    mode?: string;
  };
}

interface AnalysisActionsParams {
  project: Project | null;
  activeSession: AgentSession | null;
  setLocalEvents: Dispatch<SetStateAction<AgentStreamEvent[]>>;
  /** 来自 useAgentStream，发送 WebSocket 批准响应。 */
  sendApprovalResponse: (payload: ApprovalResponsePayload) => void;
  /** 来自 useAgentStream，发送 WebSocket 步骤恢复请求。 */
  sendResumeStep: (payload: ResumeStepPayload) => void;
}

interface AnalysisActions {
  handleGenerateReport: () => Promise<void>;
  handleGenerateProfile: () => Promise<void>;
  handleGeneratePreprocessingPlan: (selectedFeatures?: string[]) => Promise<void>;
  handleExecutePreprocessingPlan: (preprocessingPlanPathOverride?: string | null) => Promise<void>;
  handleRespondToApproval: (
    approvalId: string,
    decision: "execute" | "revise",
    preprocessingPlanPathOverride?: string | null,
  ) => void;
  handleResumeStep: (stage: WorkflowStageId) => void;
  handleCleanDataset: () => Promise<void>;
  handleTransferToMl: () => Promise<void>;
}

// 工具函数：判断路径是否为数据集文件（非预处理计划）。
function isLikelyDatasetPath(path: string) {
  return /\.(csv|tsv|jsonl|parquet)$/i.test(path) && !path.includes("preprocessing_plan");
}

// 工具函数：取路径的父目录。
function parentPath(path: string) {
  return path.split("/").slice(0, -1).join("/");
}

/**
 * 分析域操作 hook：封装 report/profile/preprocessing/clean/ML 移交等命令式 handler，
 * 内部直接访问 queryClient 和 uiStore，消除 AppShell 的 props drilling。
 */
export function useAnalysisActions({
  project,
  activeSession,
  setLocalEvents,
  sendApprovalResponse,
  sendResumeStep,
}: AnalysisActionsParams): AnalysisActions {
  const queryClient = useQueryClient();
  // uiStore — 文件/数据集选择态
  const activeFile = useUiStore((s) => s.activeFile);
  const setActiveFile = useUiStore((s) => s.setActiveFile);
  const setTrainingDatasetPath = useUiStore((s) => s.setTrainingDatasetPath);
  const trainingDatasetPath = useUiStore((s) => s.trainingDatasetPath);
  const setSuggestedTargetColumn = useUiStore((s) => s.setSuggestedTargetColumn);
  const setSelectedPreprocessingPlanPath = useUiStore((s) => s.setSelectedPreprocessingPlanPath);
  const selectedPreprocessingPlanPath = useUiStore((s) => s.selectedPreprocessingPlanPath);
  // uiStore — 展开目录（分析操作产生新文件后自动展开对应文件夹）
  const expandedFolders = useUiStore((s) => s.expandedFolders);
  const setExpandedFolders = useUiStore((s) => s.setExpandedFolders);
  // uiStore — 导航（ML 移交后跳 machine-learning 模式）
  const setActiveMode = useUiStore((s) => s.setActiveMode);
  const activeMode = useUiStore((s) => s.activeMode);

  async function handleGenerateReport() {
    if (!project) return;
    const sessionId = activeSession?.id ?? "manual-analysis";
    const result = await generateAnalysisReport(project.id, activeFile, sessionId);
    const reportFolder = parentPath(result.artifact.path);
    const nextFolders = Array.from(
      new Set([...expandedFolders, "results", reportFolder].filter(Boolean)),
    );
    setExpandedFolders(nextFolders);
    await queryClient.invalidateQueries({ queryKey: filesQueryKeyRoot(project.id) });
    setLocalEvents((current) => [
      ...current,
      {
        type: "artifact_created",
        artifact: {
          id: result.artifact.id,
          project_id: project.id,
          session_id: sessionId,
          type: "report",
          name: result.artifact.name,
          path: result.artifact.path,
          metadata: result.artifact.metadata,
          created_at: result.artifact.created_at,
        },
      },
      {
        type: "task_progress",
        task_id: sessionId,
        progress: 1,
        label: "Analysis report generated",
      },
    ]);
    setActiveFile(result.artifact.path);
  }

  async function handleGenerateProfile() {
    if (!project) return;
    const sessionId = activeSession?.id ?? "manual-analysis";
    const result = await generateDataQualityProfile(project.id, activeFile, sessionId);
    const profileFolder = parentPath(result.artifact.path);
    const nextFolders = Array.from(
      new Set([...expandedFolders, "results", profileFolder].filter(Boolean)),
    );
    setExpandedFolders(nextFolders);
    await queryClient.invalidateQueries({ queryKey: filesQueryKeyRoot(project.id) });
    setLocalEvents((current) => [
      ...current,
      {
        type: "artifact_created",
        artifact: {
          id: result.artifact.id,
          project_id: project.id,
          session_id: sessionId,
          type: "dataframe",
          name: result.artifact.name,
          path: result.artifact.path,
          metadata: {
            ...result.artifact.metadata,
            row_count: result.profile.row_count,
            column_count: result.profile.column_count,
            target_candidates: result.profile.target_candidates,
          },
          created_at: result.artifact.created_at,
        },
      },
      {
        type: "task_progress",
        task_id: sessionId,
        progress: 1,
        label: "Data quality profile generated",
      },
    ]);
    setActiveFile(result.artifact.path);
  }

  async function handleGeneratePreprocessingPlan(selectedFeatures?: string[]) {
    if (!project) return;
    const sessionId = activeSession?.id ?? "manual-analysis";
    const datasetPath = isLikelyDatasetPath(activeFile) ? activeFile : trainingDatasetPath;
    const result = await generatePreprocessingPlan(project.id, datasetPath, sessionId, selectedFeatures);
    const planFolder = parentPath(result.plan_artifact.path);
    const nextFolders = Array.from(
      new Set([...expandedFolders, "results", planFolder, "notebooks"].filter(Boolean)),
    );
    setExpandedFolders(nextFolders);
    await queryClient.invalidateQueries({ queryKey: filesQueryKeyRoot(project.id) });
    setLocalEvents((current) => [
      ...current,
      {
        type: "component_requested",
        task_id: sessionId,
        stage: "transform",
        component: "preprocessing_plan",
        title: "Review preprocessing plan",
        artifact_path: result.plan_artifact.path,
      },
      {
        type: "approval_required",
        task_id: sessionId,
        approval_id: `${sessionId}-preprocessing-plan`,
        stage: "transform",
        title: "Approve preprocessing transform",
        description: "Review the generated plan before executing dataset transformation.",
        artifact_path: result.plan_artifact.path,
        options: ["execute", "revise"],
      },
      {
        type: "artifact_created",
        artifact: {
          ...result.plan_artifact,
          metadata: {
            ...result.plan_artifact.metadata,
            output_dataset_path: result.plan.output_dataset_path,
            feature_columns: result.plan.feature_columns,
            drop_columns: result.plan.drop_columns,
          },
        },
      },
      {
        type: "artifact_created",
        artifact: result.pipeline_artifact,
      },
      {
        type: "task_progress",
        task_id: sessionId,
        progress: 1,
        label: `Preprocessing plan generated for ${result.plan.target_column || "target"}`,
      },
    ]);
    setTrainingDatasetPath(result.plan.dataset_path);
    setSelectedPreprocessingPlanPath(result.plan_artifact.path);
    if (result.plan.target_column) {
      setSuggestedTargetColumn(result.plan.target_column);
    }
    setActiveFile(result.plan_artifact.path);
  }

  async function handleExecutePreprocessingPlan(preprocessingPlanPathOverride?: string | null) {
    const planPath = preprocessingPlanPathOverride ?? selectedPreprocessingPlanPath;
    if (!project || !planPath) return;
    const sessionId = activeSession?.id ?? "manual-analysis";
    const datasetPath = isLikelyDatasetPath(activeFile) ? activeFile : null;
    const result = await executePreprocessingPlan(project.id, datasetPath, planPath, sessionId);
    const outputFolder = parentPath(result.transformed_data_artifact.path);
    const summaryFolder = parentPath(result.summary_artifact.path);
    const reportFolder = parentPath(result.report_artifact.path);
    const nextFolders = Array.from(
      new Set([...expandedFolders, "results", outputFolder, summaryFolder, reportFolder].filter(Boolean)),
    );
    setExpandedFolders(nextFolders);
    await queryClient.invalidateQueries({ queryKey: filesQueryKeyRoot(project.id) });
    setSelectedPreprocessingPlanPath(planPath);
    setTrainingDatasetPath(result.transformed_data_artifact.path);
    setActiveFile(result.transformed_data_artifact.path);
    if (result.summary.target_column) {
      setSuggestedTargetColumn(result.summary.target_column);
    }
    setLocalEvents((current) => [
      ...current,
      {
        type: "stage_completed",
        task_id: sessionId,
        stage: "transform",
        label: "Preprocessing plan executed",
      },
      {
        type: "component_requested",
        task_id: sessionId,
        stage: "train",
        component: "planned_dataset",
        title: "Train from planned dataset",
        artifact_path: result.transformed_data_artifact.path,
      },
      {
        type: "artifact_created",
        artifact: result.transformed_data_artifact,
      },
      {
        type: "artifact_created",
        artifact: result.summary_artifact,
      },
      {
        type: "artifact_created",
        artifact: result.report_artifact,
      },
      {
        type: "task_progress",
        task_id: sessionId,
        progress: 1,
        label: `Preprocessing plan executed, training dataset set to ${result.transformed_data_artifact.path}`,
      },
    ]);
  }

  function handleRespondToApproval(
    approvalId: string,
    decision: "execute" | "revise",
    preprocessingPlanPathOverride?: string | null,
  ) {
    sendApprovalResponse({
      approvalId,
      decision,
      context: { projectId: project?.id, activeFile, mode: activeMode },
    });
    if (preprocessingPlanPathOverride) {
      setSelectedPreprocessingPlanPath(preprocessingPlanPathOverride);
    }
  }

  function handleResumeStep(stage: WorkflowStageId) {
    sendResumeStep({
      stage,
      context: { projectId: project?.id, activeFile, mode: activeMode },
    });
  }

  async function handleCleanDataset() {
    if (!project) return;
    const sessionId = activeSession?.id ?? "manual-analysis";
    const result = await cleanAnalysisDataset(project.id, activeFile, sessionId);
    const nextFolders = Array.from(
      new Set([
        ...expandedFolders,
        "results",
        parentPath(result.cleaned_data_artifact.path),
        "notebooks",
      ].filter(Boolean)),
    );
    setExpandedFolders(nextFolders);
    await queryClient.invalidateQueries({ queryKey: filesQueryKeyRoot(project.id) });
    setLocalEvents((current) => [
      ...current,
      {
        type: "artifact_created",
        artifact: {
          ...result.cleaned_data_artifact,
          metadata: {
            ...result.cleaned_data_artifact.metadata,
            fill_values: result.fill_values,
          },
        },
      },
      {
        type: "artifact_created",
        artifact: result.script_artifact,
      },
      {
        type: "task_progress",
        task_id: sessionId,
        progress: 1,
        label: "Cleaned dataset generated",
      },
    ]);
    setActiveFile(result.cleaned_data_artifact.path);
  }

  async function handleTransferToMl() {
    if (!project) return;
    const sessionId = activeSession?.id ?? "manual-analysis";
    const result = await handoffDatasetToMl(project.id, activeFile, sessionId);
    const handoffFolder = parentPath(result.artifact.path);
    const nextFolders = Array.from(
      new Set([...expandedFolders, "results", handoffFolder].filter(Boolean)),
    );
    setExpandedFolders(nextFolders);
    await queryClient.invalidateQueries({ queryKey: filesQueryKeyRoot(project.id) });
    setSuggestedTargetColumn(result.recommended_target_column || "churn");
    setTrainingDatasetPath(result.dataset_path);
    setActiveMode("machine-learning");
    setLocalEvents((current) => [
      ...current,
      {
        type: "artifact_created",
        artifact: {
          id: result.artifact.id,
          project_id: project.id,
          session_id: sessionId,
          type: result.artifact.type,
          name: result.artifact.name,
          path: result.artifact.path,
          metadata: {
            ...result.artifact.metadata,
            target_candidates: result.target_candidates,
          },
          created_at: result.artifact.created_at,
        },
      },
      {
        type: "task_progress",
        task_id: sessionId,
        progress: 1,
        label: `Dataset transferred to ML Agent with target ${result.recommended_target_column || "target"}`,
      },
    ]);
  }

  return {
    handleGenerateReport,
    handleGenerateProfile,
    handleGeneratePreprocessingPlan,
    handleExecutePreprocessingPlan,
    handleRespondToApproval,
    handleResumeStep,
    handleCleanDataset,
    handleTransferToMl,
  };
}
