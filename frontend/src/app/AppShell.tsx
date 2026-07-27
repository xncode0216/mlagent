import { type ReactNode, lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Database,
  FlaskConical,
  FolderOpen,
  GitBranch,
  Search,
  Settings,
  UserCircle,
} from "lucide-react";

import { ActivityPanel } from "./ActivityPanel";
import { readAppDeepLink, type MainMode } from "./appDeepLink";
import { readAppPreferences, updateAppPreferences, writeAppPreferences, type AppPreferences } from "./appPreferences";
import { activityPanels, type ActivityMode } from "./activityRail";
import { useUiStore } from "./uiStore";
import { AgentWorkspace } from "../features/chat/AgentWorkspace";
import { useAnalysisActions } from "../features/chat/useAnalysisActions";
import {
  taskStatesToEvents,
  trainingContextFromTaskStates,
  type DurableTaskState as FrontendDurableTaskState,
} from "../features/chat/taskStateEvents";
import { buildTaskStateInspection } from "../features/chat/taskStateInspector";
import type { AgentStreamEvent, WorkflowStageId } from "../features/chat/types";
import { useAgentStream } from "../features/chat/useAgentStream";
import { useQueryClient } from "@tanstack/react-query";

import { useEvolutionActions } from "../features/evolution/useEvolutionActions";
import { useEvolutionProtocolsQuery } from "../features/evolution/useEvolutionProtocolsQuery";
import {
  injectionLogsQueryKey,
  lessonsQueryKey,
  useInjectionLogsQuery,
  useLessonsQuery,
} from "../features/evolution/useEvolutionQueries";
import { useGpuStatusQuery } from "../features/right-panel/useGpuStatusQuery";
import { useTrainingRunsQuery } from "../features/right-panel/useTrainingRunsQuery";
import { FileExplorer } from "../features/files/FileExplorer";
import { SearchPanel } from "../features/files/SearchPanel";
import { useFileActions } from "../features/files/useFileActions";
import { useProjectFileMutations } from "../features/files/useProjectFileMutations";
import {
  filesQueryKey,
  listExpandedProjectFiles,
  useProjectFilesQuery,
} from "../features/files/useProjectFilesQuery";
import { AuthMenu } from "../features/auth/AuthMenu";
import { ModelStatusIndicator } from "../features/llm/ModelStatusIndicator";
import { projectsQueryKey, useProjectsQuery } from "../features/projects/useProjectsQuery";
import {
  sessionMessagesQueryKey,
  sessionTaskStatesQueryKey,
  sessionsQueryKey,
  useSessionMessagesQuery,
  useSessionEventsQuery,
  useSessionsQuery,
  useSessionTaskStatesQuery,
} from "../features/sessions/useSessionQueries";
import { RightPanel } from "../features/right-panel/RightPanel";
import { useTrainingActions } from "../features/right-panel/useTrainingActions";
import {
  createAgentSession,
  createProject,
  listProjectSessions,
  listProjects,
  openLocalProject,
  type AgentSession,
  type FileItem,
  type Project,
  abandonTaskState,
} from "../lib/api";

// 路由级拆分：自进化工作区只在 evolution 模式渲染，静态引入会把它连同图谱依赖打进首屏主包。
const EvolutionWorkspace = lazy(() => import("../features/evolution/EvolutionWorkspace"));

const activityIcons: Record<ActivityMode, ReactNode> = {
  explorer: <FolderOpen size={18} />,
  search: <Search size={18} />,
  data: <Database size={18} />,
  experiments: <FlaskConical size={18} />,
  version: <GitBranch size={18} />,
  knowledge: <BookOpen size={18} />,
  account: <UserCircle size={18} />,
  settings: <Settings size={18} />,
};

function parentPath(path: string) {
  return path.split("/").slice(0, -1).join("/");
}

function parentFolders(path: string) {
  const parent = parentPath(path);
  if (!parent) return [];
  const parts = parent.split("/");
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

function modeLabel(mode: MainMode) {
  return {
    analysis: "数据分析",
    "machine-learning": "机器学习",
    evolution: "自进化知识",
  }[mode];
}

function isAgentStreamEvent(value: unknown): value is AgentStreamEvent {
  return Boolean(value && typeof value === "object" && "type" in value);
}

function isLikelyDatasetPath(path: string) {
  return /\.(csv|tsv|jsonl|parquet)$/i.test(path) && !path.includes("preprocessing_plan");
}

function taskStateSnapshot(taskStates: FrontendDurableTaskState[]) {
  return {
    states: taskStates,
    events: taskStatesToEvents(taskStates),
  };
}

export function AppShell() {
  const deepLink = useMemo(() => readAppDeepLink(), []);
  const queryClient = useQueryClient();
  // 导航态（主模式 / 活动栏）由 uiStore 托管：AppShell 既读其值（渲染分支、按钮高亮、
  // ensureModeSession）也用其动作写入。
  const activeMode = useUiStore((state) => state.activeMode);
  const activeActivity = useUiStore((state) => state.activeActivity);
  const setActiveMode = useUiStore((state) => state.setActiveMode);
  const setActiveActivity = useUiStore((state) => state.setActiveActivity);
  // 选择态：当前文件（footer/handlers 读）+ 聚焦实验（仅 setter；其值由子组件读 store）。
  const activeFile = useUiStore((state) => state.activeFile);
  const setActiveFile = useUiStore((state) => state.setActiveFile);
  const setFocusedExperimentId = useUiStore((state) => state.setFocusedExperimentId);
  // 训练相关选择态：AppShell 读其值（handlers + AgentWorkspace 的 durableTrainingContext
  // 覆盖表达式）并保留 setter；RightPanel 改读 store，AgentWorkspace 仍接收覆盖后的 props。
  const trainingDatasetPath = useUiStore((state) => state.trainingDatasetPath);
  const setTrainingDatasetPath = useUiStore((state) => state.setTrainingDatasetPath);
  const suggestedTargetColumn = useUiStore((state) => state.suggestedTargetColumn);
  const setSuggestedTargetColumn = useUiStore((state) => state.setSuggestedTargetColumn);
  const selectedPreprocessingPlanPath = useUiStore((state) => state.selectedPreprocessingPlanPath);
  const setSelectedPreprocessingPlanPath = useUiStore((state) => state.setSelectedPreprocessingPlanPath);
  // UI 状态/错误/日志聚焦字段已迁入 uiStore（AppShell 侧纯写）：此处仅取其动作，
  // 对应的值由子组件直接从 store 读取，AppShell 不再持有这些 useState 与 props。
  const setWorkspaceStatus = useUiStore((state) => state.setWorkspaceStatus);
  const setTrainingResult = useUiStore((state) => state.setTrainingResult);
  const setTrainingError = useUiStore((state) => state.setTrainingError);
  const setGpuActionError = useUiStore((state) => state.setGpuActionError);
  const openLogs = useUiStore((state) => state.openLogs);
  const [preferences, setPreferences] = useState<AppPreferences>(() => readAppPreferences());
  const [activeSession, setActiveSession] = useState<AgentSession | null>(null);
  // 会话级服务端态全部由 react-query 托管，随 activeSession.id 取数：
  // 无活动会话时 query disabled → data undefined → ?? [] 自然清空（替代原先
  // loadSessionMessages effect 的成组 setState）。durableTaskStates 与 taskStateEvents
  // 从同一份 task-states data 经 taskStateSnapshot 派生（替代 applyDurableTaskStates）。
  const sessionMessagesQuery = useSessionMessagesQuery(activeSession?.id);
  const sessionMessages = sessionMessagesQuery.data ?? [];
  const sessionEventsQuery = useSessionEventsQuery(activeSession?.id);
  const sessionEvents = useMemo(
    () => (sessionEventsQuery.data ?? []).filter(isAgentStreamEvent),
    [sessionEventsQuery.data],
  );
  const sessionTaskStatesQuery = useSessionTaskStatesQuery(activeSession?.id);
  const taskStatesSnapshot = useMemo(
    () => taskStateSnapshot(sessionTaskStatesQuery.data ?? []),
    [sessionTaskStatesQuery.data],
  );
  const durableTaskStates = taskStatesSnapshot.states;
  const taskStateEvents = taskStatesSnapshot.events;
  // 没有真实会话时传 null：占位会话会让消息发到一个随后被丢弃的事件流里。
  const { connected, events, lastError, sendApprovalResponse, sendMessage, sendResumeStep } = useAgentStream(
    activeSession?.id ?? null,
  );
  const projectsQuery = useProjectsQuery();
  const projects = projectsQuery.data ?? [];
  const [project, setProject] = useState<Project | null>(null);
  const sessionsQuery = useSessionsQuery(project?.id);
  const sessions = sessionsQuery.data ?? [];
  // 文件树展开集已迁入 uiStore：filesQuery 与各文件 handler 读其值，子组件直读 store。
  const expandedFolders = useUiStore((state) => state.expandedFolders);
  const setExpandedFolders = useUiStore((state) => state.setExpandedFolders);
  const filesQuery = useProjectFilesQuery(project?.id, expandedFolders);
  const files = filesQuery.data ?? [];
  const fileMutations = useProjectFileMutations(project?.id);
  const trainingRunsQuery = useTrainingRunsQuery(project?.id);
  const trainingRuns = trainingRunsQuery.data ?? [];
  const gpuStatusQuery = useGpuStatusQuery(project?.id, preferences.gpuRefreshIntervalMs);
  const gpuStatus = gpuStatusQuery.data ?? null;
  const [localEvents, setLocalEvents] = useState<AgentStreamEvent[]>([]);
  const lessonsQuery = useLessonsQuery(project?.id);
  const lessons = lessonsQuery.data ?? [];
  const protocolsQuery = useEvolutionProtocolsQuery(project?.id);
  const protocols = protocolsQuery.data ?? [];
  const injectionLogsQuery = useInjectionLogsQuery(project?.id);
  const injectionLogs = injectionLogsQuery.data ?? [];

  const {
    handleUpload,
    handleCreateFile,
    handleRenameFile,
    handleDeleteFile,
    handleToggleFolder,
    handleSelectProjectFile,
    handleSelectExperimentRun,
  } = useFileActions({ projectId: project?.id, mutations: fileMutations });
  const {
    handleTrainModel,
    handleRetrySklearnTraining,
    handleGenerateEvaluationReport,
    handleRetryEvaluationReport,
    handleExportRunBundle,
    handleRetryExportBundle,
    handleRefreshGpuStatus,
    handleCancelGpuTask,
  } = useTrainingActions({ project, activeSession, setLocalEvents });
  const {
    handleExtractLessonsFromSession,
    handleRetryLearningExtraction,
    handleAdoptLesson,
    handleRejectLesson,
    handleMarkLessonConflict,
  } = useEvolutionActions({ project, activeSession, setLocalEvents });
  const {
    handleGenerateReport,
    handleGenerateProfile,
    handleGeneratePreprocessingPlan,
    handleExecutePreprocessingPlan,
    handleRespondToApproval,
    handleResumeStep,
    handleCleanDataset,
    handleTransferToMl,
  } = useAnalysisActions({
    project,
    activeSession,
    setLocalEvents,
    sendApprovalResponse,
    sendResumeStep,
  });

  const visibleEvents = useMemo(
    () => [...sessionEvents, ...taskStateEvents, ...events, ...localEvents],
    [events, localEvents, sessionEvents, taskStateEvents],
  );
  const artifactCount = useMemo(
    () => visibleEvents.filter((event) => event.type === "artifact_created").length,
    [visibleEvents],
  );
  const durableTrainingContext = useMemo(
    () => trainingContextFromTaskStates(durableTaskStates),
    [durableTaskStates],
  );
  const taskStateInspection = useMemo(
    () => {
      const preferredStage =
        durableTrainingContext
          ? "train"
          : durableTaskStates.find((state) => state.status === "failed")?.stage;
      return buildTaskStateInspection(
        durableTaskStates,
        visibleEvents,
        preferredStage as WorkflowStageId | undefined,
      );
    },
    [durableTaskStates, durableTrainingContext, visibleEvents],
  );

  // 课程与规则注入日志由 react-query 托管，操作后用 invalidate 触发重取
  // （替代原先成对的 setLessons / setInjectionLogs）。
  function invalidateEvolutionLists(projectId: string) {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: lessonsQueryKey(projectId) }),
      queryClient.invalidateQueries({ queryKey: injectionLogsQueryKey(projectId) }),
    ]);
  }

  // 可恢复任务态由 react-query 托管：操作后对 sessionTaskStatesQueryKey 执行 invalidate
  // 触发重取，替代原先 refreshDurableTaskStates 的命令式取数 + applyDurableTaskStates。
  function invalidateSessionTaskStates(sessionId: string | undefined = activeSession?.id) {
    if (!sessionId) return Promise.resolve();
    return queryClient.invalidateQueries({ queryKey: sessionTaskStatesQueryKey(sessionId) });
  }

  async function handleAbandonTaskState(stage: WorkflowStageId) {
    const sessionId = activeSession?.id;
    if (!sessionId) {
      throw new Error("没有可用于放弃已保存任务状态的活动会话。");
    }
    await abandonTaskState(sessionId, stage);
    await invalidateSessionTaskStates(sessionId);
    setLocalEvents((current) => [
      ...current,
      {
        type: "task_progress",
        task_id: sessionId,
        progress: 1,
        label: `Abandoned saved ${stage} retry state`,
        timestamp: new Date().toISOString(),
      },
    ]);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadProject(current: Project) {
      if (!cancelled) {
        await activateProject(current);
        setWorkspaceStatus("项目文件已同步");
      }
    }

    async function bootstrapProject() {
      try {
        // 首读走 fetchQuery：与 useProjectsQuery 同键去重，只发一次请求，且建项后用
        // setQueryData 写回的列表不会被 hook 的并发空列表覆盖。
        const initialProjects = await queryClient.fetchQuery({
          queryKey: projectsQueryKey(),
          queryFn: () => listProjects(),
        });

        if (!cancelled) {
          queryClient.setQueryData(projectsQueryKey(), initialProjects);
        }
        const current = deepLink.projectId
          ? initialProjects.find((item) => item.id === deepLink.projectId) ?? initialProjects[0]
          : initialProjects[0];
        if (!current) {
          if (!cancelled) {
            setProject(null);
            setActiveSession(null);
            setActiveFile("");
            setTrainingDatasetPath("");
            setExpandedFolders([]);
            setWorkspaceStatus("未选择项目。创建或打开一个项目以开始。");
          }
          return;
        }
        await loadProject(current);
      } catch {
        if (!cancelled) {
          setWorkspaceStatus("后端不可用；显示静态工作台外壳");
        }
      }
    }

    void bootstrapProject();
    return () => {
      cancelled = true;
    };
  }, [deepLink.projectId]);

  useEffect(() => {
    let cancelled = false;

    async function ensureModeSession() {
      if (!project) return;
      // 首读走 fetchQuery：与 useSessionsQuery 同键去重，只发一次请求，并把最新列表写入缓存。
      const existingSessions = await queryClient.fetchQuery({
        queryKey: sessionsQueryKey(project.id),
        queryFn: () => listProjectSessions(project.id),
      });
      let nextSession =
        existingSessions.find((session) => session.id === deepLink.sessionId && session.mode === activeMode) ??
        existingSessions.find((session) => session.id === activeSession?.id && session.mode === activeMode) ??
        existingSessions.find((session) => session.mode === activeMode);
      if (!nextSession) {
        nextSession = await createAgentSession(project.id, {
          mode: activeMode,
          title: `${modeLabel(activeMode)} - ${project.name}`,
        });
        // 新建后刷新列表缓存（未新建时 fetchQuery 已写入最新列表，无需二次取数）。
        const refreshedSessions = await listProjectSessions(project.id);
        if (!cancelled) {
          queryClient.setQueryData(sessionsQueryKey(project.id), refreshedSessions);
        }
      }
      if (!cancelled) {
        setActiveSession(nextSession);
      }
    }

    void ensureModeSession();
    return () => {
      cancelled = true;
    };
  }, [activeMode, activeSession?.id, deepLink.sessionId, project]);

  useEffect(() => {
    if (!project || !activeSession) return;
    const latestEvent = visibleEvents.at(-1);
    if (latestEvent?.type !== "task_progress" || latestEvent.task_id !== activeSession.id) return;

    async function refreshSessionState() {
      if (!project || !activeSession) return;
      // sessions / messages / evolution 列表全部由 react-query 托管，统一用 invalidate
      // 触发重取，替代原先 listProjectSessions + listSessionMessages 的命令式刷新。
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey(project.id) }),
        queryClient.invalidateQueries({ queryKey: sessionMessagesQueryKey(activeSession.id) }),
        invalidateEvolutionLists(project.id),
      ]);
    }

    void refreshSessionState();
  }, [activeSession, project, visibleEvents]);

  useEffect(() => {
    if (!activeSession) return;
    const latestEvent = events.at(-1);
    if (
      latestEvent?.type === "component_requested" &&
      latestEvent.task_id === activeSession.id &&
      latestEvent.component === "task_state_inspector"
    ) {
      void invalidateSessionTaskStates(activeSession.id);
    }
    if (
      latestEvent?.type === "step_completed" &&
      latestEvent.task_id === activeSession.id &&
      latestEvent.label.toLowerCase().startsWith("abandoned saved ") &&
      latestEvent.label.toLowerCase().endsWith(" failure state")
    ) {
      void invalidateSessionTaskStates(activeSession.id);
    }
  }, [activeSession, events]);

  // 把 GPU 状态查询的轮询结果桥接回 gpuActionError，保留原轮询 effect 的行为：
  // 每次取数成功（含后台重取）清错，失败（含后台重取）显示错误信息。命令式操作
  // （刷新/取消/训练）另行设置 gpuActionError，会在下次成功轮询时被清除——与旧行为一致。
  useEffect(() => {
    const failure = gpuStatusQuery.error ?? gpuStatusQuery.failureReason;
    if (failure) {
      setGpuActionError(failure instanceof Error ? failure.message : "GPU status refresh failed");
    } else if (gpuStatusQuery.isSuccess) {
      setGpuActionError(null);
    }
  }, [
    gpuStatusQuery.isSuccess,
    gpuStatusQuery.error,
    gpuStatusQuery.failureReason,
    gpuStatusQuery.dataUpdatedAt,
    gpuStatusQuery.errorUpdatedAt,
  ]);

  function handlePreferenceChange(patch: Partial<AppPreferences>) {
    const nextPreferences = updateAppPreferences(preferences, patch);
    setPreferences(nextPreferences);
    writeAppPreferences(nextPreferences);
    if (patch.defaultTargetColumn !== undefined) {
      setSuggestedTargetColumn(nextPreferences.defaultTargetColumn);
    }
  }

  async function activateProject(nextProject: Project, projectFiles?: FileItem[], folders?: string[]) {
    const deepLinkFolders = deepLink.file ? parentFolders(deepLink.file) : [];
    const nextExpandedFolders = Array.from(new Set([...(folders ?? []), ...deepLinkFolders]));
    const nextFiles = projectFiles ?? (await listExpandedProjectFiles(nextProject.id, nextExpandedFolders));
    setProject(nextProject);
    // 用 setQueryData 以 nextExpandedFolders 对应的键预置缓存，避免激活后闪空树/触发一次重取。
    queryClient.setQueryData(filesQueryKey(nextProject.id, nextExpandedFolders), nextFiles);
    setExpandedFolders(nextExpandedFolders);
    const nextActiveFile = deepLink.file ?? nextFiles.find((item) => item.type === "file")?.path ?? "";
    setActiveFile(nextActiveFile);
    const nextDatasetPath = isLikelyDatasetPath(nextActiveFile)
      ? nextActiveFile
      : nextFiles.find((item) => item.type === "file" && isLikelyDatasetPath(item.path))?.path ?? "";
    setTrainingDatasetPath(nextDatasetPath);
    setActiveSession(null);
    setTrainingResult(null);
    setTrainingError(null);
    setFocusedExperimentId(deepLink.experimentId ?? null);
    setSuggestedTargetColumn(preferences.defaultTargetColumn);
    setSelectedPreprocessingPlanPath(null);
    setLocalEvents([]);
    // 会话级 messages/events/task-states 由 react-query 托管：setActiveSession(null) 后
    // 对应 query disabled、queryKey 切到 undefined → data undefined → ?? [] 自动清空。
  }

  function handleSelectSession(sessionId: string) {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    if (session.mode === "analysis" || session.mode === "machine-learning" || session.mode === "evolution") {
      setActiveMode(session.mode);
    }
    // messages/events/task-states 随 activeSession.id 由各自 query 自动重取，无需命令式加载。
    setActiveSession(session);
  }

  async function switchProject(projectId: string) {
    const nextProject = projects.find((item) => item.id === projectId);
    if (!nextProject) return;
    setWorkspaceStatus("正在切换项目…");
    await activateProject(nextProject);
    setWorkspaceStatus("项目文件已同步");
  }

  async function handleCreateProject(name: string) {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setWorkspaceStatus("正在创建项目…");
    const created = await createProject(trimmedName);
    const nextProjects = await listProjects();
    queryClient.setQueryData(projectsQueryKey(), nextProjects);
    await activateProject(created);
    setWorkspaceStatus("项目文件已同步");
  }

  async function handleOpenLocalProject(path: string) {
    const trimmedPath = path.trim();
    if (!trimmedPath) return;
    setWorkspaceStatus("正在打开本地项目…");
    const opened = await openLocalProject(trimmedPath);
    const nextProjects = await listProjects();
    queryClient.setQueryData(projectsQueryKey(), nextProjects);
    await activateProject(opened);
    setWorkspaceStatus("本地项目已打开");
  }

  return (
    <div className="app-shell">
      <header className="top-nav">
        <div className="brand">MLAgent</div>
        <nav className="mode-tabs" aria-label="主模式">
          <button className={activeMode === "analysis" ? "active" : ""} onClick={() => setActiveMode("analysis")}>
            数据分析
          </button>
          <button
            className={activeMode === "machine-learning" ? "active" : ""}
            onClick={() => setActiveMode("machine-learning")}
          >
            机器学习
          </button>
          <button className={activeMode === "evolution" ? "active" : ""} onClick={() => setActiveMode("evolution")}>
            自进化知识
          </button>
        </nav>
        <ModelStatusIndicator />
        <AuthMenu />
      </header>
      <aside className="activity-bar" aria-label="工作区导航">
        {activityPanels
          .filter((item) => item.group === "primary")
          .map((item) => (
            <button
              aria-label={item.label}
              className={activeActivity === item.id ? "active" : ""}
              key={item.id}
              onClick={() => setActiveActivity(item.id)}
              title={item.label}
              type="button"
            >
              {activityIcons[item.id]}
            </button>
          ))}
        <div className="activity-spacer" />
        {activityPanels
          .filter((item) => item.group === "secondary")
          .map((item) => (
            <button
              aria-label={item.label}
              className={activeActivity === item.id ? "active" : ""}
              key={item.id}
              onClick={() => setActiveActivity(item.id)}
              title={item.label}
              type="button"
            >
              {activityIcons[item.id]}
            </button>
          ))}
      </aside>
      <aside className="file-sidebar">
        {activeActivity === "explorer" ? (
          <FileExplorer
            currentProjectId={project?.id}
            files={files}
            filesBusy={filesQuery.isFetching}
            filesError={
              filesQuery.error instanceof Error
                ? filesQuery.error.message
                : filesQuery.error
                  ? "项目文件加载失败"
                  : null
            }
            onRetryFiles={() => void filesQuery.refetch()}
            onCreateProject={handleCreateProject}
            onCreateFile={handleCreateFile}
            onDeleteFile={handleDeleteFile}
            onOpenLocalProject={handleOpenLocalProject}
            onRenameFile={handleRenameFile}
            onSelect={handleSelectProjectFile}
            onSwitchProject={(projectId) => void switchProject(projectId)}
            onToggleFolder={(path) => void handleToggleFolder(path)}
            onUpload={handleUpload}
            projects={projects}
            projectsBusy={projectsQuery.isFetching}
            projectsError={
              projectsQuery.error instanceof Error
                ? projectsQuery.error.message
                : projectsQuery.error
                  ? "项目列表加载失败"
                  : null
            }
            onRetryProjects={() => void projectsQuery.refetch()}
            projectName={project?.name}
            projectPath={project?.workspace_path}
            sessions={sessions}
            sessionsBusy={sessionsQuery.isFetching}
            sessionsError={
              sessionsQuery.error instanceof Error
                ? sessionsQuery.error.message
                : sessionsQuery.error
                  ? "会话记录加载失败"
                  : null
            }
            activeSessionId={activeSession?.id}
            onRetrySessions={() => void sessionsQuery.refetch()}
            onSelectSession={(sessionId) => void handleSelectSession(sessionId)}
          />
        ) : activeActivity === "search" ? (
          <SearchPanel projectId={project?.id} onSelect={handleSelectProjectFile} />
        ) : (
          <ActivityPanel
            artifactCount={artifactCount}
            connected={connected}
            eventsCount={visibleEvents.length}
            files={files}
            gpuStatus={gpuStatus}
            injectionLogs={injectionLogs}
            lessons={lessons}
            preferences={preferences}
            onPreferenceChange={handlePreferenceChange}
            onSelectExperimentRun={handleSelectExperimentRun}
            onSelectFile={handleSelectProjectFile}
            project={project}
            projects={projects}
            protocols={protocols}
            sessions={sessions}
            trainingRuns={trainingRuns}
          />
        )}
      </aside>
      {activeMode === "evolution" ? (
        <Suspense
          fallback={
            <main aria-busy="true" className="agent-workspace">
              <div className="workspace-loading" role="status">
                <GitBranch aria-hidden="true" size={22} />
                <span>正在加载自进化工作区…</span>
              </div>
            </main>
          }
        >
          <EvolutionWorkspace
            projectId={project?.id ?? ""}
            taskStateInspection={taskStateInspection}
            lessons={lessons}
            injectionLogs={injectionLogs}
            protocols={protocols}
            initialTab={deepLink.evolutionTab}
            onAdopt={handleAdoptLesson}
            onAbandonTaskState={() => handleAbandonTaskState("learn")}
            onExtractLessonsFromSession={handleExtractLessonsFromSession}
            onOpenLogs={(taskId) => openLogs(taskId)}
            onRetryLearning={handleRetryLearningExtraction}
            onMarkConflict={handleMarkLessonConflict}
            onSelectExperimentRun={handleSelectExperimentRun}
            onSelectProjectFile={handleSelectProjectFile}
            onReject={handleRejectLesson}
          />
        </Suspense>
      ) : (
        <AgentWorkspace
          mode={activeMode}
          connected={connected}
          events={visibleEvents}
          historyMessages={sessionMessages}
          lastError={lastError}
          preprocessingPlanPath={durableTrainingContext?.preprocessingPlanPath ?? selectedPreprocessingPlanPath}
          projectId={project?.id}
          suggestedTargetColumn={durableTrainingContext?.targetColumn ?? suggestedTargetColumn}
          taskStateInspection={taskStateInspection}
          trainingDatasetPath={durableTrainingContext?.trainingDatasetPath ?? trainingDatasetPath}
          onAbandonTaskState={handleAbandonTaskState}
          onExecutePreprocessingPlan={handleExecutePreprocessingPlan}
          onExportRunBundle={handleExportRunBundle}
          onExtractLessons={handleExtractLessonsFromSession}
          onGeneratePreprocessingPlan={handleGeneratePreprocessingPlan}
          onGenerateProfile={handleGenerateProfile}
          onOpenLogs={(taskId) => openLogs(taskId)}
          onOpenTraining={() => setActiveMode("machine-learning")}
          onRegenerateEvaluationReport={handleGenerateEvaluationReport}
          onRespondToApproval={handleRespondToApproval}
          onResumeStep={handleResumeStep}
          onRetryEvaluation={handleRetryEvaluationReport}
          onRetryExport={handleRetryExportBundle}
          onRetryLearning={handleRetryLearningExtraction}
          onRetrySklearnTraining={handleRetrySklearnTraining}
          onApplyFeatureSelection={(features) => handleGeneratePreprocessingPlan(features)}
          onSelectExperimentRun={setFocusedExperimentId}
          onSelectFile={handleSelectProjectFile}
          onSelectTargetColumn={setSuggestedTargetColumn}
          onTrainSklearn={(targetColumn, planPath, datasetPath) =>
            handleTrainModel(targetColumn, "sklearn", false, planPath, datasetPath)
          }
          sendMessage={sendMessage}
        />
      )}
      <RightPanel
        events={visibleEvents}
        projectId={project?.id}
        sessionId={activeSession?.id}
        trainingRuns={trainingRuns}
        gpuStatus={gpuStatus}
        onCleanDataset={handleCleanDataset}
        onGenerateReport={handleGenerateReport}
        onGenerateProfile={handleGenerateProfile}
        onGeneratePreprocessingPlan={handleGeneratePreprocessingPlan}
        onExecutePreprocessingPlan={handleExecutePreprocessingPlan}
        onExportRunBundle={handleExportRunBundle}
        onSelectFile={handleSelectProjectFile}
        onTransferToMl={handleTransferToMl}
        onGenerateEvaluationReport={handleGenerateEvaluationReport}
        onTrainModel={handleTrainModel}
        onCancelGpuTask={handleCancelGpuTask}
        onRefreshGpuStatus={handleRefreshGpuStatus}
      />
      <footer className="status-bar">
        <span>{connected ? "WebSocket 已连接" : "WebSocket 已断开"}</span>
        <span>项目：{project?.name ?? "无"}</span>
        <span>会话：{activeSession?.title ?? "无"}</span>
        <span>当前文件：{activeFile}</span>
        <span>产物：{artifactCount}</span>
        <span>GPU：{gpuStatus?.status ?? "未知"}</span>
      </footer>
    </div>
  );
}
