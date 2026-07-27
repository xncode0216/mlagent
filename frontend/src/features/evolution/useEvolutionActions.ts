import type { Dispatch, SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { AgentStreamEvent } from "../chat/types";
import { useUiStore } from "../../app/uiStore";
import {
  adoptLesson,
  extractLessonsFromSession,
  markLessonConflict,
  rejectLesson,
  resumeLessonExtraction,
  type AgentSession,
  type Project,
} from "../../lib/api";
import { invalidateEvolutionKnowledgeQueries } from "./useEvolutionQueries";
import { sessionTaskStatesQueryKey } from "../sessions/useSessionQueries";

interface EvolutionActionsParams {
  project: Project | null;
  activeSession: AgentSession | null;
  setLocalEvents: Dispatch<SetStateAction<AgentStreamEvent[]>>;
}

interface EvolutionActions {
  handleExtractLessonsFromSession: (sourceSessionId?: string) => Promise<void>;
  handleRetryLearningExtraction: () => Promise<void>;
  handleAdoptLesson: (lessonId: string) => Promise<void>;
  handleRejectLesson: (lessonId: string) => Promise<void>;
  handleMarkLessonConflict: (lessonId: string, reason: string) => Promise<void>;
}

/**
 * 进化域操作 hook：封装规则提取/重试/采用/拒绝/冲突标记等命令式 handler，
 * 内部直接访问 queryClient 和 uiStore，消除 AppShell 的 props drilling。
 */
export function useEvolutionActions({
  project,
  activeSession,
  setLocalEvents,
}: EvolutionActionsParams): EvolutionActions {
  const queryClient = useQueryClient();
  const setActiveMode = useUiStore((s) => s.setActiveMode);
  const setActiveActivity = useUiStore((s) => s.setActiveActivity);

  // 局部辅助：同步刷新课程、注入日志与由它们派生的知识图谱。
  function invalidateEvolutionLists(projectId: string) {
    return invalidateEvolutionKnowledgeQueries(queryClient, projectId);
  }

  // 局部辅助：使任务态缓存失效，触发重取。
  function invalidateSessionTaskStates(sessionId: string | undefined) {
    if (!sessionId) return Promise.resolve();
    return queryClient.invalidateQueries({ queryKey: sessionTaskStatesQueryKey(sessionId) });
  }

  // 局部辅助：学习提取完成后统一更新缓存、跳转页面、追加 localEvents。
  async function applyLearnedLessons(
    items: Awaited<ReturnType<typeof extractLessonsFromSession>>,
    sessionId: string,
    label: string,
  ) {
    if (!project) return;
    await invalidateEvolutionLists(project.id);
    await invalidateSessionTaskStates(sessionId);
    setActiveMode("evolution");
    setActiveActivity("knowledge");
    setLocalEvents((current) => [
      ...current,
      ...items.map(
        (lesson): AgentStreamEvent => ({
          type: "lesson_extracted",
          lesson_id: lesson.id,
          confidence: lesson.confidence,
        }),
      ),
      {
        type: "stage_completed",
        task_id: sessionId,
        stage: "learn",
        label,
        completed_at: new Date().toISOString(),
      },
    ]);
  }

  async function handleExtractLessonsFromSession(sourceSessionId?: string) {
    if (!project) return;
    const sessionId = sourceSessionId ?? activeSession?.id;
    if (!sessionId) return;
    setLocalEvents((current) => [
      ...current,
      {
        type: "stage_started",
        task_id: sessionId,
        stage: "learn",
        label: "Extracting learned rules",
        started_at: new Date().toISOString(),
      },
    ]);
    try {
      const items = await extractLessonsFromSession(project.id, sessionId);
      await applyLearnedLessons(items, sessionId, "Learned rule extraction completed");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Lesson extraction failed";
      await invalidateSessionTaskStates(sessionId);
      setLocalEvents((current) => [
        ...current,
        {
          type: "step_failed",
          task_id: sessionId,
          stage: "learn",
          label: "Lesson extraction failed",
          error: errorMessage,
          retryable: true,
          resume_stage: "learn",
        },
      ]);
      throw error;
    }
  }

  async function handleRetryLearningExtraction() {
    if (!project || !activeSession) return;
    const sessionId = activeSession.id;
    setLocalEvents((current) => [
      ...current,
      {
        type: "task_resumed",
        task_id: sessionId,
        stage: "learn",
        label: "Retrying learned rule extraction",
      },
    ]);
    try {
      const items = await resumeLessonExtraction(project.id, sessionId);
      await applyLearnedLessons(items, sessionId, "Learned rule extraction completed after retry");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Lesson extraction retry failed";
      await invalidateSessionTaskStates(sessionId);
      setLocalEvents((current) => [
        ...current,
        {
          type: "step_failed",
          task_id: sessionId,
          stage: "learn",
          label: "Lesson extraction retry failed",
          error: errorMessage,
          retryable: true,
          resume_stage: "learn",
        },
      ]);
      throw error;
    }
  }

  async function handleAdoptLesson(lessonId: string) {
    if (!project) return;
    await adoptLesson(project.id, lessonId);
    await invalidateEvolutionLists(project.id);
  }

  async function handleRejectLesson(lessonId: string) {
    if (!project) return;
    await rejectLesson(project.id, lessonId);
    await invalidateEvolutionLists(project.id);
  }

  async function handleMarkLessonConflict(lessonId: string, reason: string) {
    if (!project) return;
    await markLessonConflict(project.id, lessonId, reason);
    await invalidateEvolutionLists(project.id);
  }

  return {
    handleExtractLessonsFromSession,
    handleRetryLearningExtraction,
    handleAdoptLesson,
    handleRejectLesson,
    handleMarkLessonConflict,
  };
}
