import { useQuery, type QueryClient } from "@tanstack/react-query";

import {
  getKnowledgeGraph,
  listEvolutionInjectionLog,
  listLessons,
  type EvolutionInjectionLog,
  type KnowledgeGraphResult,
  type Lesson,
} from "../../lib/api";

/** 课程（lessons）列表的 queryKey 助手，供 invalidate 复用。 */
export function lessonsQueryKey(projectId: string | undefined) {
  return ["evolution", "lessons", projectId] as const;
}

/** 规则注入日志的 queryKey 助手，供 invalidate 复用。 */
export function injectionLogsQueryKey(projectId: string | undefined) {
  return ["evolution", "injectionLog", projectId] as const;
}

/** 知识图谱查询键；规则审核、训练完成等写操作用它显式刷新派生图谱。 */
export function knowledgeGraphQueryKey(projectId: string | undefined) {
  return ["evolution", "graph", projectId] as const;
}

/**
 * 课程列表查询：随 projectId 取数。课程的增改（adopt/reject/conflict/extract）后，
 * 由调用方对 lessonsQueryKey 执行 invalidate 触发重取，替代原先手动的 setLessons。
 */
export function useLessonsQuery(projectId: string | undefined) {
  return useQuery<Lesson[]>({
    queryKey: lessonsQueryKey(projectId),
    queryFn: () => listLessons(projectId as string),
    enabled: Boolean(projectId),
  });
}

/** 规则注入日志查询：随 projectId 取数；与课程同步刷新。 */
export function useInjectionLogsQuery(projectId: string | undefined) {
  return useQuery<EvolutionInjectionLog[]>({
    queryKey: injectionLogsQueryKey(projectId),
    queryFn: () => listEvolutionInjectionLog(projectId as string),
    enabled: Boolean(projectId),
  });
}

/** 知识图谱只在用户打开图谱视图时取数，保留缓存以支持无闪烁后台刷新。 */
export function useKnowledgeGraphQuery(projectId: string | undefined, enabled: boolean) {
  return useQuery<KnowledgeGraphResult>({
    queryKey: knowledgeGraphQueryKey(projectId),
    queryFn: () => getKnowledgeGraph(projectId as string),
    enabled: enabled && Boolean(projectId),
  });
}

/**
 * 经验状态、注入日志与知识图谱是同一份演进知识的不同投影。任何会改变课程或训练
 * 证据的写操作都应同时失效三者，避免用户在图谱中看到已过期关系。
 */
export function invalidateEvolutionKnowledgeQueries(queryClient: QueryClient, projectId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: lessonsQueryKey(projectId) }),
    queryClient.invalidateQueries({ queryKey: injectionLogsQueryKey(projectId) }),
    queryClient.invalidateQueries({ queryKey: knowledgeGraphQueryKey(projectId) }),
  ]);
}
