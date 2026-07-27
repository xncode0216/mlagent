import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  GitMerge,
  Network,
  ShieldCheck,
  SlidersHorizontal,
  XCircle,
  Zap,
  TrendingUp,
  Sparkles,
  HelpCircle,
  ChevronRight,
  RefreshCw,
} from "lucide-react";

import type { EvolutionTabId } from "../../app/appDeepLink";
import type {
  EvolutionInjectionLog,
  EvolutionProtocol,
  Lesson,
  LessonStatus,
  KnowledgeGraphNode,
  AdvancedInsight,
} from "../../lib/api";
import type { TaskStateInspection } from "../chat/taskStateInspector";
import { buildGraphEvidenceItems } from "./graphEvidence";
import { summarizeLessonStatuses } from "./evolutionStats";
import { useKnowledgeGraphQuery } from "./useEvolutionQueries";

const KnowledgeGraphCanvas = lazy(() => import("./KnowledgeGraphCanvas"));

type EvolutionWorkspaceProps = {
  projectId: string;
  taskStateInspection?: TaskStateInspection | null;
  lessons: Lesson[];
  injectionLogs: EvolutionInjectionLog[];
  protocols: EvolutionProtocol[];
  initialTab?: EvolutionTabId;
  onAdopt: (lessonId: string) => Promise<void>;
  onExtractLessonsFromSession?: () => Promise<void>;
  onAbandonTaskState?: () => Promise<void>;
  onOpenLogs?: (taskId?: string) => void;
  onRetryLearning?: () => Promise<void>;
  onSelectExperimentRun?: (experimentId: string) => void;
  onSelectProjectFile?: (path: string) => void;
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

function stringProperty(properties: Record<string, unknown>, key: string, fallback = "") {
  const value = properties[key];
  return typeof value === "string" ? value : fallback;
}

function numberProperty(properties: Record<string, unknown>, key: string, fallback = 0) {
  const value = properties[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function lessonStatusProperty(properties: Record<string, unknown>) {
  const status = stringProperty(properties, "status");
  return status === "pending_review" || status === "high_confidence" || status === "rejected" || status === "conflicted"
    ? status
    : null;
}

export function EvolutionWorkspace({
  projectId,
  taskStateInspection,
  lessons,
  injectionLogs,
  protocols,
  initialTab,
  onAdopt,
  onExtractLessonsFromSession,
  onAbandonTaskState,
  onOpenLogs,
  onRetryLearning,
  onSelectExperimentRun,
  onSelectProjectFile,
  onReject,
  onMarkConflict,
}: EvolutionWorkspaceProps) {
  // Tab control: "rules" | "graph"
  const [activeTab, setActiveTab] = useState<EvolutionTabId>(initialTab ?? "rules");

  // Rules list state
  const [statusFilter, setStatusFilter] = useState<LessonStatus | "all">("all");
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(lessons[0]?.id ?? null);

  // Graph state
  const graphQuery = useKnowledgeGraphQuery(projectId, activeTab === "graph");
  const graphData = graphQuery.data ?? null;
  const graphError =
    graphQuery.error instanceof Error
      ? graphQuery.error.message
      : graphQuery.error
        ? "知识图谱加载失败"
        : null;
  const [highlightedGraphNodeId, setHighlightedGraphNodeId] = useState<string | null>(null);
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState<string | null>(null);
  const [extractingLessons, setExtractingLessons] = useState(false);
  const [retryingLearning, setRetryingLearning] = useState(false);
  const [learningFeedback, setLearningFeedback] = useState<string | null>(null);

  // Statistics
  const lessonSummary = useMemo(() => summarizeLessonStatuses(lessons), [lessons]);

  const visibleLessons = useMemo(
    () => (statusFilter === "all" ? lessons : lessons.filter((lesson) => lesson.status === statusFilter)),
    [lessons, statusFilter],
  );

  async function extractLessonsFromSession() {
    if (!onExtractLessonsFromSession) return;
    setExtractingLessons(true);
    setLearningFeedback("Extracting lessons from the active session...");
    try {
      await onExtractLessonsFromSession();
      setLearningFeedback("Learning extraction completed. Review the new rule candidates below.");
    } catch (error) {
      setLearningFeedback(error instanceof Error ? error.message : "Learning extraction failed.");
    } finally {
      setExtractingLessons(false);
    }
  }

  async function retryLearningExtraction() {
    if (!onRetryLearning) return;
    setRetryingLearning(true);
    setLearningFeedback("Retrying learned rule extraction...");
    try {
      await onRetryLearning();
      setLearningFeedback("Learning retry completed. Review the recovered candidates below.");
    } catch (error) {
      setLearningFeedback(error instanceof Error ? error.message : "Learning retry failed.");
    } finally {
      setRetryingLearning(false);
    }
  }

  async function abandonLearningState() {
    if (!onAbandonTaskState) return;
    setLearningFeedback("Clearing saved learning retry state...");
    try {
      await onAbandonTaskState();
      setLearningFeedback("Saved learning retry state was cleared.");
    } catch (error) {
      setLearningFeedback(error instanceof Error ? error.message : "Failed to clear learning retry state.");
    }
  }

  const selectedLesson = lessons.find((lesson) => lesson.id === selectedLessonId) ?? visibleLessons[0] ?? null;
  const selectedGraphNode = useMemo(
    () => graphData?.nodes.find((node) => node.id === selectedGraphNodeId) ?? graphData?.nodes[0] ?? null,
    [graphData, selectedGraphNodeId],
  );
  const selectedGraphEvidenceItems = useMemo(
    () => (selectedGraphNode ? buildGraphEvidenceItems(selectedGraphNode) : []),
    [selectedGraphNode],
  );

  useEffect(() => {
    if (selectedLessonId && lessons.some((lesson) => lesson.id === selectedLessonId)) return;
    setSelectedLessonId(visibleLessons[0]?.id ?? lessons[0]?.id ?? null);
  }, [lessons, selectedLessonId, visibleLessons]);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    if (!highlightedGraphNodeId) return;
    const timeout = window.setTimeout(() => setHighlightedGraphNodeId(null), 2500);
    return () => window.clearTimeout(timeout);
  }, [highlightedGraphNodeId]);

  const activateGraphNode = (node: KnowledgeGraphNode) => {
    setSelectedGraphNodeId(node.id);
    setHighlightedGraphNodeId(null);
  };

  const focusLessonFromGraphNode = (node: KnowledgeGraphNode) => {
    const lessonId = stringProperty(node.properties, "lesson_id");
    if (!lessonId) return;
    setSelectedLessonId(lessonId);
    setStatusFilter("all");
    setActiveTab("rules");
  };

  const handleInsightClick = (insight: AdvancedInsight) => {
    if (!graphData) return;
    const lessonId = stringProperty(insight.meta, "lesson_id");
    const column = stringProperty(insight.meta, "column");
    if (insight.type === "surprise_connection" && lessonId) {
      const ruleNode = graphData.nodes.find((node) => stringProperty(node.properties, "lesson_id") === lessonId);
      if (ruleNode) {
        setSelectedGraphNodeId(ruleNode.id);
        setHighlightedGraphNodeId(ruleNode.id);
      }
    } else if (insight.type === "knowledge_gap" && column) {
      const colNode = graphData.nodes.find((node) => node.label === column);
      if (colNode) {
        setSelectedGraphNodeId(colNode.id);
        setHighlightedGraphNodeId(colNode.id);
      }
    }
  };

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

      {/* Tabs */}
      <div className="view-tabs" role="tablist" aria-label="自进化知识视图">
        <button
          aria-selected={activeTab === "rules"}
          className={activeTab === "rules" ? "active" : ""}
          onClick={() => setActiveTab("rules")}
          role="tab"
          type="button"
        >
          <SlidersHorizontal size={14} />
          经验审计列表
        </button>
        <button
          aria-selected={activeTab === "graph"}
          className={activeTab === "graph" ? "active" : ""}
          onClick={() => setActiveTab("graph")}
          role="tab"
          type="button"
        >
          <Network size={14} />
          自进化知识图谱 & 高级洞察
        </button>
      </div>

      {activeTab === "rules" ? (
        <>
          <div className="evolution-stats">
            <div>
              <span>待审核</span>
              <strong>{lessonSummary.pending}</strong>
            </div>
            <div>
              <span>高置信规则</span>
              <strong>{lessonSummary.highConfidence}</strong>
            </div>
            <div>
              <span>冲突</span>
              <strong>{lessonSummary.conflicted}</strong>
            </div>
            <div>
              <span>已拒绝</span>
              <strong>{lessonSummary.rejected}</strong>
            </div>
          </div>

          {taskStateInspection?.stage === "learn" ? (
            <section className="learning-recovery" data-learning-recovery="true">
              <div>
                <span className="section-kicker">Learn Recovery</span>
                <strong>{taskStateInspection.title}</strong>
                <p>{taskStateInspection.description}</p>
              </div>
              <div className="learning-recovery-facts">
                {taskStateInspection.facts
                  .filter((fact) => ["Source", "Retries", "Last error", "Repair", "Stale check", "Resume"].includes(fact.label))
                  .map((fact) => (
                    <span key={fact.label}>
                      <b>{fact.label}</b>
                      {fact.value}
                    </span>
                  ))}
              </div>
              <div className="lesson-actions">
                <button disabled={!onRetryLearning || retryingLearning} onClick={() => void retryLearningExtraction()} type="button">
                  <RefreshCw size={14} />
                  {retryingLearning ? "Retrying..." : "Retry Learning"}
                </button>
                <button onClick={() => onOpenLogs?.(taskStateInspection.taskId)} type="button">
                  <ChevronRight size={14} />
                  Inspect Logs
                </button>
                <button disabled={!onAbandonTaskState} onClick={() => void abandonLearningState()} type="button">
                  <XCircle size={14} />
                  Abandon State
                </button>
              </div>
            </section>
          ) : null}

          <div className="evolution-layout">
            <section className="lesson-list">
              <div className="section-header">
                <span className="panel-title">从历史任务提取的经验</span>
                <button
                  className="table-title-action"
                  disabled={!onExtractLessonsFromSession || extractingLessons}
                  onClick={() => void extractLessonsFromSession()}
                  type="button"
                >
                  {extractingLessons ? "Learning..." : "Extract Lessons"}
                </button>
              </div>
              {learningFeedback ? <div className="action-feedback info">{learningFeedback}</div> : null}
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

              <section className="injection-audit-panel">
                <div className="card-heading">
                  <ShieldCheck size={15} />
                  规则注入审计
                </div>
                {injectionLogs.length === 0 ? (
                  <div className="empty-state compact-empty">还没有规则注入记录。运行一次分析或训练任务后，这里会显示命中的历史经验。</div>
                ) : (
                  <div className="injection-log-list">
                    {injectionLogs.slice(0, 6).map((entry, index) => (
                      <article className="injection-log-card" key={`${entry.session_id}-${entry.created_at}-${index}`}>
                        <div>
                          <strong>{entry.session_id}</strong>
                          <span>{entry.matched_rules.length} 条规则</span>
                        </div>
                        <p>{entry.snippet || "本次未命中可注入规则，已记录审计事件。"}</p>
                        <small>{new Date(entry.created_at).toLocaleString()}</small>
                      </article>
                    ))}
                  </div>
                )}
              </section>

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
        </>
      ) : (
        /* Knowledge Graph Tab View */
        <section
          aria-busy={graphQuery.isFetching}
          aria-label="自进化知识图谱"
          className="graph-view-wrapper"
        >
          {graphData ? (
            <div className="graph-query-toolbar">
              <span aria-live="polite">
                {graphQuery.isFetching
                  ? "正在更新知识图谱…"
                  : `${graphData.nodes.length} 个节点 · ${graphData.edges.length} 条关系`}
              </span>
              <button
                aria-label="刷新知识图谱"
                disabled={graphQuery.isFetching}
                onClick={() => void graphQuery.refetch()}
                type="button"
              >
                <RefreshCw aria-hidden="true" size={14} />
                刷新
              </button>
            </div>
          ) : null}

          {graphData && graphError ? (
            <div className="graph-refresh-error" role="alert">
              <AlertTriangle aria-hidden="true" size={16} />
              <div>
                <strong>知识图谱刷新失败</strong>
                <span>{graphError}</span>
              </div>
              <button
                aria-label="重试知识图谱"
                disabled={graphQuery.isFetching}
                onClick={() => void graphQuery.refetch()}
                type="button"
              >
                重试
              </button>
            </div>
          ) : null}

          {!projectId ? (
            <div className="graph-empty-state">
              <div>
                <h3>先创建或选择项目</h3>
                <p>知识图谱只展示当前项目的真实数据列、模型实验和经验规则。请先在左侧 Explorer 建立项目上下文。</p>
              </div>
            </div>
          ) : graphQuery.isFetching && !graphData ? (
            <div className="graph-loading-state" role="status">
              <div className="graph-loading-copy">
                <Network aria-hidden="true" size={18} />
                <strong>正在读取知识图谱…</strong>
                <span>正在汇总数据列、模型实验与已审核经验。</span>
              </div>
              <div aria-hidden="true" className="graph-skeleton">
                <span className="graph-skeleton-node column" />
                <span className="graph-skeleton-node experiment" />
                <span className="graph-skeleton-node rule" />
              </div>
            </div>
          ) : graphError && !graphData ? (
            <div className="empty-state graph-error-state" role="alert">
              <strong>知识图谱加载失败</strong>
              <span>{graphError}</span>
              <button
                aria-label="重试知识图谱"
                className="graph-retry-button"
                onClick={() => void graphQuery.refetch()}
                type="button"
              >
                <RefreshCw aria-hidden="true" size={14} />
                重试
              </button>
            </div>
          ) : !graphData || graphData.nodes.length === 0 ? (
            <div className="graph-empty-state">
              <div>
                <h3>还没有足够的演进证据生成知识图谱</h3>
                <p>
                  图谱需要同时看到数据列、模型实验和已沉淀的经验规则。先完成一次数据分析或机器学习训练，
                  再把高价值经验采纳为规则，系统就能把它们连接成可追溯的自进化链路。
                </p>
              </div>
              <div className="graph-empty-steps">
                <div className="graph-empty-step">
                  <strong>1. 跑一次分析或训练</strong>
                  <span>生成数据特征、模型指标、日志事件和可复用产物。</span>
                </div>
                <div className="graph-empty-step">
                  <strong>2. 审核候选经验</strong>
                  <span>把高置信建议采纳为项目规则，冲突或低价值经验保留审计记录。</span>
                </div>
                <div className="graph-empty-step">
                  <strong>3. 返回图谱检查链路</strong>
                  <span>查看规则如何影响特征、实验和后续 Agent 提示注入。</span>
                </div>
              </div>
              <button className="graph-retry-button" onClick={() => setActiveTab("rules")} type="button">
                查看经验审计列表
              </button>
            </div>
          ) : (
            <>
              <div className="graph-container">
                <Suspense
                  fallback={
                    <div className="graph-canvas-loading" role="status">
                      <Network aria-hidden="true" size={22} />
                      <span>正在加载交互式知识图谱…</span>
                    </div>
                  }
                >
                  <KnowledgeGraphCanvas
                    graph={graphData}
                    highlightedNodeId={highlightedGraphNodeId}
                    onSelectNode={activateGraphNode}
                    selectedNodeId={selectedGraphNode?.id ?? null}
                  />
                </Suspense>
                {/* Graph sidebar drawer detail card */}
                <div className="graph-detail-sidebar">
                  {selectedGraphNode ? (
                    <>
                      <h3>
                        <Sparkles className="graph-detail-icon" size={16} />
                        节点详情
                      </h3>
                      <span className={`badge ${selectedGraphNode.type}`}>
                        {selectedGraphNode.type === "column" ? "数据特征列" :
                         selectedGraphNode.type === "experiment" ? "模型训练实验" : "自进化经验"}
                      </span>
                      <strong className="graph-detail-title">
                        {selectedGraphNode.label}
                      </strong>

                      {selectedGraphEvidenceItems.length > 0 ? (
                        <div className="graph-evidence-panel" aria-label="节点来源与证据">
                          <strong>来源与证据</strong>
                          {selectedGraphEvidenceItems.map((item) => {
                            const action = item.action;
                            return (
                              <div className="graph-evidence-row" key={`${item.label}-${item.value}`}>
                                <span>{item.label}</span>
                                <div className="graph-evidence-value">
                                  <code>{item.value}</code>
                                  {action?.type === "file" && onSelectProjectFile ? (
                                    <button onClick={() => onSelectProjectFile(action.path)} type="button">
                                      定位文件
                                    </button>
                                  ) : null}
                                  {action?.type === "experiment" && onSelectExperimentRun ? (
                                    <button onClick={() => onSelectExperimentRun(action.experimentId)} type="button">
                                      定位实验
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}

                      <div className="graph-node-details">
                        {selectedGraphNode.type === "column" && (
                          <>
                            <div>
                              <span className="graph-detail-label">特征数据类型：</span>
                              <span className="graph-detail-value sky">
                                {stringProperty(selectedGraphNode.properties, "type") === "numeric" ? "数值型 (Numeric)" : "分类码 (Categorical)"}
                              </span>
                            </div>
                            <div>
                              <span className="graph-detail-label">缺失值比率：</span>
                              <span className="graph-detail-value danger">{(numberProperty(selectedGraphNode.properties, "missing_rate") * 100).toFixed(2)}%</span>
                            </div>
                            <div className="graph-detail-note">
                              <small>该特征列是模型的重要预测自变量。鼠标悬停其上可追溯其在哪些模型实验中被使用，或受到哪些自进化规则的推荐影响。</small>
                            </div>
                          </>
                        )}

                        {selectedGraphNode.type === "experiment" && (
                          <>
                            <div>
                              <span className="graph-detail-label">算法引擎：</span>
                              <span className="graph-detail-value ml">
                                {stringProperty(selectedGraphNode.properties, "engine", "unknown").toUpperCase()}
                              </span>
                            </div>
                            <div>
                              <span className="graph-detail-label">模型精度 (Acc)：</span>
                              <span className="graph-detail-value success">
                                {(numberProperty(selectedGraphNode.properties, "accuracy") * 100).toFixed(2)}%
                              </span>
                            </div>
                            <div>
                              <span className="graph-detail-label">目标列字段：</span>
                              <span className="graph-detail-value warning">{stringProperty(selectedGraphNode.properties, "target_column", "未知")}</span>
                            </div>
                            <div>
                              <span className="graph-detail-label">训练时间：</span>
                              <span className="graph-detail-value secondary">
                                {stringProperty(selectedGraphNode.properties, "created_at")
                                  ? new Date(stringProperty(selectedGraphNode.properties, "created_at")).toLocaleString()
                                  : "未知"}
                              </span>
                            </div>
                          </>
                        )}

                        {selectedGraphNode.type === "rule" && (
                          <>
                            <div>
                              <span className="graph-detail-label">知识信度：</span>
                              <span className="graph-detail-value success">
                                {(numberProperty(selectedGraphNode.properties, "confidence") * 100).toFixed(1)}%
                              </span>
                            </div>
                            <div>
                              <span className="graph-detail-label">注入状态：</span>
                              <span className="graph-detail-value warning">
                                {(() => {
                                  const status = lessonStatusProperty(selectedGraphNode.properties);
                                  return status ? statusLabel[status] : stringProperty(selectedGraphNode.properties, "status", "未知");
                                })()}
                              </span>
                            </div>
                            <div className="graph-detail-rule">
                              <span className="graph-detail-label">业务规则推荐 (Recommendation)：</span>
                              <p>
                                {stringProperty(selectedGraphNode.properties, "recommendation", "暂无推荐说明")}
                              </p>
                            </div>
                            {stringProperty(selectedGraphNode.properties, "lesson_id") ? (
                              <button className="graph-node-action" onClick={() => focusLessonFromGraphNode(selectedGraphNode)} type="button">
                                查看经验详情
                              </button>
                            ) : null}
                          </>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="graph-detail-empty">
                      <HelpCircle size={32} />
                      <p>点击图谱中的任意节点<br/>查看其演进链路与指标详情</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Advanced Insights Section */}
              <section className="insights-section">
                <h3>
                  <Zap className="insights-section-icon" size={18} />
                  自进化高级洞察 (Self-Evolution Insights)
                </h3>
                {graphData.insights.length === 0 ? (
                  <div className="empty-state compact-empty insights-empty">
                    暂未发现明显的知识空白或惊奇连接。系统将持续监控多轮训练与经验审计状态，自动沉淀深度决策洞察。
                  </div>
                ) : (
                  <div className="insights-grid">
                    {graphData.insights.map((insight, idx) => (
                      <button
                        className={`insight-card ${insight.type}`}
                        key={idx}
                        onClick={() => handleInsightClick(insight)}
                        type="button"
                      >
                        <div className="insight-header">
                          <span>
                            {insight.type === "knowledge_gap" ? (
                              <AlertTriangle className="insight-type-icon danger" size={15} />
                            ) : (
                              <TrendingUp className="insight-type-icon success" size={15} />
                            )}
                            {insight.title}
                          </span>
                          <span className="insight-kind">
                            {insight.type === "knowledge_gap" ? "知识空白" : "惊奇连接"}
                          </span>
                        </div>
                        <p>{insight.description}</p>
                        <span className="insight-action">
                          在拓扑图上查看节点定位
                          <ChevronRight size={12} />
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </section>
      )}
    </main>
  );
}

export default EvolutionWorkspace;
