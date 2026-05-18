import { useEffect, useMemo, useState } from "react";
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

import { AgentWorkspace } from "../features/chat/AgentWorkspace";
import type { AgentStreamEvent } from "../features/chat/types";
import { useAgentStream } from "../features/chat/useAgentStream";
import { EvolutionWorkspace } from "../features/evolution/EvolutionWorkspace";
import { FileExplorer } from "../features/files/FileExplorer";
import { RightPanel } from "../features/right-panel/RightPanel";
import {
  adoptLesson,
  createAgentSession,
  createProject,
  extractLesson,
  listEvolutionInjectionLog,
  listEvolutionProtocols,
  listFiles,
  listLessons,
  listProjectSessions,
  listProjects,
  listSessionEvents,
  listSessionMessages,
  listTrainingRuns,
  markLessonConflict,
  rejectLesson,
  trainBaselineModel,
  trainSklearnModel,
  uploadProjectFile,
  type AgentSession,
  type AgentMessage,
  type EvolutionInjectionLog,
  type ExperimentRun,
  type EvolutionProtocol,
  type FileItem,
  type Lesson,
  type Project,
  type TrainingResult,
} from "../lib/api";

type MainMode = "analysis" | "machine-learning" | "evolution";
type TrainingEngine = "baseline" | "sklearn";

const sampleCsv = new Blob(["age,income,churn\n42,86000,1\n37,72000,0\n55,91000,0\n"], {
  type: "text/csv",
});

async function listWorkbenchFiles(projectId: string) {
  const rootFiles = await listFiles(projectId);
  const dataFiles = await listFiles(projectId, "data");
  return [...rootFiles, ...dataFiles];
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

export function AppShell() {
  const [activeSession, setActiveSession] = useState<AgentSession | null>(null);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [sessionMessages, setSessionMessages] = useState<AgentMessage[]>([]);
  const [sessionEvents, setSessionEvents] = useState<AgentStreamEvent[]>([]);
  const { connected, events, lastError, sendMessage } = useAgentStream(activeSession?.id ?? "dev-session");
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [activeFile, setActiveFile] = useState("data/customer_churn.csv");
  const [activeMode, setActiveMode] = useState<MainMode>("analysis");
  const [newProjectName, setNewProjectName] = useState("");
  const [workspaceStatus, setWorkspaceStatus] = useState("正在连接后端项目服务...");
  const [trainingResult, setTrainingResult] = useState<TrainingResult | null>(null);
  const [trainingRuns, setTrainingRuns] = useState<ExperimentRun[]>([]);
  const [trainingError, setTrainingError] = useState<string | null>(null);
  const [localEvents, setLocalEvents] = useState<AgentStreamEvent[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [protocols, setProtocols] = useState<EvolutionProtocol[]>([]);
  const [injectionLogs, setInjectionLogs] = useState<EvolutionInjectionLog[]>([]);

  const visibleEvents = useMemo(() => [...sessionEvents, ...events, ...localEvents], [events, localEvents, sessionEvents]);
  const artifactCount = useMemo(
    () => visibleEvents.filter((event) => event.type === "artifact_created").length,
    [visibleEvents],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadProject(current: Project) {
      let projectFiles = await listWorkbenchFiles(current.id);
      if (!projectFiles.some((item) => item.path === "data/customer_churn.csv")) {
        await uploadProjectFile(current.id, "data/customer_churn.csv", sampleCsv);
        projectFiles = await listWorkbenchFiles(current.id);
      }

      if (!cancelled) {
        await activateProject(current, projectFiles);
        setWorkspaceStatus("项目文件已同步");
      }
    }

    async function bootstrapProject() {
      try {
        let initialProjects = await listProjects();
        let current = initialProjects[0];
        if (!current) {
          current = await createProject("sales_churn_analysis");
          initialProjects = [current];
        }

        if (!cancelled) {
          setProjects(initialProjects);
        }
        await loadProject(current);
      } catch {
        if (!cancelled) {
          setWorkspaceStatus("后端未连接，当前展示静态工作台骨架");
        }
      }
    }

    void bootstrapProject();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function ensureModeSession() {
      if (!project) return;
      const existingSessions = await listProjectSessions(project.id);
      let nextSession =
        existingSessions.find((session) => session.id === activeSession?.id && session.mode === activeMode) ??
        existingSessions.find((session) => session.mode === activeMode);
      if (!nextSession) {
        nextSession = await createAgentSession(project.id, {
          mode: activeMode,
          title: `${modeLabel(activeMode)} - ${project.name}`,
        });
      }
      const refreshedSessions = await listProjectSessions(project.id);
      if (!cancelled) {
        setSessions(refreshedSessions);
        setActiveSession(nextSession);
      }
    }

    void ensureModeSession();
    return () => {
      cancelled = true;
    };
  }, [activeMode, activeSession?.id, project]);

  useEffect(() => {
    let cancelled = false;

    async function loadSessionMessages() {
      if (!activeSession) {
        setSessionMessages([]);
        setSessionEvents([]);
        return;
      }
      const [messages, persistedEvents] = await Promise.all([
        listSessionMessages(activeSession.id),
        listSessionEvents(activeSession.id),
      ]);
      if (!cancelled) {
        setSessionMessages(messages);
        setSessionEvents(persistedEvents.filter(isAgentStreamEvent));
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
      const [nextSessions, nextMessages, nextLessons, nextInjectionLogs] = await Promise.all([
        listProjectSessions(project.id),
        listSessionMessages(activeSession.id),
        listLessons(project.id),
        listEvolutionInjectionLog(project.id),
      ]);
      setSessions(nextSessions);
      setSessionMessages(nextMessages);
      setLessons(nextLessons);
      setInjectionLogs(nextInjectionLogs);
    }

    void refreshSessionState();
  }, [activeSession, project, visibleEvents]);

  async function activateProject(nextProject: Project, projectFiles?: FileItem[]) {
    const nextFiles = projectFiles ?? (await listWorkbenchFiles(nextProject.id));
    setProject(nextProject);
    setFiles(nextFiles);
    setActiveFile(nextFiles.find((item) => item.type === "file")?.path ?? "");
    const [nextLessons, nextProtocols, nextTrainingRuns, nextSessions, nextInjectionLogs] = await Promise.all([
      listLessons(nextProject.id),
      listEvolutionProtocols(nextProject.id),
      listTrainingRuns(nextProject.id),
      listProjectSessions(nextProject.id),
      listEvolutionInjectionLog(nextProject.id),
    ]);
    setLessons(nextLessons);
    setProtocols(nextProtocols);
    setTrainingRuns(nextTrainingRuns);
    setSessions(nextSessions);
    setInjectionLogs(nextInjectionLogs);
    setActiveSession(null);
    setTrainingResult(null);
    setTrainingError(null);
    setLocalEvents([]);
    setSessionMessages([]);
    setSessionEvents([]);
  }

  async function handleSelectSession(sessionId: string) {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    if (session.mode === "analysis" || session.mode === "machine-learning" || session.mode === "evolution") {
      setActiveMode(session.mode);
    }
    setActiveSession(session);
    const [messages, persistedEvents] = await Promise.all([
      listSessionMessages(session.id),
      listSessionEvents(session.id),
    ]);
    setSessionMessages(messages);
    setSessionEvents(persistedEvents.filter(isAgentStreamEvent));
  }

  async function switchProject(projectId: string) {
    const nextProject = projects.find((item) => item.id === projectId);
    if (!nextProject) return;
    setWorkspaceStatus("正在切换项目...");
    await activateProject(nextProject);
    setWorkspaceStatus("项目文件已同步");
  }

  async function handleCreateProject() {
    const name = newProjectName.trim();
    if (!name) return;
    setWorkspaceStatus("正在创建项目...");
    const created = await createProject(name);
    const nextProjects = await listProjects();
    setProjects(nextProjects);
    setNewProjectName("");
    await activateProject(created);
    setWorkspaceStatus("项目文件已同步");
  }

  async function handleUpload(file: File) {
    if (!project) return;
    const targetPath = `data/${file.name}`;
    await uploadProjectFile(project.id, targetPath, file);
    setFiles(await listWorkbenchFiles(project.id));
    setActiveFile(targetPath);
  }

  async function handleTrainModel(targetColumn: string, engine: TrainingEngine, useGpu: boolean) {
    if (!project) return;
    setTrainingError(null);
    setLocalEvents((current) => [
      ...current,
      {
        type: "task_progress",
        task_id: "manual-training",
        progress: 0.2,
        label: `开始训练 ${engine} 模型`,
      },
    ]);
    try {
      const result =
        engine === "sklearn"
          ? await trainSklearnModel(project.id, activeFile, targetColumn, "manual-training", useGpu)
          : await trainBaselineModel(project.id, activeFile, targetColumn, "manual-training");
      setTrainingResult(result);
      setFiles(await listWorkbenchFiles(project.id));
      setTrainingRuns(await listTrainingRuns(project.id));
      const lesson = await extractLesson(project.id, {
        source_type: "training",
        source_id: result.experiment_id,
        domain: ["machine_learning", result.engine],
        observation: `当前数据集 ${activeFile} 的 ${result.engine} 最佳模型为 ${String(
          result.model.strategy ?? result.model.algorithm,
        )}，accuracy ${(result.metrics.accuracy * 100).toFixed(2)}%。`,
        recommendation:
          result.engine === "sklearn"
            ? "将 sklearn 实验结果作为后续特征工程、模型搜索和部署评估的基准。"
            : "在进入更昂贵的训练前，先运行 baseline 和数值阈值模型作为对照。",
        confidence: Math.min(0.95, Math.max(0.5, result.metrics.accuracy)),
        evidence: {
          accuracy: result.metrics.accuracy,
          f1_weighted: result.metrics.f1_weighted,
          runs: result.runs.map((run) => run.model_name),
          model_path: result.model_artifact.path,
          engine: result.engine,
        },
      });
      const [nextLessons, nextInjectionLogs] = await Promise.all([
        listLessons(project.id),
        listEvolutionInjectionLog(project.id),
      ]);
      setLessons(nextLessons);
      setInjectionLogs(nextInjectionLogs);
      setLocalEvents((current) => [
        ...current,
        {
          type: "artifact_created",
          artifact: {
            id: result.metrics_artifact.id,
            project_id: project.id,
            session_id: "manual-training",
            type: "training",
            name: result.metrics_artifact.name,
            path: result.metrics_artifact.path,
            metadata: { experiment_id: result.experiment_id },
            created_at: result.metrics_artifact.created_at,
          },
        },
        {
          type: "artifact_created",
          artifact: {
            id: `${result.experiment_id}-model`,
            project_id: project.id,
            session_id: "manual-training",
            type: "model",
            name: result.model_artifact.name,
            path: result.model_artifact.path,
            metadata: { experiment_id: result.experiment_id },
            created_at: new Date().toISOString(),
          },
        },
        {
          type: "task_progress",
          task_id: "manual-training",
          progress: 1,
          label: `${result.engine} 训练完成`,
        },
        {
          type: "lesson_extracted",
          lesson_id: lesson.id,
          confidence: lesson.confidence,
        },
      ]);
    } catch (error) {
      setTrainingError(error instanceof Error ? error.message : "训练任务失败");
      setLocalEvents((current) => [
        ...current,
        { type: "error", code: "training_failed", message: `${engine} 训练失败` },
      ]);
    }
  }

  async function handleAdoptLesson(lessonId: string) {
    if (!project) return;
    await adoptLesson(project.id, lessonId);
    const [nextLessons, nextInjectionLogs] = await Promise.all([
      listLessons(project.id),
      listEvolutionInjectionLog(project.id),
    ]);
    setLessons(nextLessons);
    setInjectionLogs(nextInjectionLogs);
  }

  async function handleRejectLesson(lessonId: string) {
    if (!project) return;
    await rejectLesson(project.id, lessonId);
    const [nextLessons, nextInjectionLogs] = await Promise.all([
      listLessons(project.id),
      listEvolutionInjectionLog(project.id),
    ]);
    setLessons(nextLessons);
    setInjectionLogs(nextInjectionLogs);
  }

  async function handleMarkLessonConflict(lessonId: string, reason: string) {
    if (!project) return;
    await markLessonConflict(project.id, lessonId, reason);
    const [nextLessons, nextInjectionLogs] = await Promise.all([
      listLessons(project.id),
      listEvolutionInjectionLog(project.id),
    ]);
    setLessons(nextLessons);
    setInjectionLogs(nextInjectionLogs);
  }

  return (
    <div className="app-shell">
      <header className="top-nav">
        <div className="brand">MLAgent</div>
        <nav className="mode-tabs" aria-label="主功能">
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
        <div className="model-selector">Claude / DeepSeek / Local vLLM</div>
      </header>
      <aside className="activity-bar" aria-label="工作台导航">
        <button className="active" aria-label="资源管理器" title="资源管理器">
          <FolderOpen size={18} />
        </button>
        <button aria-label="搜索" title="搜索">
          <Search size={18} />
        </button>
        <button aria-label="数据源" title="数据源">
          <Database size={18} />
        </button>
        <button aria-label="实验" title="实验">
          <FlaskConical size={18} />
        </button>
        <button aria-label="版本" title="版本">
          <GitBranch size={18} />
        </button>
        <button aria-label="知识库" title="知识库">
          <BookOpen size={18} />
        </button>
        <div className="activity-spacer" />
        <button aria-label="账户" title="账户">
          <UserCircle size={18} />
        </button>
        <button aria-label="设置" title="设置">
          <Settings size={18} />
        </button>
      </aside>
      <aside className="file-sidebar">
        <FileExplorer
          activePath={activeFile}
          currentProjectId={project?.id}
          files={files}
          newProjectName={newProjectName}
          onCreateProject={handleCreateProject}
          onNewProjectNameChange={setNewProjectName}
          onSelect={setActiveFile}
          onSwitchProject={(projectId) => void switchProject(projectId)}
          onUpload={handleUpload}
          projects={projects}
          projectName={project?.name}
          projectPath={project?.workspace_path}
          sessions={sessions}
          activeSessionId={activeSession?.id}
          onSelectSession={(sessionId) => void handleSelectSession(sessionId)}
          status={workspaceStatus}
        />
      </aside>
      {activeMode === "evolution" ? (
        <EvolutionWorkspace
          lessons={lessons}
          injectionLogs={injectionLogs}
          protocols={protocols}
          onAdopt={handleAdoptLesson}
          onMarkConflict={handleMarkLessonConflict}
          onReject={handleRejectLesson}
        />
      ) : (
        <AgentWorkspace
          activeFile={activeFile}
          mode={activeMode}
          connected={connected}
          events={visibleEvents}
          historyMessages={sessionMessages}
          lastError={lastError}
          projectId={project?.id}
          sendMessage={sendMessage}
        />
      )}
      <RightPanel
        activeFile={activeFile}
        events={visibleEvents}
        mode={activeMode}
        projectId={project?.id}
        sessionId={activeSession?.id}
        trainingError={trainingError}
        trainingResult={trainingResult}
        trainingRuns={trainingRuns}
        onTrainModel={handleTrainModel}
      />
      <footer className="status-bar">
        <span>{connected ? "WebSocket Connected" : "WebSocket Disconnected"}</span>
        <span>Project: {project?.name ?? "None"}</span>
        <span>Session: {activeSession?.title ?? "None"}</span>
        <span>Active file: {activeFile}</span>
        <span>Artifacts: {artifactCount}</span>
      </footer>
    </div>
  );
}
