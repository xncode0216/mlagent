import { useQuery } from "@tanstack/react-query";

import { listProjectSessions, type AgentSession } from "../../lib/api";

/** 某项目下会话列表的 queryKey 助手，供 invalidate / setQueryData / fetchQuery 复用。 */
export function sessionsQueryKey(projectId: string | undefined) {
  return ["sessions", "list", projectId] as const;
}

/**
 * 项目会话列表查询：随 projectId 取数。会话的创建（ensureModeSession）或推进
 * （task_progress 刷新）由调用方对 sessionsQueryKey 执行 setQueryData / invalidate
 * 触发更新，替代原先手动的 setSessions。命令式首读用 queryClient.fetchQuery（与本 hook
 * 同键去重），避免「空列表覆盖刚创建会话」的竞态。
 */
export function useSessionsQuery(projectId: string | undefined) {
  return useQuery<AgentSession[]>({
    queryKey: sessionsQueryKey(projectId),
    queryFn: () => listProjectSessions(projectId as string),
    enabled: Boolean(projectId),
  });
}
