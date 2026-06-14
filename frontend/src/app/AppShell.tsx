import { type ReactNode, useEffect, useMemo, useState } from "react";
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
import { readAppDeepLink, resolveInitialMode, type MainMode } from "./appDeepLink";
import { readAppPreferences, updateAppPreferences, writeAppPreferences, type AppPreferences } from "./appPreferences";
import { activityPanels, type ActivityMode } from "./activityRail";
import { AgentWorkspace } from "../features/chat/AgentWorkspace";
import {
  taskStatesToEvents,
  trainingContextFromTaskStates,
  type DurableTaskState as FrontendDurableTaskState,
} from "../features/chat/taskStateEvents";
import { buildTaskStateInspection } from "../features/chat/taskStateInspector";
import type { AgentStreamEvent, Artifact, WorkflowStageId } from "../features/chat/types";
import { useAgentStream } from "../features/chat/useAgentStream";
import { useQueryClient } from "@tanstack/react-query";

import { EvolutionWorkspace } from "../features/evolution/EvolutionWorkspace";
import { useEvolutionProtocolsQuery } from "../features/evolution/useEvolutionProtocolsQuery";
import {
  injectionLogsQueryKey,
  lessonsQueryKey,
  useInjectionLogsQuery,
  useLessonsQuery,
} from "../features/evolution/useEvolutionQueries";
import { gpuStatusQueryKey, useGpuStatusQuery } from "../features/right-panel/useGpuStatusQuery";
import { trainingRunsQueryKey, useTrainingRunsQuery } from "../features/right-panel/useTrainingRunsQuery";
import { FileExplorer } from "../features/files/FileExplorer";
import { SearchPanel } from "../features/files/SearchPanel";
import { ModelStatusIndicator } from "../features/llm/ModelStatusIndicator";
import { projectsQueryKey, useProjectsQuery } from "../features/projects/useProjectsQuery";
import { sessionsQueryKey, useSessionsQuery } from "../features/sessions/useSessionQueries";
import { RightPanel } from "../features/right-panel/RightPanel";
import {
  adoptLesson,
  cancelGPUTask,
  cleanAnalysisDataset,
  createAgentSession,
  createProjectFile,
  createProject,
  deleteProjectFile,
  exportRunBundle,
  extractLesson,
  extractLessonsFromSession,
  executePreprocessingPlan,
  resumeExportBundle,
  generateEvaluationReport,
  generateAnalysisReport,
  generateDataQualityProfile,
  generatePreprocessingPlan,
  getGPUStatus,
  handoffDatasetToMl,
  listFiles,
  listProjectSessions,
  listProjects,
  listSessionEvents,
  listSessionMessages,
  listSessionTaskStates,
  markLessonConflict,
  openLocalProject,
  renameProjectFile,
  rejectLesson,
  resumeEvaluationReport,
  resumeLessonExtraction,
  resumeSklearnTraining,
  trainBaselineModel,
  trainSklearnModel,
  uploadProjectFile,
  type AgentSession,
  type AgentMessage,
  type ExportBundleResult,
  type FileItem,
  type Lesson,
  type Project,
  type TrainingResult,
  type EvaluationReportResult,
  abandonTaskState,
} from "../lib/api";

type TrainingEngine = "baseline" | "sklearn";

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

const sampleCsv = new Blob(["age,income,churn\n42,86000,1\n37,72000,0\n55,91000,0\n"], {
  type: "text/csv",
});

async function listExpandedProjectFiles(projectId: string, folders: string[]) {
  const batches = await Promise.all([listFiles(projectId), ...folders.map((folder) => listFiles(projectId, folder))]);
  const byPath = new Map<string, FileItem>();
  for (const batch of batches) {
    for (const item of batch) {
      byPath.set(item.path, item);
    }
  }
  return Array.from(byPath.values());
}

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
    analysis: "Data Analysis",
    "machine-learning": "Machine Learning",
    evolution: "Evolution Knowledge",
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

function evaluationReportArtifactEvent(
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

function exportBundleArtifactEvent(
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

export function AppShell() {
  const deepLink = useMemo(() => readAppDeepLink(), []);
  const queryClient = useQueryClient();
  const [preferences, setPreferences] = useState<AppPreferences>(() => readAppPreferences());
  const [activeSession, setActiveSession] = useState<AgentSession | null>(null);
  const [sessionMessages, setSessionMessages] = useState<AgentMessage[]>([]);
  const [sessionEvents, setSessionEvents] = useState<AgentStreamEvent[]>([]);
  const [taskStateEvents, setTaskStateEvents] = useState<AgentStreamEvent[]>([]);
  const [durableTaskStates, setDurableTaskStates] = useState<FrontendDurableTaskState[]>([]);
  const { connected, events, lastError, sendApprovalResponse, sendMessage, sendResumeStep } = useAgentStream(
    activeSession?.id ?? "dev-session",
  );
  const projectsQuery = useProjectsQuery();
  const projects = projectsQuery.data ?? [];
  const [project, setProject] = useState<Project | null>(null);
  const sessionsQuery = useSessionsQuery(project?.id);
  const sessions = sessionsQuery.data ?? [];
  const [files, setFiles] = useState<FileItem[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState(deepLink.file ?? "data/customer_churn.csv");
  const [activeActivity, setActiveActivity] = useState<ActivityMode>(deepLink.activity ?? "explorer");
  const [activeMode, setActiveMode] = useState<MainMode>(() => resolveInitialMode(readAppPreferences(), deepLink));
  const [rightPanelTab, setRightPanelTab] = useState(deepLink.rightTab);
  const [focusedLogTaskId, setFocusedLogTaskId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [localProjectPath, setLocalProjectPath] = useState("");
  const [workspaceStatus, setWorkspaceStatus] = useState("Connecting to backend project service...");
  const [trainingResult, setTrainingResult] = useState<TrainingResult | null>(null);
  const trainingRunsQuery = useTrainingRunsQuery(project?.id);
  const trainingRuns = trainingRunsQuery.data ?? [];
  const [trainingError, setTrainingError] = useState<string | null>(null);
  const [focusedExperimentId, setFocusedExperimentId] = useState<string | null>(deepLink.experimentId ?? null);
  const gpuStatusQuery = useGpuStatusQuery(project?.id, preferences.gpuRefreshIntervalMs);
  const gpuStatus = gpuStatusQuery.data ?? null;
  const [gpuActionError, setGpuActionError] = useState<string | null>(null);
  const [suggestedTargetColumn, setSuggestedTargetColumn] = useState(() => preferences.defaultTargetColumn);
  const [trainingDatasetPath, setTrainingDatasetPath] = useState(deepLink.file ?? "data/customer_churn.csv");
  const [selectedPreprocessingPlanPath, setSelectedPreprocessingPlanPath] = useState<string | null>(null);
  const [localEvents, setLocalEvents] = useState<AgentStreamEvent[]>([]);
  const lessonsQuery = useLessonsQuery(project?.id);
  const lessons = lessonsQuery.data ?? [];
  const protocolsQuery = useEvolutionProtocolsQuery(project?.id);
  const protocols = protocolsQuery.data ?? [];
  const injectionLogsQuery = useInjectionLogsQuery(project?.id);
  const injectionLogs = injectionLogsQuery.data ?? [];

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

  function applyDurableTaskStates(taskStates: FrontendDurableTaskState[]) {
    const snapshot = taskStateSnapshot(taskStates);
    setDurableTaskStates(snapshot.states);
    setTaskStateEvents(snapshot.events);
  }

  // 课程与规则注入日志由 react-query 托管，操作后用 invalidate 触发重取
  // （替代原先成对的 setLessons / setInjectionLogs）。
  function invalidateEvolutionLists(projectId: string) {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: lessonsQueryKey(projectId) }),
      queryClient.invalidateQueries({ queryKey: injectionLogsQueryKey(projectId) }),
    ]);
  }

  async function refreshDurableTaskStates(sessionId: string | undefined = activeSession?.id) {
    if (!sessionId) {
      applyDurableTaskStates([]);
      return [];
    }
    try {
      const taskStates = await listSessionTaskStates(sessionId);
      applyDurableTaskStates(taskStates);
      return taskStates;
    } catch {
      applyDurableTaskStates([]);
      return [];
    }
  }

  async function handleAbandonTaskState(stage: WorkflowStageId) {
    const sessionId = activeSession?.id;
    if (!sessionId) {
      throw new Error("No active session is available for abandoning saved task state.");
    }
    await abandonTaskState(sessionId, stage);
    await refreshDurableTaskStates(sessionId);
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
      let rootFiles = await listFiles(current.id);
      let dataFiles: FileItem[] = [];
      if (rootFiles.some((item) => item.path === "data" && item.type === "directory")) {
        dataFiles = await listFiles(current.id, "data");
      }
      if (!dataFiles.some((item) => item.path === "data/customer_churn.csv")) {
        await uploadProjectFile(current.id, "data/customer_churn.csv", sampleCsv);
        rootFiles = await listFiles(current.id);
        dataFiles = await listFiles(current.id, "data");
      }

      if (!cancelled) {
        await activateProject(current, [...rootFiles, ...dataFiles], ["data"]);
        setWorkspaceStatus("Project files synced");
      }
    }

    async function bootstrapProject() {
      try {
        // 首读走 fetchQuery：与 useProjectsQuery 同键去重，只发一次请求，且建项后用
        // setQueryData 写回的列表不会被 hook 的并发空列表覆盖。
        let initialProjects = await queryClient.fetchQuery({
          queryKey: projectsQueryKey(),
          queryFn: () => listProjects(),
        });
        let current = initialProjects[0];
        if (!current) {
          current = await createProject("sales_churn_analysis");
          initialProjects = [current];
        }

        if (!cancelled) {
          queryClient.setQueryData(projectsQueryKey(), initialProjects);
        }
        const deepLinkedProject = deepLink.projectId ? initialProjects.find((item) => item.id === deepLink.projectId) : undefined;
        await loadProject(deepLinkedProject ?? current);
      } catch {
        if (!cancelled) {
          setWorkspaceStatus("Backend is unavailable; showing static workbench shell");
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
    let cancelled = false;

    async function loadSessionMessages() {
      if (!activeSession) {
        setSessionMessages([]);
        setSessionEvents([]);
        setTaskStateEvents([]);
        setDurableTaskStates([]);
        return;
      }
      const [messages, persistedEvents, taskStates] = await Promise.all([
        listSessionMessages(activeSession.id),
        listSessionEvents(activeSession.id),
        listSessionTaskStates(activeSession.id),
      ]);
      if (!cancelled) {
        setSessionMessages(messages);
        setSessionEvents(persistedEvents.filter(isAgentStreamEvent));
        applyDurableTaskStates(taskStates);
      }
    }

    void loadSessionMessages();
    return () => {
      cancelled = true;
    };
  }, [activeSession]);

  useEffect(() => {
    if (!project || !activeSession) return;
    const latestEvent = visibleEvents.at(-1);
    if (latestEvent?.type !== "task_progress" || latestEvent.task_id !== activeSession.id) return;

    async function refreshSessionState() {
      if (!project || !activeSession) return;
      const nextMessages = await listSessionMessages(activeSession.id);
      setSessionMessages(nextMessages);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey(project.id) }),
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
      void refreshDurableTaskStates(activeSession.id);
    }
    if (
      latestEvent?.type === "step_completed" &&
      latestEvent.task_id === activeSession.id &&
      latestEvent.label.toLowerCase().startsWith("abandoned saved ") &&
      latestEvent.label.toLowerCase().endsWith(" failure state")
    ) {
      void refreshDurableTaskStates(activeSession.id);
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
    const nextFiles = projectFiles ?? (await listFiles(nextProject.id));
    setProject(nextProject);
    setFiles(nextFiles);
    const deepLinkFolders = deepLink.file ? parentFolders(deepLink.file) : [];
    setExpandedFolders(Array.from(new Set([...(folders ?? []), ...deepLinkFolders])));
    const nextActiveFile = deepLink.file ?? nextFiles.find((item) => item.type === "file")?.path ?? "";
    setActiveFile(nextActiveFile);
    setTrainingDatasetPath(isLikelyDatasetPath(nextActiveFile) ? nextActiveFile : "data/customer_churn.csv");
    setActiveSession(null);
    setTrainingResult(null);
    setTrainingError(null);
    setFocusedExperimentId(deepLink.experimentId ?? null);
    setSuggestedTargetColumn(preferences.defaultTargetColumn);
    setSelectedPreprocessingPlanPath(null);
    setLocalEvents([]);
    setSessionMessages([]);
    setSessionEvents([]);
    setTaskStateEvents([]);
    setDurableTaskStates([]);
  }

  async function handleSelectSession(sessionId: string) {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    if (session.mode === "analysis" || session.mode === "machine-learning" || session.mode === "evolution") {
      setActiveMode(session.mode);
    }
    setActiveSession(session);
    const [messages, persistedEvents, taskStates] = await Promise.all([
      listSessionMessages(session.id),
      listSessionEvents(session.id),
      listSessionTaskStates(session.id),
    ]);
    setSessionMessages(messages);
    setSessionEvents(persistedEvents.filter(isAgentStreamEvent));
    applyDurableTaskStates(taskStates);
  }

  async function switchProject(projectId: string) {
    const nextProject = projects.find((item) => item.id === projectId);
    if (!nextProject) return;
    setWorkspaceStatus("Switching project...");
    await activateProject(nextProject);
    setWorkspaceStatus("Project files synced");
  }

  async function handleCreateProject() {
    const name = newProjectName.trim();
    if (!name) return;
    setWorkspaceStatus("Creating project...");
    const created = await createProject(name);
    const nextProjects = await listProjects();
    queryClient.setQueryData(projectsQueryKey(), nextProjects);
    setNewProjectName("");
    await activateProject(created);
    setWorkspaceStatus("Project files synced");
  }

  async function handleOpenLocalProject() {
    const path = localProjectPath.trim();
    if (!path) return;
    setWorkspaceStatus("Opening local project...");
    const opened = await openLocalProject(path);
    const nextProjects = await listProjects();
    queryClient.setQueryData(projectsQueryKey(), nextProjects);
    setLocalProjectPath("");
    await activateProject(opened);
    setWorkspaceStatus("Local project opened");
  }

  async function handleUpload(file: File) {
    if (!project) return;
    const targetPath = `data/${file.name}`;
    await uploadProjectFile(project.id, targetPath, file);
    const [rootFiles, dataFiles] = await Promise.all([listFiles(project.id), listFiles(project.id, "data")]);
    setFiles([...rootFiles, ...dataFiles]);
    setExpandedFolders((current) => (current.includes("data") ? current : [...current, "data"]));
    setActiveFile(targetPath);
    setTrainingDatasetPath(targetPath);
  }

  async function refreshExpandedFiles(extraFolders: string[] = []) {
    if (!project) return [];
    const folders = Array.from(new Set([...expandedFolders, ...extraFolders]));
    const nextFiles = await listExpandedProjectFiles(project.id, folders);
    setFiles(nextFiles);
    setExpandedFolders(folders);
    return nextFiles;
  }

  async function handleCreateFile(path: string, type: "file" | "directory") {
    if (!project) return;
    await createProjectFile(project.id, path, type);
    const containingFolder = parentPath(path);
    await refreshExpandedFiles(containingFolder ? [containingFolder] : []);
    if (type === "file") {
      setActiveFile(path);
      if (isLikelyDatasetPath(path)) {
        setTrainingDatasetPath(path);
      }
    }
  }

  async function handleRenameFile(path: string, newPath: string) {
    if (!project || path === newPath) return;
    await renameProjectFile(project.id, path, newPath);
    const nextExpandedFolders = Array.from(
      new Set([
        ...expandedFolders.map((folder) =>
          folder === path || folder.startsWith(`${path}/`) ? folder.replace(path, newPath) : folder,
        ),
        parentPath(path),
        parentPath(newPath),
      ].filter(Boolean)),
    );
    setFiles(await listExpandedProjectFiles(project.id, nextExpandedFolders));
    setExpandedFolders(nextExpandedFolders);
    if (activeFile === path || activeFile.startsWith(`${path}/`)) {
      setActiveFile(activeFile.replace(path, newPath));
    }
    if (trainingDatasetPath === path || trainingDatasetPath.startsWith(`${path}/`)) {
      setTrainingDatasetPath(trainingDatasetPath.replace(path, newPath));
    }
    if (
      selectedPreprocessingPlanPath &&
      (selectedPreprocessingPlanPath === path || selectedPreprocessingPlanPath.startsWith(`${path}/`))
    ) {
      setSelectedPreprocessingPlanPath(selectedPreprocessingPlanPath.replace(path, newPath));
    }
  }

  async function handleDeleteFile(path: string) {
    if (!project) return;
    await deleteProjectFile(project.id, path);
    const nextExpandedFolders = Array.from(
      new Set([...expandedFolders.filter((folder) => folder !== path && !folder.startsWith(`${path}/`)), parentPath(path)].filter(Boolean)),
    );
    const nextFiles = await listExpandedProjectFiles(project.id, nextExpandedFolders);
    setFiles(nextFiles);
    setExpandedFolders(nextExpandedFolders);
    if (activeFile === path || activeFile.startsWith(`${path}/`)) {
      setActiveFile(nextFiles.find((item) => item.type === "file")?.path ?? "");
    }
    if (trainingDatasetPath === path || trainingDatasetPath.startsWith(`${path}/`)) {
      setTrainingDatasetPath(nextFiles.find((item) => item.type === "file" && isLikelyDatasetPath(item.path))?.path ?? "");
    }
    if (
      selectedPreprocessingPlanPath &&
      (selectedPreprocessingPlanPath === path || selectedPreprocessingPlanPath.startsWith(`${path}/`))
    ) {
      setSelectedPreprocessingPlanPath(null);
    }
  }

  async function handleToggleFolder(path: string) {
    if (!project) return;
    if (expandedFolders.includes(path)) {
      setExpandedFolders((current) => current.filter((item) => item !== path && !item.startsWith(`${path}/`)));
      setFiles((current) => current.filter((item) => item.path === path || !item.path.startsWith(`${path}/`)));
      return;
    }

    const children = await listFiles(project.id, path);
    setFiles((current) => {
      const byPath = new Map(current.map((item) => [item.path, item]));
      for (const child of children) {
        byPath.set(child.path, child);
      }
      return Array.from(byPath.values());
    });
    setExpandedFolders((current) => [...current, path]);
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
      setFiles(await listExpandedProjectFiles(project.id, expandedFolders));
      await queryClient.invalidateQueries({ queryKey: trainingRunsQueryKey(project.id) });
      await refreshDurableTaskStates(trainingSessionId);
      const lesson = await extractLesson(project.id, {
        source_type: "training",
        source_id: result.experiment_id,
        domain: ["machine_learning", result.engine],
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
      await refreshDurableTaskStates(trainingSessionId);
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
      setFiles(await listExpandedProjectFiles(project.id, expandedFolders));
      await queryClient.invalidateQueries({ queryKey: trainingRunsQueryKey(project.id) });
      await refreshDurableTaskStates(trainingSessionId);
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
      await refreshDurableTaskStates(trainingSessionId);
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

  async function applyEvaluationReportResult(result: EvaluationReportResult, sessionId: string, label: string) {
    if (!project) return;
    setFiles(await listExpandedProjectFiles(project.id, expandedFolders));
    await queryClient.invalidateQueries({ queryKey: trainingRunsQueryKey(project.id) });
    await refreshDurableTaskStates(sessionId);
    setFocusedExperimentId(result.experiment_id);
    setActiveMode("machine-learning");
    setRightPanelTab("training");
    setLocalEvents((current) => [
      ...current,
      evaluationReportArtifactEvent(project.id, sessionId, result),
      {
        type: "stage_completed",
        task_id: sessionId,
        stage: "evaluate",
        label,
        completed_at: new Date().toISOString(),
      },
    ]);
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
      await refreshDurableTaskStates(sessionId);
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
      await refreshDurableTaskStates(sessionId);
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

  async function applyExportBundleResult(result: ExportBundleResult, sessionId: string, label: string) {
    if (!project) return;
    setFiles(await listExpandedProjectFiles(project.id, expandedFolders));
    await queryClient.invalidateQueries({ queryKey: trainingRunsQueryKey(project.id) });
    await refreshDurableTaskStates(sessionId);
    setFocusedExperimentId(result.experiment_id);
    setActiveMode("machine-learning");
    setRightPanelTab("training");
    setLocalEvents((current) => [
      ...current,
      exportBundleArtifactEvent(project.id, sessionId, result),
      {
        type: "stage_completed",
        task_id: sessionId,
        stage: "export",
        label,
        completed_at: new Date().toISOString(),
      },
    ]);
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
      await refreshDurableTaskStates(sessionId);
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
      await refreshDurableTaskStates(sessionId);
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

  async function applyLearnedLessons(items: Lesson[], sessionId: string, label: string) {
    if (!project) return;
    await invalidateEvolutionLists(project.id);
    await refreshDurableTaskStates(sessionId);
    setActiveMode("evolution");
    setActiveActivity("knowledge");
    setLocalEvents((current) => [
      ...current,
      ...items.map(
        (lesson): AgentStreamEvent => ({
          type: "lesson_extracted",
          lesson_id: lesson.id,
          confidence: lesson.confidence,
        }),
      ),
      {
        type: "stage_completed",
        task_id: sessionId,
        stage: "learn",
        label,
        completed_at: new Date().toISOString(),
      },
    ]);
  }

  async function handleExtractLessonsFromSession(sourceSessionId?: string) {
    if (!project) return;
    const sessionId = sourceSessionId ?? activeSession?.id;
    if (!sessionId) return;
    setLocalEvents((current) => [
      ...current,
      {
        type: "stage_started",
        task_id: sessionId,
        stage: "learn",
        label: "Extracting learned rules",
        started_at: new Date().toISOString(),
      },
    ]);
    try {
      const items = await extractLessonsFromSession(project.id, sessionId);
      await applyLearnedLessons(items, sessionId, "Learned rule extraction completed");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Lesson extraction failed";
      await refreshDurableTaskStates(sessionId);
      setLocalEvents((current) => [
        ...current,
        {
          type: "step_failed",
          task_id: sessionId,
          stage: "learn",
          label: "Lesson extraction failed",
          error: errorMessage,
          retryable: true,
          resume_stage: "learn",
        },
      ]);
      throw error;
    }
  }

  async function handleRetryLearningExtraction() {
    if (!project || !activeSession) return;
    const sessionId = activeSession.id;
    setLocalEvents((current) => [
      ...current,
      {
        type: "task_resumed",
        task_id: sessionId,
        stage: "learn",
        label: "Retrying learned rule extraction",
      },
    ]);
    try {
      const items = await resumeLessonExtraction(project.id, sessionId);
      await applyLearnedLessons(items, sessionId, "Learned rule extraction completed after retry");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Lesson extraction retry failed";
      await refreshDurableTaskStates(sessionId);
      setLocalEvents((current) => [
        ...current,
        {
          type: "step_failed",
          task_id: sessionId,
          stage: "learn",
          label: "Lesson extraction retry failed",
          error: errorMessage,
          retryable: true,
          resume_stage: "learn",
        },
      ]);
      throw error;
    }
  }

  async function handleAdoptLesson(lessonId: string) {
    if (!project) return;
    await adoptLesson(project.id, lessonId);
    await invalidateEvolutionLists(project.id);
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

  async function handleGenerateReport() {
    if (!project) return;
    const sessionId = activeSession?.id ?? "manual-analysis";
    const result = await generateAnalysisReport(project.id, activeFile, sessionId);
    const reportFolder = parentPath(result.artifact.path);
    const nextFolders = Array.from(new Set([...expandedFolders, "results", reportFolder].filter(Boolean)));
    setFiles(await listExpandedProjectFiles(project.id, nextFolders));
    setExpandedFolders(nextFolders);
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
    const nextFolders = Array.from(new Set([...expandedFolders, "results", profileFolder].filter(Boolean)));
    setFiles(await listExpandedProjectFiles(project.id, nextFolders));
    setExpandedFolders(nextFolders);
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

  async function handleGeneratePreprocessingPlan() {
    if (!project) return;
    const sessionId = activeSession?.id ?? "manual-analysis";
    const datasetPath = isLikelyDatasetPath(activeFile) ? activeFile : trainingDatasetPath;
    const result = await generatePreprocessingPlan(project.id, datasetPath, sessionId);
    const planFolder = parentPath(result.plan_artifact.path);
    const nextFolders = Array.from(
      new Set([
        ...expandedFolders,
        "results",
        planFolder,
        "notebooks",
      ].filter(Boolean)),
    );
    setFiles(await listExpandedProjectFiles(project.id, nextFolders));
    setExpandedFolders(nextFolders);
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

  async function handleExecutePreprocessingPlan(preprocessingPlanPath?: string | null) {
    const planPath = preprocessingPlanPath ?? selectedPreprocessingPlanPath;
    if (!project || !planPath) return;
    const sessionId = activeSession?.id ?? "manual-analysis";
    const datasetPath = isLikelyDatasetPath(activeFile) ? activeFile : null;
    const result = await executePreprocessingPlan(project.id, datasetPath, planPath, sessionId);
    const outputFolder = parentPath(result.transformed_data_artifact.path);
    const summaryFolder = parentPath(result.summary_artifact.path);
    const reportFolder = parentPath(result.report_artifact.path);
    const nextFolders = Array.from(
      new Set([
        ...expandedFolders,
        "results",
        outputFolder,
        summaryFolder,
        reportFolder,
      ].filter(Boolean)),
    );
    setFiles(await listExpandedProjectFiles(project.id, nextFolders));
    setExpandedFolders(nextFolders);
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
    preprocessingPlanPath?: string | null,
  ) {
    sendApprovalResponse({
      approvalId,
      decision,
      context: { projectId: project?.id, activeFile, mode: activeMode },
    });
    if (preprocessingPlanPath) {
      setSelectedPreprocessingPlanPath(preprocessingPlanPath);
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
    setFiles(await listExpandedProjectFiles(project.id, nextFolders));
    setExpandedFolders(nextFolders);
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
    const nextFolders = Array.from(new Set([...expandedFolders, "results", handoffFolder].filter(Boolean)));
    setFiles(await listExpandedProjectFiles(project.id, nextFolders));
    setExpandedFolders(nextFolders);
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

  async function handleRejectLesson(lessonId: string) {
    if (!project) return;
    await rejectLesson(project.id, lessonId);
    await invalidateEvolutionLists(project.id);
  }

  async function handleMarkLessonConflict(lessonId: string, reason: string) {
    if (!project) return;
    await markLessonConflict(project.id, lessonId, reason);
    await invalidateEvolutionLists(project.id);
  }

  function handleSelectProjectFile(path: string) {
    setActiveActivity("explorer");
    setExpandedFolders((current) => Array.from(new Set([...current, ...parentFolders(path)])));
    setActiveFile(path);
    if (isLikelyDatasetPath(path)) {
      setTrainingDatasetPath(path);
    }
    if (path.endsWith("preprocessing_plan.json")) {
      setSelectedPreprocessingPlanPath(path);
    }
  }

  function handleSelectExperimentRun(experimentId: string) {
    setFocusedExperimentId(experimentId);
    setActiveActivity("experiments");
    setActiveMode("machine-learning");
  }

  return (
    <div className="app-shell">
      <header className="top-nav">
        <div className="brand">MLAgent</div>
        <nav className="mode-tabs" aria-label="Main modes">
          <button className={activeMode === "analysis" ? "active" : ""} onClick={() => setActiveMode("analysis")}>
            Data Analysis
          </button>
          <button
            className={activeMode === "machine-learning" ? "active" : ""}
            onClick={() => setActiveMode("machine-learning")}
          >
            Machine Learning
          </button>
          <button className={activeMode === "evolution" ? "active" : ""} onClick={() => setActiveMode("evolution")}>
            Evolution Knowledge
          </button>
        </nav>
        <ModelStatusIndicator />
      </header>
      <aside className="activity-bar" aria-label="Workspace navigation">
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
            activePath={activeFile}
            currentProjectId={project?.id}
            expandedFolders={expandedFolders}
            files={files}
            localProjectPath={localProjectPath}
            newProjectName={newProjectName}
            onCreateProject={handleCreateProject}
            onCreateFile={handleCreateFile}
            onDeleteFile={handleDeleteFile}
            onLocalProjectPathChange={setLocalProjectPath}
            onNewProjectNameChange={setNewProjectName}
            onOpenLocalProject={handleOpenLocalProject}
            onRenameFile={handleRenameFile}
            onSelect={handleSelectProjectFile}
            onSwitchProject={(projectId) => void switchProject(projectId)}
            onToggleFolder={(path) => void handleToggleFolder(path)}
            onUpload={handleUpload}
            projects={projects}
            projectName={project?.name}
            projectPath={project?.workspace_path}
            sessions={sessions}
            activeSessionId={activeSession?.id}
            onSelectSession={(sessionId) => void handleSelectSession(sessionId)}
            status={workspaceStatus}
          />
        ) : activeActivity === "search" ? (
          <SearchPanel projectId={project?.id} onSelect={handleSelectProjectFile} />
        ) : (
          <ActivityPanel
            activeFile={activeFile}
            activity={activeActivity}
            artifactCount={artifactCount}
            connected={connected}
            eventsCount={visibleEvents.length}
            files={files}
            gpuStatus={gpuStatus}
            injectionLogs={injectionLogs}
            lessons={lessons}
            preferences={preferences}
            focusedExperimentId={focusedExperimentId}
            onPreferenceChange={handlePreferenceChange}
            onSelectExperimentRun={handleSelectExperimentRun}
            onSelectFile={handleSelectProjectFile}
            onSelectMode={setActiveMode}
            project={project}
            projects={projects}
            protocols={protocols}
            sessions={sessions}
            trainingRuns={trainingRuns}
          />
        )}
      </aside>
      {activeMode === "evolution" ? (
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
          onOpenLogs={(taskId) => {
            setFocusedLogTaskId(taskId ?? null);
            setRightPanelTab("logs");
          }}
          onRetryLearning={handleRetryLearningExtraction}
          onMarkConflict={handleMarkLessonConflict}
          onSelectExperimentRun={handleSelectExperimentRun}
          onSelectProjectFile={handleSelectProjectFile}
          onReject={handleRejectLesson}
        />
      ) : (
        <AgentWorkspace
          activeFile={activeFile}
          mode={activeMode}
          connected={connected}
          events={visibleEvents}
          focusedExperimentId={focusedExperimentId}
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
          onOpenLogs={(taskId) => {
            setFocusedLogTaskId(taskId ?? null);
            setRightPanelTab("logs");
          }}
          onOpenTraining={() => setActiveMode("machine-learning")}
          onRegenerateEvaluationReport={handleGenerateEvaluationReport}
          onRespondToApproval={handleRespondToApproval}
          onResumeStep={handleResumeStep}
          onRetryEvaluation={handleRetryEvaluationReport}
          onRetryExport={handleRetryExportBundle}
          onRetryLearning={handleRetryLearningExtraction}
          onRetrySklearnTraining={handleRetrySklearnTraining}
          onSelectExperimentRun={setFocusedExperimentId}
          onSelectFile={handleSelectProjectFile}
          onTrainSklearn={(targetColumn, planPath, datasetPath) =>
            handleTrainModel(targetColumn, "sklearn", false, planPath, datasetPath)
          }
          sendMessage={sendMessage}
        />
      )}
      <RightPanel
        activeFile={activeFile}
        events={visibleEvents}
        mode={activeMode}
        preprocessingPlanPath={selectedPreprocessingPlanPath}
        projectId={project?.id}
        sessionId={activeSession?.id}
        trainingDatasetPath={trainingDatasetPath}
        trainingError={trainingError}
        trainingResult={trainingResult}
        trainingRuns={trainingRuns}
        gpuStatus={gpuStatus}
        gpuActionError={gpuActionError}
        focusedExperimentId={focusedExperimentId}
        focusedLogTaskId={focusedLogTaskId}
        suggestedTargetColumn={suggestedTargetColumn}
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
        initialTab={rightPanelTab}
      />
      <footer className="status-bar">
        <span>{connected ? "WebSocket Connected" : "WebSocket Disconnected"}</span>
        <span>Project: {project?.name ?? "None"}</span>
        <span>Session: {activeSession?.title ?? "None"}</span>
        <span>Active file: {activeFile}</span>
        <span>Artifacts: {artifactCount}</span>
        <span>GPU: {gpuStatus?.status ?? "unknown"}</span>
      </footer>
    </div>
  );
}
