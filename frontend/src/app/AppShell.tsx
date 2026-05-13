import { useEffect, useMemo, useState } from "react";

import { AgentWorkspace } from "../features/chat/AgentWorkspace";
import { useAgentStream } from "../features/chat/useAgentStream";
import { FileExplorer } from "../features/files/FileExplorer";
import { RightPanel } from "../features/right-panel/RightPanel";
import {
  createProject,
  listFiles,
  listProjects,
  trainBaselineModel,
  uploadProjectFile,
  type FileItem,
  type Project,
  type TrainingResult,
} from "../lib/api";

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
  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [activeFile, setActiveFile] = useState("data/customer_churn.csv");
  const [workspaceStatus, setWorkspaceStatus] = useState("正在连接后端项目服务...");
  const [trainingResult, setTrainingResult] = useState<TrainingResult | null>(null);
  const [trainingError, setTrainingError] = useState<string | null>(null);

  const artifactCount = useMemo(
    () => events.filter((event) => event.type === "artifact_created").length,
    [events],
  );

  useEffect(() => {
    let cancelled = false;

    async function bootstrapProject() {
      try {
        let projects = await listProjects();
        let current = projects[0];
        if (!current) {
          current = await createProject("sales_churn_analysis");
        }

        let projectFiles = await listWorkbenchFiles(current.id);
        if (!projectFiles.some((item) => item.path === "data/customer_churn.csv")) {
          await uploadProjectFile(current.id, "data/customer_churn.csv", sampleCsv);
          projectFiles = await listWorkbenchFiles(current.id);
        }

        if (!cancelled) {
          setProject(current);
          setFiles(projectFiles);
          setWorkspaceStatus("项目文件已同步");
        }
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

  async function handleUpload(file: File) {
    if (!project) return;
    const targetPath = `data/${file.name}`;
    await uploadProjectFile(project.id, targetPath, file);
    setFiles(await listWorkbenchFiles(project.id));
    setActiveFile(targetPath);
  }

  async function handleTrainBaseline(targetColumn: string) {
    if (!project) return;
    setTrainingError(null);
    try {
      const result = await trainBaselineModel(project.id, activeFile, targetColumn, "manual-training");
      setTrainingResult(result);
      setFiles(await listWorkbenchFiles(project.id));
    } catch (error) {
      setTrainingError(error instanceof Error ? error.message : "训练任务失败");
    }
  }

  return (
    <div className="app-shell">
      <header className="top-nav">
        <div className="brand">MLAgent</div>
        <nav className="mode-tabs" aria-label="主功能">
          <button className="active">数据分析</button>
          <button>机器学习</button>
          <button>自进化知识</button>
        </nav>
        <div className="model-selector">Claude / DeepSeek / Local vLLM</div>
      </header>
      <aside className="file-sidebar">
        <FileExplorer
          activePath={activeFile}
          files={files}
          onSelect={setActiveFile}
          onUpload={handleUpload}
          status={workspaceStatus}
        />
      </aside>
      <AgentWorkspace
        activeFile={activeFile}
        connected={connected}
        events={events}
        lastError={lastError}
        projectId={project?.id}
        sendMessage={sendMessage}
      />
      <RightPanel
        activeFile={activeFile}
        events={events}
        projectId={project?.id}
        trainingError={trainingError}
        trainingResult={trainingResult}
        onTrainBaseline={handleTrainBaseline}
      />
      <footer className="status-bar">
        <span>{connected ? "WebSocket Connected" : "WebSocket Disconnected"}</span>
        <span>Active file: {activeFile}</span>
        <span>Artifacts: {artifactCount}</span>
      </footer>
    </div>
  );
}
