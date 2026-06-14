import { useQuery } from "@tanstack/react-query";

import { listProjects, type Project } from "../../lib/api";

/** 项目列表的 queryKey 助手，供 invalidate / setQueryData / fetchQuery 复用。 */
export function projectsQueryKey() {
  return ["projects"] as const;
}

/**
 * 项目列表查询（全局，不带 projectId）。bootstrap / 新建项目 / 打开本地项目等命令式
 * 路径在拿到最新列表后用 setQueryData 写回，替代原先手动的 setProjects；bootstrap 的首读
 * 改用 queryClient.fetchQuery（与本 hook 同键去重，避免「空列表覆盖刚创建项」的竞态）。
 */
export function useProjectsQuery() {
  return useQuery<Project[]>({
    queryKey: projectsQueryKey(),
    queryFn: () => listProjects(),
  });
}
