import { Check, Database, FileCode2, FileText, Folder, FolderPlus, Upload, X } from "lucide-react";
import { useState } from "react";

import type { FileItem, Project } from "../../lib/api";

const fallbackItems: FileItem[] = [
  { name: "customer_churn.csv", path: "data/customer_churn.csv", type: "file" },
  { name: "eda.py", path: "notebooks/eda.py", type: "file" },
  { name: "profile.json", path: "results/profile.json", type: "file" },
  { name: "models", path: "models", type: "directory" },
  { name: "agent_schema", path: "agent_schema", type: "directory" },
  { name: "evolution", path: "evolution", type: "directory" },
];

type FileExplorerProps = {
  activePath: string;
  currentProjectId?: string;
  files: FileItem[];
  newProjectName: string;
  onCreateProject: () => Promise<void>;
  onNewProjectNameChange: (value: string) => void;
  onSelect: (path: string) => void;
  onSwitchProject: (projectId: string) => void;
  onUpload: (file: File) => Promise<void>;
  projectName?: string;
  projectPath?: string;
  projects: Project[];
  status: string;
};

function getFileIcon(item: FileItem) {
  if (item.type === "directory") return <Folder size={14} />;
  if (item.path.endsWith(".csv")) return <Database size={14} />;
  if (item.path.endsWith(".py") || item.path.endsWith(".json")) return <FileCode2 size={14} />;
  return <FileText size={14} />;
}

export function FileExplorer({
  activePath,
  currentProjectId,
  files,
  newProjectName,
  onCreateProject,
  onNewProjectNameChange,
  onSelect,
  onSwitchProject,
  onUpload,
  projectName,
  projectPath,
  projects,
  status,
}: FileExplorerProps) {
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const visibleFiles = files.length > 0 ? files : fallbackItems;

  async function submitProject() {
    if (!newProjectName.trim()) return;
    await onCreateProject();
    setIsCreatingProject(false);
  }

  return (
    <div className="file-explorer">
      <section className="workspace-panel" aria-label="项目管理">
        <div className="workspace-header">
          <div>
            <span className="sidebar-kicker">EXPLORER</span>
            <strong>工作区</strong>
          </div>
          <button
            aria-label="新建项目"
            className="icon-button"
            onClick={() => setIsCreatingProject(true)}
            title="新建项目"
            type="button"
          >
            <FolderPlus size={15} />
          </button>
        </div>

        <label className="field-label" htmlFor="project-select">
          当前项目
        </label>
        <select
          className="project-select"
          disabled={projects.length === 0}
          id="project-select"
          value={currentProjectId ?? ""}
          onChange={(event) => onSwitchProject(event.target.value)}
        >
          {projects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>

        {isCreatingProject ? (
          <div className="new-project-row">
            <input
              aria-label="新项目名称"
              autoFocus
              placeholder="新项目名称"
              value={newProjectName}
              onChange={(event) => onNewProjectNameChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submitProject();
                if (event.key === "Escape") {
                  onNewProjectNameChange("");
                  setIsCreatingProject(false);
                }
              }}
            />
            <button
              aria-label="创建项目"
              className="icon-button"
              disabled={!newProjectName.trim()}
              onClick={() => void submitProject()}
              title="创建项目"
              type="button"
            >
              <Check size={15} />
            </button>
            <button
              aria-label="取消新建项目"
              className="icon-button"
              onClick={() => {
                onNewProjectNameChange("");
                setIsCreatingProject(false);
              }}
              title="取消"
              type="button"
            >
              <X size={15} />
            </button>
          </div>
        ) : null}

        <div className="project-meta">
          <span>{projectName ?? "未选择项目"}</span>
          {projectPath ? <code title={projectPath}>{projectPath}</code> : null}
        </div>
      </section>

      <section className="file-section" aria-label="项目文件">
        <div className="section-header">
          <span className="panel-title">项目文件</span>
          <label className="icon-button upload-button" aria-label="上传 CSV" title="上传 CSV">
            <Upload size={15} />
            <input
              accept=".csv,text/csv"
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onUpload(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>
        <div className="sidebar-status">{status}</div>
        <ul className="file-list">
          {visibleFiles.map((item) => (
            <li key={item.path} className={item.path === activePath ? "selected" : ""}>
              <button onClick={() => onSelect(item.path)}>
                <span className="file-icon">{getFileIcon(item)}</span>
                <span>{item.path}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
