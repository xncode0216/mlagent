import { CheckCircle2, GitMerge, Network, ShieldCheck, XCircle } from "lucide-react";

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
  const rejectedCount = lessons.filter((lesson) => lesson.status === "rejected").length;
  const visibleLessons = lessons.length > 0 ? lessons : [];

  return (
    <main className="agent-workspace evolution-workspace">
      <div className="agent-header workbench-header">
        <div>
          <h2>
            <Network size={18} />
            自进化知识 Agent
          </h2>
          <p>从历史分析和训练任务中抽取经验，审核后注入后续 Agent 的默认上下文和工具策略。</p>
        </div>
        <div className="runtime-chips">
          <span className="runtime-chip ready">内网模式</span>
          <span className="runtime-chip">规则审计</span>
        </div>
      </div>

      <div className="evolution-stats">
        <div>
          <span>待审核</span>
          <strong>{pendingCount}</strong>
        </div>
        <div>
          <span>高置信规则</span>
          <strong>{adoptedCount}</strong>
        </div>
        <div>
          <span>已拒绝</span>
          <strong>{rejectedCount}</strong>
        </div>
        <div>
          <span>总记录</span>
          <strong>{lessons.length}</strong>
        </div>
      </div>

      <div className="evolution-layout">
        <section className="lesson-list">
          <div className="section-header">
            <span className="panel-title">从历史任务提取的经验</span>
            <span className="sidebar-kicker">Review Queue</span>
          </div>
          {visibleLessons.length === 0 ? (
            <div className="empty-state">训练或分析任务完成后，这里会出现可审核的候选经验。</div>
          ) : (
            visibleLessons.map((lesson) => (
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
                    <button onClick={() => void onAdopt(lesson.id)}>
                      <CheckCircle2 size={14} />
                      采纳
                    </button>
                    <button onClick={() => void onReject(lesson.id)}>
                      <XCircle size={14} />
                      拒绝
                    </button>
                  </div>
                ) : null}
              </article>
            ))
          )}
        </section>

        <section className="knowledge-panel">
          <div className="card-heading">
            <ShieldCheck size={15} />
            规则注入预览
          </div>
          <pre className="json-preview code-panel">{`rules:
  - missing_value_median
  - leakage_detection
  - lightgbm_categorical_handle

policy:
  confidence_threshold: 0.85
  require_human_review: true
  inject_into:
    - data_analysis_agent
    - ml_training_agent`}</pre>
          <div className="knowledge-graph-mini">
            <span>数据清洗</span>
            <GitMerge size={16} />
            <span>特征工程</span>
            <GitMerge size={16} />
            <span>模型训练</span>
          </div>
        </section>
      </div>
    </main>
  );
}
