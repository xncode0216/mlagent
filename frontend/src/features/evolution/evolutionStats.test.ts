import { describe, expect, it } from "vitest";

import type { Lesson } from "../../lib/api";
import { summarizeLessonStatuses } from "./evolutionStats";

let lessonIndex = 0;

function lesson(status: Lesson["status"]): Lesson {
  lessonIndex += 1;
  return {
    id: `lesson-${status}-${lessonIndex}`,
    source_type: "test",
    source_id: "session-1",
    domain: ["test"],
    observation: "observation",
    recommendation: "recommendation",
    confidence: 0.8,
    status,
    evidence: {},
    created_at: "2026-05-22T00:00:00Z",
    updated_at: "2026-05-22T00:00:00Z",
  };
}

describe("summarizeLessonStatuses", () => {
  it("counts each review status under the matching label", () => {
    const summary = summarizeLessonStatuses([
      lesson("pending_review"),
      lesson("pending_review"),
      lesson("high_confidence"),
      lesson("conflicted"),
      lesson("rejected"),
      lesson("rejected"),
    ]);

    expect(summary.pending).toBe(2);
    expect(summary.highConfidence).toBe(1);
    expect(summary.conflicted).toBe(1);
    expect(summary.rejected).toBe(2);
  });
});
