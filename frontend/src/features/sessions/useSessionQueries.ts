import { useQuery } from "@tanstack/react-query";

import {
  listProjectSessions,
  listSessionEvents,
  listSessionMessages,
  listSessionTaskStates,
  type AgentMessage,
  type AgentSession,
  type DurableTaskState,
} from "../../lib/api";

/** 某项目下会话列表的 queryKey 助手，供 invalidate / setQueryData / fetchQuery 复用。 */
export function sessionsQueryKey(projectId: string | undefined) {
  return ["sessions", "list", projectId] as const;
}

/** 某会话历史消息的 queryKey 助手，供 invalidate 复用。 */
export function sessionMessagesQueryKey(sessionId: string | undefined) {
  return ["sessions", "messages", sessionId] as const;
}

/** 某会话持久化事件的 queryKey 助手。 */
export function sessionEventsQueryKey(sessionId: string | undefined) {
  return ["sessions", "events", sessionId] as const;
}

/** 某会话可恢复任务态（task-states）的 queryKey 助手，供 invalidate 复用。 */
export function sessionTaskStatesQueryKey(sessionId: string | undefined) {
  return ["sessions", "taskStates", sessionId] as const;
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

/**
 * 会话历史消息查询：随 activeSession.id 取数。无活动会话时 disabled → data undefined
 * → 调用方 ?? [] 自然清空，替代原先 loadSessionMessages effect 的 setSessionMessages。
 * task_progress 推进后由调用方 invalidate sessionMessagesQueryKey 触发重取。
 */
export function useSessionMessagesQuery(sessionId: string | undefined) {
  return useQuery<AgentMessage[]>({
    queryKey: sessionMessagesQueryKey(sessionId),
    queryFn: () => listSessionMessages(sessionId as string),
    enabled: Boolean(sessionId),
  });
}

/**
 * 会话持久化事件查询：随 activeSession.id 取数，返回原始 unknown[]，由调用方用
 * isAgentStreamEvent 过滤后并入 visibleEvents。
 */
export function useSessionEventsQuery(sessionId: string | undefined) {
  return useQuery<unknown[]>({
    queryKey: sessionEventsQueryKey(sessionId),
    queryFn: () => listSessionEvents(sessionId as string),
    enabled: Boolean(sessionId),
  });
}

/**
 * 会话可恢复任务态查询：随 activeSession.id 取数。调用方用 taskStateSnapshot 从同一份
 * data 派生 durableTaskStates 与 taskStateEvents（替代原先 applyDurableTaskStates 的两份
 * setState）。放弃/检视/推进等操作后由调用方 invalidate sessionTaskStatesQueryKey 触发重取。
 */
export function useSessionTaskStatesQuery(sessionId: string | undefined) {
  return useQuery<DurableTaskState[]>({
    queryKey: sessionTaskStatesQueryKey(sessionId),
    queryFn: () => listSessionTaskStates(sessionId as string),
    enabled: Boolean(sessionId),
  });
}
