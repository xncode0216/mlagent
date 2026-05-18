import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  GitMerge,
  Network,
  ShieldCheck,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";

import type { EvolutionProtocol, Lesson, LessonStatus } from "../../lib/api";

type EvolutionWorkspaceProps = {
  lessons: Lesson[];
  protocols: EvolutionProtocol[];
  onAdopt: (lessonId: string) => Promise<void>;
  onReject: (lessonId: string) => Promise<void>;
  onMarkConflict: (lessonId: string, reason: string) => Promise<void>;
};

const statusLabel: Record<LessonStatus, string> = {
  pending_review: "待审核",
  high_confidence: "已采纳",
  rejected: "已拒绝",
  conflicted: "冲突",
};

const statusFilters: Array<LessonStatus | "all"> = [
  "all",
  "pending_review",
  "high_confidence",
  "conflicted",
  "rejected",
];

function filterLabel(status: LessonStatus | "all") {
  return status === "all" ? "全部" : statusLabel[status];
}

export function EvolutionWorkspace({
  lessons,
  protocols,
  onAdopt,
  onReject,
  onMarkConflict,
}: EvolutionWorkspaceProps) {
  const [statusFilter, setStatusFilter] = useState<LessonStatus | "all">("all");
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(lessons[0]?.id ?? null);

  const visibleLessons = useMemo(
    () => (statusFilter === "all" ? lessons : lessons.filter((lesson) => lesson.status === statusFilter)),
    [lessons, statusFilter],
  );
  const selectedLesson = lessons.find((lesson) => lesson.id === selectedLessonId) ?? visibleLessons[0] ?? null;
  const pendingCount = lessons.filter((lesson) => lesson.status === "pending_review").length;
  const adoptedCount = lessons.filter((lesson) => lesson.status === "high_confidence").length;
  const rejectedCount = lessons.filter((lesson) => lesson.status === "rejected").length;
  const conflictCount = lessons.filter((lesson) => lesson.status === "conflicted").length;

  useEffect(() => {
    if (selectedLessonId && lessons.some((lesson) => lesson.id === selectedLessonId)) return;
    setSelectedLessonId(visibleLessons[0]?.id ?? lessons[0]?.id ?? null);
  }, [lessons, selectedLessonId, visibleLessons]);

  return (
    <main className="agent-workspace evolution-workspace">
      <div className="agent-header workbench-header">
        <div>
          <h2>
            <Network size={18} />
            自进化知识 Agent
          </h2>
          <p>从历史分析和训练任务中抽取经验，审核后转成后续 Agent 可注入的项目级规则。</p>
        </div>
        <div className="runtime-chips">
          <span className="runtime-chip ready">内网模式</span>
          <span className="runtime-chip">规则审计</span>
          <span className="runtime-chip">Skills: {protocols.length}</span>
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
          <span>冲突</span>
          <strong>{conflictCount}</strong>
        </div>
        <div>
          <span>已拒绝</span>
          <strong>{rejectedCount}</strong>
        </div>
      </div>

      <div className="evolution-layout">
        <section className="lesson-list">
          <div className="section-header">
            <span className="panel-title">从历史任务提取的经验</span>
            <span className="sidebar-kicker">Review Queue</span>
          </div>
          <div className="lesson-filter-bar">
            {statusFilters.map((status) => (
              <button
                className={statusFilter === status ? "active" : ""}
                key={status}
                onClick={() => setStatusFilter(status)}
                type="button"
              >
                {filterLabel(status)}
              </button>
            ))}
          </div>

          {visibleLessons.length === 0 ? (
            <div className="empty-state">当前筛选下没有候选经验。完成分析或训练任务后，这里会出现可审核的规则。</div>
          ) : (
            visibleLessons.map((lesson) => (
              <article
                className={selectedLesson?.id === lesson.id ? "lesson-card selected" : "lesson-card"}
                key={lesson.id}
              >
                <button className="lesson-select" onClick={() => setSelectedLessonId(lesson.id)} type="button">
                  <div className="lesson-card-header">
                    <span>{statusLabel[lesson.status]}</span>
                    <strong>{Math.round(lesson.confidence * 100)}%</strong>
                  </div>
                  <h3>{lesson.title || lesson.recommendation}</h3>
                  <p>{lesson.observation}</p>
                  <div className="lesson-tags">
                    {lesson.domain.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                </button>
              </article>
            ))
          )}
        </section>

        <section className="knowledge-panel">
          {selectedLesson ? (
            <article className="lesson-detail">
              <div className="card-heading">
                <SlidersHorizontal size={15} />
                经验详情
              </div>
              <div className="lesson-card-header">
                <span>{statusLabel[selectedLesson.status]}</span>
                <strong>{Math.round(selectedLesson.confidence * 100)}%</strong>
              </div>
              <h3>{selectedLesson.title || selectedLesson.recommendation}</h3>
              <p>{selectedLesson.recommendation}</p>
              <pre>
                {JSON.stringify(
                  {
                    conditions: selectedLesson.conditions ?? {},
                    expected_benefit: selectedLesson.expected_benefit ?? {},
                    evidence: selectedLesson.evidence,
                  },
                  null,
                  2,
                )}
              </pre>
              {selectedLesson.status === "pending_review" ? (
                <div className="lesson-actions">
                  <button onClick={() => void onAdopt(selectedLesson.id)} type="button">
                    <CheckCircle2 size={14} />
                    采纳
                  </button>
                  <button onClick={() => void onReject(selectedLesson.id)} type="button">
                    <XCircle size={14} />
                    拒绝
                  </button>
                  <button
                    onClick={() => void onMarkConflict(selectedLesson.id, "人工审核时发现与当前项目规则冲突")}
                    type="button"
                  >
                    <AlertTriangle size={14} />
                    标记冲突
                  </button>
                </div>
              ) : null}
            </article>
          ) : null}

          <div className="card-heading">
            <ShieldCheck size={15} />
            内置进化协议
          </div>
          <div className="protocol-list">
            {protocols.map((protocol) => (
              <article className="protocol-card" key={protocol.id}>
                <div>
                  <strong>{protocol.name}</strong>
                  <span className={protocol.stability === "experimental" ? "protocol-badge experimental" : "protocol-badge"}>
                    {protocol.stability === "experimental" ? "实验" : "稳定"}
                  </span>
                </div>
                <p>{protocol.purpose}</p>
                <small>{protocol.source_skill}</small>
                <ul>
                  {protocol.agent_policy.slice(0, 2).map((policy) => (
                    <li key={policy}>{policy}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <div className="knowledge-graph-mini">
            <span>任务澄清</span>
            <GitMerge size={16} />
            <span>反馈闭环</span>
            <GitMerge size={16} />
            <span>经验审查</span>
          </div>
        </section>
      </div>
    </main>
  );
}
