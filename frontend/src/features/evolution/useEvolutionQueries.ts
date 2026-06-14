import { useQuery } from "@tanstack/react-query";

import {
  listEvolutionInjectionLog,
  listLessons,
  type EvolutionInjectionLog,
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
