import type { Lesson } from "../../lib/api";

type EvolutionWorkspaceProps = {
  lessons: Lesson[];
  onAdopt: (lessonId: string) => Promise<void>;
  onReject: (lessonId: string) => Promise<void>;
};

const statusLabel: Record<Lesson["status"], string> = {
  pending_review: "待审核",
  high_confidence: "已采纳",
  rejected: "已拒绝",
};

export function EvolutionWorkspace({ lessons, onAdopt, onReject }: EvolutionWorkspaceProps) {
  const pendingCount = lessons.filter((lesson) => lesson.status === "pending_review").length;
  const adoptedCount = lessons.filter((lesson) => lesson.status === "high_confidence").length;

  return (
    <main className="agent-workspace evolution-workspace">
      <div className="agent-header">
        <div>
          <h2>自进化知识</h2>
          <p>从分析和训练任务中沉淀经验，审核后注入后续 Agent 上下文。</p>
        </div>
      </div>
      <div className="evolution-stats">
        <div>
          <span>候选经验</span>
          <strong>{pendingCount}</strong>
        </div>
        <div>
          <span>高置信规则</span>
          <strong>{adoptedCount}</strong>
        </div>
        <div>
          <span>总记录</span>
          <strong>{lessons.length}</strong>
        </div>
      </div>
      <div className="lesson-list">
        {lessons.length === 0 ? (
          <div className="empty-state">训练或分析任务完成后，这里会出现可审核的候选经验。</div>
        ) : (
          lessons.map((lesson) => (
            <article className="lesson-card" key={lesson.id}>
              <div className="lesson-card-header">
                <span>{statusLabel[lesson.status]}</span>
                <strong>{Math.round(lesson.confidence * 100)}%</strong>
              </div>
              <p>{lesson.observation}</p>
              <h3>{lesson.recommendation}</h3>
              <div className="lesson-tags">
                {lesson.domain.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              {lesson.status === "pending_review" ? (
                <div className="lesson-actions">
                  <button onClick={() => void onAdopt(lesson.id)}>采纳</button>
                  <button onClick={() => void onReject(lesson.id)}>拒绝</button>
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>
    </main>
  );
}
