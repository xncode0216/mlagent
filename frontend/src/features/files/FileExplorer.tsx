import {
  Check,
  ChevronRight,
  Database,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Upload,
  X,
} from "lucide-react";
import { useState } from "react";

import type { AgentSession, FileItem, Project } from "../../lib/api";

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
  expandedFolders: string[];
  files: FileItem[];
  localProjectPath: string;
  newProjectName: string;
  onCreateProject: () => Promise<void>;
  onLocalProjectPathChange: (value: string) => void;
  onNewProjectNameChange: (value: string) => void;
  onOpenLocalProject: () => Promise<void>;
  onSelect: (path: string) => void;
  onSwitchProject: (projectId: string) => void;
  onToggleFolder: (path: string) => void;
  onUpload: (file: File) => Promise<void>;
  onSelectSession: (sessionId: string) => void;
  projectName?: string;
  projectPath?: string;
  projects: Project[];
  sessions: AgentSession[];
  activeSessionId?: string;
  status: string;
};

function getFileIcon(item: FileItem) {
  if (item.type === "directory") return <Folder size={14} />;
  if (item.path.endsWith(".csv")) return <Database size={14} />;
  if (item.path.endsWith(".py") || item.path.endsWith(".json")) return <FileCode2 size={14} />;
  return <FileText size={14} />;
}

function getParentPath(path: string) {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

function getDepth(path: string) {
  return Math.max(0, path.split("/").length - 1);
}

function isVisiblePath(path: string, expandedFolders: string[]) {
  const parent = getParentPath(path);
  if (!parent) return true;
  const parts = parent.split("/");
  return parts.every((_, index) => expandedFolders.includes(parts.slice(0, index + 1).join("/")));
}

function buildVisibleTree(items: FileItem[], expandedFolders: string[]) {
  return items
    .filter((item) => item.path !== "sessions")
    .filter((item) => isVisiblePath(item.path, expandedFolders))
    .sort((a, b) => {
      const parentCompare = getParentPath(a.path).localeCompare(getParentPath(b.path));
      if (parentCompare !== 0) return parentCompare;
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export function FileExplorer({
  activePath,
  currentProjectId,
  expandedFolders,
  files,
  localProjectPath,
  newProjectName,
  onCreateProject,
  onLocalProjectPathChange,
  onNewProjectNameChange,
  onOpenLocalProject,
  onSelect,
  onSwitchProject,
  onToggleFolder,
  onUpload,
  onSelectSession,
  projectName,
  projectPath,
  projects,
  sessions,
  activeSessionId,
  status,
}: FileExplorerProps) {
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isOpeningProject, setIsOpeningProject] = useState(false);
  const visibleFiles = buildVisibleTree(files.length > 0 ? files : fallbackItems, expandedFolders);

  async function submitProject() {
    if (!newProjectName.trim()) return;
    await onCreateProject();
    setIsCreatingProject(false);
  }

  async function submitLocalProject() {
    if (!localProjectPath.trim()) return;
    await onOpenLocalProject();
    setIsOpeningProject(false);
  }

  return (
    <div className="file-explorer">
      <section className="workspace-panel" aria-label="项目管理">
        <div className="workspace-header">
          <div>
            <span className="sidebar-kicker">EXPLORER</span>
            <strong>工作区</strong>
          </div>
          <div className="workspace-actions">
            <button
              aria-label="新建项目"
              className="icon-button"
              onClick={() => {
                setIsOpeningProject(false);
                setIsCreatingProject(true);
              }}
              title="新建项目"
              type="button"
            >
              <FolderPlus size={15} />
            </button>
            <button
              aria-label="打开本地项目"
              className="icon-button"
              onClick={() => {
                setIsCreatingProject(false);
                setIsOpeningProject(true);
              }}
              title="打开本地项目"
              type="button"
            >
              <FolderOpen size={15} />
            </button>
          </div>
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

        {isOpeningProject ? (
          <div className="open-project-row">
            <input
              aria-label="本地项目路径"
              autoFocus
              placeholder="例如 C:\\Projects\\sales_churn_analysis"
              value={localProjectPath}
              onChange={(event) => onLocalProjectPathChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submitLocalProject();
                if (event.key === "Escape") {
                  onLocalProjectPathChange("");
                  setIsOpeningProject(false);
                }
              }}
            />
            <button
              aria-label="打开本地项目"
              className="icon-button"
              disabled={!localProjectPath.trim()}
              onClick={() => void submitLocalProject()}
              title="打开"
              type="button"
            >
              <Check size={15} />
            </button>
            <button
              aria-label="取消打开本地项目"
              className="icon-button"
              onClick={() => {
                onLocalProjectPathChange("");
                setIsOpeningProject(false);
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

      <section className="session-section" aria-label="会话记录">
        <div className="section-header">
          <span className="panel-title">会话记录</span>
          <span className="sidebar-kicker">{sessions.length}</span>
        </div>
        {sessions.length === 0 ? (
          <div className="sidebar-status">当前项目还没有会话记录。</div>
        ) : (
          <ul className="session-list">
            {sessions.slice(0, 6).map((session) => (
              <li key={session.id} className={session.id === activeSessionId ? "selected" : ""}>
                <button onClick={() => onSelectSession(session.id)}>
                  <span>{session.title}</span>
                  <small>{session.message_count} 条消息</small>
                </button>
              </li>
            ))}
          </ul>
        )}
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
              <button
                className={item.type === "directory" ? "folder-row" : ""}
                onClick={() => (item.type === "directory" ? onToggleFolder(item.path) : onSelect(item.path))}
                style={{ paddingLeft: `${8 + getDepth(item.path) * 14}px` }}
                type="button"
              >
                {item.type === "directory" ? (
                  <ChevronRight
                    className={expandedFolders.includes(item.path) ? "tree-chevron expanded" : "tree-chevron"}
                    size={13}
                  />
                ) : (
                  <span className="tree-spacer" />
                )}
                <span className="file-icon">{getFileIcon(item)}</span>
                <span>{item.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
