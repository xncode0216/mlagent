import { useEffect, useMemo, useState } from "react";

import { AgentWorkspace } from "../features/chat/AgentWorkspace";
import type { AgentStreamEvent } from "../features/chat/types";
import { useAgentStream } from "../features/chat/useAgentStream";
import { EvolutionWorkspace } from "../features/evolution/EvolutionWorkspace";
import { FileExplorer } from "../features/files/FileExplorer";
import { RightPanel } from "../features/right-panel/RightPanel";
import {
  adoptLesson,
  createProject,
  extractLesson,
  listFiles,
  listLessons,
  listProjects,
  listTrainingRuns,
  rejectLesson,
  trainBaselineModel,
  trainSklearnModel,
  uploadProjectFile,
  type FileItem,
  type ExperimentRun,
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

export function AppShell() {
  const { connected, events, lastError, sendMessage } = useAgentStream("dev-session");
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

  const visibleEvents = useMemo(() => [...events, ...localEvents], [events, localEvents]);
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
        setProject(current);
        setFiles(projectFiles);
        setActiveFile(projectFiles.find((item) => item.type === "file")?.path ?? "data/customer_churn.csv");
        setLessons(await listLessons(current.id));
        setTrainingRuns(await listTrainingRuns(current.id));
        setTrainingResult(null);
        setTrainingError(null);
        setLocalEvents([]);
        setWorkspaceStatus("项目文件已同步");
      }
    }

    async function bootstrapProject() {
      try {
        let projects = await listProjects();
        let current = projects[0];
        if (!current) {
          current = await createProject("sales_churn_analysis");
          projects = [current];
        }

        if (!cancelled) {
          setProjects(projects);
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

  async function switchProject(projectId: string) {
    const nextProject = projects.find((item) => item.id === projectId);
    if (!nextProject) return;
    setWorkspaceStatus("正在切换项目...");
    const projectFiles = await listWorkbenchFiles(nextProject.id);
    setProject(nextProject);
    setFiles(projectFiles);
    setActiveFile(projectFiles.find((item) => item.type === "file")?.path ?? "");
    setLessons(await listLessons(nextProject.id));
    setTrainingRuns(await listTrainingRuns(nextProject.id));
    setTrainingResult(null);
    setTrainingError(null);
    setLocalEvents([]);
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
    await switchProjectFromRecord(created);
  }

  async function switchProjectFromRecord(nextProject: Project) {
    const projectFiles = await listWorkbenchFiles(nextProject.id);
    setProject(nextProject);
    setFiles(projectFiles);
    setActiveFile(projectFiles.find((item) => item.type === "file")?.path ?? "");
    setLessons(await listLessons(nextProject.id));
    setTrainingRuns(await listTrainingRuns(nextProject.id));
    setTrainingResult(null);
    setTrainingError(null);
    setLocalEvents([]);
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
        observation: `当前数据集 ${activeFile} 的 ${result.engine} 最佳模型为 ${String(result.model.strategy ?? result.model.algorithm)}，accuracy ${(result.metrics.accuracy * 100).toFixed(2)}%。`,
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
      setLessons(await listLessons(project.id));
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
    setLessons(await listLessons(project.id));
  }

  async function handleRejectLesson(lessonId: string) {
    if (!project) return;
    await rejectLesson(project.id, lessonId);
    setLessons(await listLessons(project.id));
  }

  return (
    <div className="app-shell">
      <header className="top-nav">
        <div className="brand">MLAgent</div>
        <div className="project-switcher">
          <select
            aria-label="当前项目"
            disabled={projects.length === 0}
            value={project?.id ?? ""}
            onChange={(event) => void switchProject(event.target.value)}
          >
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <input
            aria-label="新项目名称"
            placeholder="新项目名称"
            value={newProjectName}
            onChange={(event) => setNewProjectName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleCreateProject();
            }}
          />
          <button disabled={!newProjectName.trim()} onClick={() => void handleCreateProject()}>
            新建
          </button>
        </div>
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
      <aside className="file-sidebar">
        <FileExplorer
          activePath={activeFile}
          files={files}
          onSelect={setActiveFile}
          onUpload={handleUpload}
          projectName={project?.name}
          projectPath={project?.workspace_path}
          status={workspaceStatus}
        />
      </aside>
      {activeMode === "evolution" ? (
        <EvolutionWorkspace lessons={lessons} onAdopt={handleAdoptLesson} onReject={handleRejectLesson} />
      ) : (
        <AgentWorkspace
          activeFile={activeFile}
          connected={connected}
          events={visibleEvents}
          lastError={lastError}
          projectId={project?.id}
          sendMessage={sendMessage}
        />
      )}
      <RightPanel
        activeFile={activeFile}
        events={visibleEvents}
        projectId={project?.id}
        trainingError={trainingError}
        trainingResult={trainingResult}
        trainingRuns={trainingRuns}
        onTrainModel={handleTrainModel}
      />
      <footer className="status-bar">
        <span>{connected ? "WebSocket Connected" : "WebSocket Disconnected"}</span>
        <span>Project: {project?.name ?? "None"}</span>
        <span>Active file: {activeFile}</span>
        <span>Artifacts: {artifactCount}</span>
      </footer>
    </div>
  );
}
