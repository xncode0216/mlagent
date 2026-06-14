import { useQuery } from "@tanstack/react-query";

import { listFiles, type FileItem } from "../../lib/api";

/**
 * 取项目根目录 + 所有已展开文件夹的条目，按 path 去重合并为扁平列表。
 * 原先内联在 AppShell，移到此处以便 query hook 与命令式 fetchQuery 共用、避免循环依赖。
 */
export async function listExpandedProjectFiles(projectId: string, folders: string[]) {
  const batches = await Promise.all([listFiles(projectId), ...folders.map((folder) => listFiles(projectId, folder))]);
  const byPath = new Map<string, FileItem>();
  for (const batch of batches) {
    for (const item of batch) {
      byPath.set(item.path, item);
    }
  }
  return Array.from(byPath.values());
}

/** 文件树查询键前缀（不含展开集）：写操作后用它 invalidate，前缀匹配命中所有展开变体。 */
export function filesQueryKeyRoot(projectId: string | undefined) {
  return ["files", projectId] as const;
}

/**
 * 文件树完整查询键：含已展开文件夹集合（排序后稳定，与插入顺序无关）。供 hook、
 * setQueryData、fetchQuery 同键复用。文件树内容依赖展开集，故把它放进 key——展开/折叠
 * 改变 key 即自动重取正确的集合，避免「闭包/ref 滞后导致漏取新展开文件夹」的竞态。
 */
export function filesQueryKey(projectId: string | undefined, folders: string[]) {
  return [...filesQueryKeyRoot(projectId), [...folders].sort()] as const;
}

/** 文件树查询：随 projectId 与已展开文件夹集合取数。写操作后由调用方 invalidate 触发重取。 */
export function useProjectFilesQuery(projectId: string | undefined, expandedFolders: string[]) {
  return useQuery<FileItem[]>({
    queryKey: filesQueryKey(projectId, expandedFolders),
    queryFn: () => listExpandedProjectFiles(projectId as string, expandedFolders),
    enabled: Boolean(projectId),
  });
}
