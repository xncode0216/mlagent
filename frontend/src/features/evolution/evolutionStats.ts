import type { Lesson } from "../../lib/api";

export type LessonStatusSummary = {
  pending: number;
  highConfidence: number;
  conflicted: number;
  rejected: number;
};

export function summarizeLessonStatuses(lessons: Lesson[]): LessonStatusSummary {
  return lessons.reduce<LessonStatusSummary>(
    (summary, lesson) => {
      if (lesson.status === "pending_review") summary.pending += 1;
      if (lesson.status === "high_confidence") summary.highConfidence += 1;
      if (lesson.status === "conflicted") summary.conflicted += 1;
      if (lesson.status === "rejected") summary.rejected += 1;
      return summary;
    },
    {
      pending: 0,
      highConfidence: 0,
      conflicted: 0,
      rejected: 0,
    },
  );
}
