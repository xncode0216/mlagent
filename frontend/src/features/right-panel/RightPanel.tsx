import { Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { ExperimentRun, GPUStatus } from "../../lib/api";
import { useUiStore } from "../../app/uiStore";
import type { AgentStreamEvent, Artifact } from "../chat/types";
import { deriveWorkflowState } from "../chat/workflowState";
import { useProjectFileContentQuery } from "../files/useProjectFileContentQuery";
import { LogPanel } from "../logs/LogPanel";
import { ActiveFilePreview } from "./ActiveFilePreview";
import { ArtifactPreview } from "./ArtifactPreview";
import { ChartsEmptyState } from "./ChartsEmptyState";
import { inspectorTabForWorkflow } from "./inspectorContext";
import { ArtifactList } from "./PanelPrimitives";
import {
  artifactNameFromPath,
  downloadJsonFile,
  formatPanelFilename,
  previewArtifactType,
  previewTabForPath,
} from "./panelFormat";
import { tabById, tabs, type RightPanelTabLabel } from "./panelTabs";
import type { PanelActionFeedback, TrainingEngine } from "./panelTypes";
import { TrainingPanel } from "./TrainingPanel";

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
  const focusedLogTraceId = useUiStore((state) => state.focusedLogTraceId);
  const rightPanelTab = useUiStore((state) => state.rightPanelTab);
  const mode = useUiStore((state) => state.activeMode);
  const activeFile = useUiStore((state) => state.activeFile);
  const focusedExperimentId = useUiStore((state) => state.focusedExperimentId);
  const preprocessingPlanPath = useUiStore((state) => state.selectedPreprocessingPlanPath);
  const trainingDatasetPath = useUiStore((state) => state.trainingDatasetPath);
  const suggestedTargetColumn = useUiStore((state) => state.suggestedTargetColumn);
  const [activeTab, setActiveTab] = useState<RightPanelTabLabel>(() => (rightPanelTab ? tabById[rightPanelTab] : "图表"));
  const [tabPinnedByUser, setTabPinnedByUser] = useState(false);
  // evolution 模式的主区是自进化工作台，不该被数据/训练工作流拽动检查器
  const workflowTab = useMemo(
    () =>
      mode === "evolution"
        ? null
        : inspectorTabForWorkflow(deriveWorkflowState(events, mode, activeFile)),
    [activeFile, events, mode],
  );

  function selectTab(tab: RightPanelTabLabel) {
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
      {activeTab === "日志" ? (
        <LogPanel
          events={events}
          focusedTaskId={focusedLogTaskId}
          focusedTraceId={focusedLogTraceId}
          sessionId={sessionId}
        />
      ) : null}
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
