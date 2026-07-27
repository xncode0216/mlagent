import { useQueryClient } from "@tanstack/react-query";

import { useUiStore } from "../../app/uiStore";
import { listExpandedProjectFiles, filesQueryKey } from "./useProjectFilesQuery";
import type { ProjectFileMutations } from "./useProjectFileMutations";

// 工具函数：取路径的父目录。
function parentPath(path: string) {
  return path.split("/").slice(0, -1).join("/");
}

// 工具函数：取路径所有层级的祖先目录。
function parentFolders(path: string) {
  const parent = parentPath(path);
  if (!parent) return [];
  const parts = parent.split("/");
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

// 工具函数：判断路径是否为数据集文件（非预处理计划）。
function isLikelyDatasetPath(path: string) {
  return /\.(csv|tsv|jsonl|parquet)$/i.test(path) && !path.includes("preprocessing_plan");
}

interface FileActionsParams {
  projectId: string | undefined;
  /** 来自 useProjectFileMutations 的四个 mutation。 */
  mutations: ProjectFileMutations;
}

interface FileActions {
  handleUpload: (file: File) => Promise<void>;
  handleCreateFile: (path: string, type: "file" | "directory") => Promise<void>;
  handleRenameFile: (path: string, newPath: string) => Promise<void>;
  handleDeleteFile: (path: string) => Promise<void>;
  handleToggleFolder: (path: string) => void;
  handleSelectProjectFile: (path: string) => void;
  handleSelectExperimentRun: (experimentId: string) => void;
}

/**
 * 文件域操作 hook：封装上传/创建/重命名/删除/折叠目录/选中文件等命令式 handler，
 * 内部直接访问 queryClient 和 uiStore，消除 AppShell 的 props drilling。
 */
export function useFileActions({ projectId, mutations }: FileActionsParams): FileActions {
  const queryClient = useQueryClient();
  const { createFile, renameFile, deleteFile, uploadFile } = mutations;

  // uiStore — 文件选择与训练上下文
  const activeFile = useUiStore((s) => s.activeFile);
  const setActiveFile = useUiStore((s) => s.setActiveFile);
  const setTrainingDatasetPath = useUiStore((s) => s.setTrainingDatasetPath);
  const trainingDatasetPath = useUiStore((s) => s.trainingDatasetPath);
  const setSelectedPreprocessingPlanPath = useUiStore((s) => s.setSelectedPreprocessingPlanPath);
  const selectedPreprocessingPlanPath = useUiStore((s) => s.selectedPreprocessingPlanPath);
  // uiStore — 展开目录
  const expandedFolders = useUiStore((s) => s.expandedFolders);
  const setExpandedFolders = useUiStore((s) => s.setExpandedFolders);
  // uiStore — 导航
  const setActiveActivity = useUiStore((s) => s.setActiveActivity);
  const setActiveMode = useUiStore((s) => s.setActiveMode);
  const setFocusedExperimentId = useUiStore((s) => s.setFocusedExperimentId);

  async function handleUpload(file: File) {
    if (!projectId) return;
    const targetPath = `data/${file.name}`;
    await uploadFile.mutateAsync({ path: targetPath, file });
    setExpandedFolders((current) =>
      current.includes("data") ? current : [...current, "data"],
    );
    setActiveFile(targetPath);
    setTrainingDatasetPath(targetPath);
  }

  async function handleCreateFile(path: string, type: "file" | "directory") {
    if (!projectId) return;
    await createFile.mutateAsync({ path, type });
    // 展开包含文件夹让新条目可见；createFile.onSuccess 已 invalidate 文件树。
    const containingFolder = parentPath(path);
    if (containingFolder) {
      setExpandedFolders((current) =>
        current.includes(containingFolder) ? current : [...current, containingFolder],
      );
    }
    if (type === "file") {
      setActiveFile(path);
      if (isLikelyDatasetPath(path)) {
        setTrainingDatasetPath(path);
      }
    }
  }

  async function handleRenameFile(path: string, newPath: string) {
    if (!projectId || path === newPath) return;
    await renameFile.mutateAsync({ path, newPath });
    const nextExpandedFolders = Array.from(
      new Set(
        [
          ...expandedFolders.map((folder) =>
            folder === path || folder.startsWith(`${path}/`)
              ? folder.replace(path, newPath)
              : folder,
          ),
          parentPath(path),
          parentPath(newPath),
        ].filter(Boolean),
      ),
    );
    // renameFile.onSuccess 已 invalidate 文件树；setExpandedFolders 改 key 亦会自动重取。
    setExpandedFolders(nextExpandedFolders);
    if (activeFile === path || activeFile.startsWith(`${path}/`)) {
      setActiveFile(activeFile.replace(path, newPath));
    }
    if (trainingDatasetPath === path || trainingDatasetPath.startsWith(`${path}/`)) {
      setTrainingDatasetPath(trainingDatasetPath.replace(path, newPath));
    }
    if (
      selectedPreprocessingPlanPath &&
      (selectedPreprocessingPlanPath === path ||
        selectedPreprocessingPlanPath.startsWith(`${path}/`))
    ) {
      setSelectedPreprocessingPlanPath(selectedPreprocessingPlanPath.replace(path, newPath));
    }
  }

  async function handleDeleteFile(path: string) {
    if (!projectId) return;
    await deleteFile.mutateAsync(path);
    const nextExpandedFolders = Array.from(
      new Set(
        [
          ...expandedFolders.filter(
            (folder) => folder !== path && !folder.startsWith(`${path}/`),
          ),
          parentPath(path),
        ].filter(Boolean),
      ),
    );
    // 删除后需新列表来挑回退的 activeFile/dataset，故直接取数；同时 setQueryData 预置缓存。
    const nextFiles = await listExpandedProjectFiles(projectId, nextExpandedFolders);
    queryClient.setQueryData(filesQueryKey(projectId, nextExpandedFolders), nextFiles);
    setExpandedFolders(nextExpandedFolders);
    if (activeFile === path || activeFile.startsWith(`${path}/`)) {
      setActiveFile(nextFiles.find((item) => item.type === "file")?.path ?? "");
    }
    if (trainingDatasetPath === path || trainingDatasetPath.startsWith(`${path}/`)) {
      setTrainingDatasetPath(
        nextFiles.find((item) => item.type === "file" && isLikelyDatasetPath(item.path))?.path ?? "",
      );
    }
    if (
      selectedPreprocessingPlanPath &&
      (selectedPreprocessingPlanPath === path ||
        selectedPreprocessingPlanPath.startsWith(`${path}/`))
    ) {
      setSelectedPreprocessingPlanPath(null);
    }
  }

  function handleToggleFolder(path: string) {
    if (!projectId) return;
    // 键变化即自动重取对应集合，替代原先的本地 prune / 增量 merge。
    if (expandedFolders.includes(path)) {
      setExpandedFolders((current) =>
        current.filter((item) => item !== path && !item.startsWith(`${path}/`)),
      );
      return;
    }
    setExpandedFolders((current) =>
      current.includes(path) ? current : [...current, path],
    );
  }

  function handleSelectProjectFile(path: string) {
    setActiveActivity("explorer");
    setExpandedFolders((current) =>
      Array.from(new Set([...current, ...parentFolders(path)])),
    );
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

  return {
    handleUpload,
    handleCreateFile,
    handleRenameFile,
    handleDeleteFile,
    handleToggleFolder,
    handleSelectProjectFile,
    handleSelectExperimentRun,
  };
}
