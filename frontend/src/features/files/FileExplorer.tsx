import {
  Check,
  ChevronRight,
  Database,
  Download,
  FileCode2,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useState } from "react";

import { projectFileDownloadUrl, type AgentSession, type FileItem, type Project } from "../../lib/api";
import { useUiStore } from "../../app/uiStore";
import { buildVisibleTree, getDepth } from "./fileTree";

const fallbackItems: FileItem[] = [
  { name: "customer_churn.csv", path: "data/customer_churn.csv", type: "file" },
  { name: "eda.py", path: "notebooks/eda.py", type: "file" },
  { name: "profile.json", path: "results/profile.json", type: "file" },
  { name: "models", path: "models", type: "directory" },
  { name: "agent_schema", path: "agent_schema", type: "directory" },
  { name: "evolution", path: "evolution", type: "directory" },
];

type FileExplorerProps = {
  currentProjectId?: string;
  expandedFolders: string[];
  files: FileItem[];
  localProjectPath: string;
  newProjectName: string;
  onCreateProject: () => Promise<void>;
  onCreateFile: (path: string, type: "file" | "directory") => Promise<void>;
  onDeleteFile: (path: string) => Promise<void>;
  onLocalProjectPathChange: (value: string) => void;
  onNewProjectNameChange: (value: string) => void;
  onOpenLocalProject: () => Promise<void>;
  onRenameFile: (path: string, newPath: string) => Promise<void>;
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
};

function getFileIcon(item: FileItem) {
  if (item.type === "directory") return <Folder size={14} />;
  if (item.path.endsWith(".csv")) return <Database size={14} />;
  if (item.path.endsWith(".py") || item.path.endsWith(".json")) return <FileCode2 size={14} />;
  return <FileText size={14} />;
}

export function FileExplorer({
  currentProjectId,
  expandedFolders,
  files,
  localProjectPath,
  newProjectName,
  onCreateProject,
  onCreateFile,
  onDeleteFile,
  onLocalProjectPathChange,
  onNewProjectNameChange,
  onOpenLocalProject,
  onRenameFile,
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
}: FileExplorerProps) {
  // 工作区状态串 / 当前文件已迁入 uiStore，直接订阅（替代原先经 AppShell 钻取的 props）。
  const activePath = useUiStore((state) => state.activeFile);
  const workspaceStatus = useUiStore((state) => state.workspaceStatus);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isOpeningProject, setIsOpeningProject] = useState(false);
  const [isCreatingEntry, setIsCreatingEntry] = useState(false);
  const [newEntryPath, setNewEntryPath] = useState("");
  const [newEntryType, setNewEntryType] = useState<"file" | "directory">("file");
  const [renamingPath, setRenamingPath] = useState("");
  const [renameTargetPath, setRenameTargetPath] = useState("");
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

  async function submitEntry() {
    const path = newEntryPath.trim().replaceAll("\\", "/");
    if (!path) return;
    await onCreateFile(path, newEntryType);
    setNewEntryPath("");
    setIsCreatingEntry(false);
  }

  async function submitRename() {
    const nextPath = renameTargetPath.trim().replaceAll("\\", "/");
    if (!renamingPath || !nextPath || nextPath === renamingPath) {
      setRenamingPath("");
      setRenameTargetPath("");
      return;
    }
    await onRenameFile(renamingPath, nextPath);
    setRenamingPath("");
    setRenameTargetPath("");
  }

  async function submitDelete(path: string, type: "file" | "directory") {
    const confirmed = window.confirm(type === "directory" ? `删除文件夹 ${path} 及其内容？` : `删除文件 ${path}？`);
    if (!confirmed) return;
    await onDeleteFile(path);
    if (renamingPath === path) {
      setRenamingPath("");
      setRenameTargetPath("");
    }
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
          <div className="workspace-actions">
            <button
              aria-label="新建文件"
              className="icon-button"
              onClick={() => {
                setNewEntryType("file");
                setIsCreatingEntry(true);
              }}
              title="新建文件"
              type="button"
            >
              <FilePlus2 size={15} />
            </button>
            <button
              aria-label="新建文件夹"
              className="icon-button"
              onClick={() => {
                setNewEntryType("directory");
                setIsCreatingEntry(true);
              }}
              title="新建文件夹"
              type="button"
            >
              <FolderPlus size={15} />
            </button>
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
        </div>
        <div className="sidebar-status">{workspaceStatus}</div>
        {isCreatingEntry ? (
          <div className="new-entry-row">
            <input
              aria-label={newEntryType === "file" ? "新文件路径" : "新文件夹路径"}
              autoFocus
              placeholder={newEntryType === "file" ? "例如 notebooks/eda.py" : "例如 data/raw"}
              value={newEntryPath}
              onChange={(event) => setNewEntryPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submitEntry();
                if (event.key === "Escape") {
                  setNewEntryPath("");
                  setIsCreatingEntry(false);
                }
              }}
            />
            <button
              aria-label={newEntryType === "file" ? "创建文件" : "创建文件夹"}
              className="icon-button"
              disabled={!newEntryPath.trim()}
              onClick={() => void submitEntry()}
              title="创建"
              type="button"
            >
              <Check size={15} />
            </button>
            <button
              aria-label="取消新建"
              className="icon-button"
              onClick={() => {
                setNewEntryPath("");
                setIsCreatingEntry(false);
              }}
              title="取消"
              type="button"
            >
              <X size={15} />
            </button>
          </div>
        ) : null}
        <ul className="file-list">
          {visibleFiles.map((item) => (
            <li key={item.path} className={item.path === activePath ? "selected" : ""}>
              {renamingPath === item.path ? (
                <div className="rename-entry-row" style={{ paddingLeft: `${8 + getDepth(item.path) * 14}px` }}>
                  <input
                    aria-label="重命名路径"
                    autoFocus
                    value={renameTargetPath}
                    onChange={(event) => setRenameTargetPath(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void submitRename();
                      if (event.key === "Escape") {
                        setRenamingPath("");
                        setRenameTargetPath("");
                      }
                    }}
                  />
                  <button
                    aria-label="确认重命名"
                    className="icon-button"
                    disabled={!renameTargetPath.trim()}
                    onClick={() => void submitRename()}
                    title="确认"
                    type="button"
                  >
                    <Check size={15} />
                  </button>
                  <button
                    aria-label="取消重命名"
                    className="icon-button"
                    onClick={() => {
                      setRenamingPath("");
                      setRenameTargetPath("");
                    }}
                    title="取消"
                    type="button"
                  >
                    <X size={15} />
                  </button>
                </div>
              ) : (
                <>
                  <button
                    className={item.type === "directory" ? "folder-row file-row-main" : "file-row-main"}
                    onClick={() => (item.type === "directory" ? onToggleFolder(item.path) : onSelect(item.path))}
                    style={{ paddingLeft: `${8 + getDepth(item.path) * 14}px` }}
                    title={item.path}
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
                  <div className="file-row-actions">
                    {currentProjectId && item.type === "file" ? (
                      <a
                        aria-label={`下载 ${item.path}`}
                        className="icon-button compact"
                        download={item.name}
                        href={projectFileDownloadUrl(currentProjectId, item.path)}
                        title="下载"
                      >
                        <Download size={13} />
                      </a>
                    ) : null}
                    <button
                      aria-label={`重命名 ${item.path}`}
                      className="icon-button compact"
                      onClick={() => {
                        setRenamingPath(item.path);
                        setRenameTargetPath(item.path);
                      }}
                      title="重命名"
                      type="button"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      aria-label={`删除 ${item.path}`}
                      className="icon-button compact danger"
                      onClick={() => void submitDelete(item.path, item.type)}
                      title="删除"
                      type="button"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
