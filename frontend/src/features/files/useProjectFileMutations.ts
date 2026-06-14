import { useMutation, useQueryClient } from "@tanstack/react-query";

import { createProjectFile, deleteProjectFile, renameProjectFile, uploadProjectFile } from "../../lib/api";
import { filesQueryKeyRoot } from "./useProjectFilesQuery";

/**
 * 文件树写操作（新建 / 重命名 / 删除 / 上传）的 react-query mutation。
 * 每个 mutation 成功后统一 invalidate 该项目的文件树（前缀键命中所有展开变体），
 * 替代各 handler 里手写的刷新；handler 仍负责展开集与 activeFile 等本地态的连带处理。
 */
export function useProjectFileMutations(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const invalidateFiles = () =>
    projectId
      ? queryClient.invalidateQueries({ queryKey: filesQueryKeyRoot(projectId) })
      : Promise.resolve();

  const createFile = useMutation({
    mutationFn: ({ path, type }: { path: string; type: "file" | "directory" }) =>
      createProjectFile(projectId as string, path, type),
    onSuccess: invalidateFiles,
  });

  const renameFile = useMutation({
    mutationFn: ({ path, newPath }: { path: string; newPath: string }) =>
      renameProjectFile(projectId as string, path, newPath),
    onSuccess: invalidateFiles,
  });

  const deleteFile = useMutation({
    mutationFn: (path: string) => deleteProjectFile(projectId as string, path),
    onSuccess: invalidateFiles,
  });

  const uploadFile = useMutation({
    mutationFn: ({ path, file }: { path: string; file: Blob }) =>
      uploadProjectFile(projectId as string, path, file),
    onSuccess: invalidateFiles,
  });

  return { createFile, renameFile, deleteFile, uploadFile };
}
