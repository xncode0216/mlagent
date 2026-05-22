import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
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
} from "lucide-react";

import { getKnowledgeGraph } from "../../lib/api";
import type {
  EvolutionInjectionLog,
  EvolutionProtocol,
  Lesson,
  LessonStatus,
  KnowledgeGraphNode,
  AdvancedInsight,
  KnowledgeGraphResult,
} from "../../lib/api";
import { summarizeLessonStatuses } from "./evolutionStats";

type EvolutionWorkspaceProps = {
  projectId: string;
  lessons: Lesson[];
  injectionLogs: EvolutionInjectionLog[];
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
  lessons,
  injectionLogs,
  protocols,
  onAdopt,
  onReject,
  onMarkConflict,
}: EvolutionWorkspaceProps) {
  // Tab control: "rules" | "graph"
  const [activeTab, setActiveTab] = useState<"rules" | "graph">("rules");

  // Rules list state
  const [statusFilter, setStatusFilter] = useState<LessonStatus | "all">("all");
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(lessons[0]?.id ?? null);

  // Graph state
  const [graphData, setGraphData] = useState<KnowledgeGraphResult | null>(null);
  const [loadingGraph, setLoadingGraph] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [graphReloadToken, setGraphReloadToken] = useState(0);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedGraphNode, setSelectedGraphNode] = useState<KnowledgeGraphNode | null>(null);

  // Statistics
  const lessonSummary = useMemo(() => summarizeLessonStatuses(lessons), [lessons]);

  const visibleLessons = useMemo(
    () => (statusFilter === "all" ? lessons : lessons.filter((lesson) => lesson.status === statusFilter)),
    [lessons, statusFilter],
  );

  const selectedLesson = lessons.find((lesson) => lesson.id === selectedLessonId) ?? visibleLessons[0] ?? null;

  useEffect(() => {
    if (selectedLessonId && lessons.some((lesson) => lesson.id === selectedLessonId)) return;
    setSelectedLessonId(visibleLessons[0]?.id ?? lessons[0]?.id ?? null);
  }, [lessons, selectedLessonId, visibleLessons]);

  // Load knowledge graph data when graph tab is selected
  useEffect(() => {
    if (activeTab !== "graph" || !projectId) return;

    setLoadingGraph(true);
    setGraphError(null);
    getKnowledgeGraph(projectId)
      .then((data) => {
        setGraphData(data);
        // Default select the first node if any
        if (data.nodes.length > 0) {
          setSelectedGraphNode(data.nodes[0]);
        } else {
          setSelectedGraphNode(null);
        }
      })
      .catch((err) => {
        console.error("Failed to load knowledge graph", err);
        setGraphError(err instanceof Error ? err.message : "知识图谱加载失败");
        setGraphData(null);
        setSelectedGraphNode(null);
      })
      .finally(() => {
        setLoadingGraph(false);
      });
  }, [activeTab, projectId, lessons, graphReloadToken]);

  // Compute Layout Node Positions: Feature Columns on Left (X=120), Experiments in Middle (X=400), Rules on Right (X=680)
  const computedNodes = useMemo(() => {
    if (!graphData) return [];
    const { nodes } = graphData;

    const cols = nodes.filter((n) => n.type === "column");
    const exps = nodes.filter((n) => n.type === "experiment");
    const rules = nodes.filter((n) => n.type === "rule");

    const H = 480;
    const layoutNodes: Array<KnowledgeGraphNode & { x: number; y: number }> = [];

    // Layout Columns on Left
    cols.forEach((node, index) => {
      const count = cols.length;
      const x = 140;
      const y = count === 1 ? H / 2 : 40 + (index / (count - 1)) * (H - 80);
      layoutNodes.push({ ...node, x, y });
    });

    // Layout Experiments in Middle
    exps.forEach((node, index) => {
      const count = exps.length;
      const x = 400;
      const y = count === 1 ? H / 2 : 60 + (index / (count - 1)) * (H - 120);
      layoutNodes.push({ ...node, x, y });
    });

    // Layout Rules on Right
    rules.forEach((node, index) => {
      const count = rules.length;
      const x = 660;
      const y = count === 1 ? H / 2 : 50 + (index / (count - 1)) * (H - 100);
      layoutNodes.push({ ...node, x, y });
    });

    return layoutNodes;
  }, [graphData]);

  // Compute Edge coordinates based on node coordinate matching
  const computedEdges = useMemo(() => {
    if (!graphData || computedNodes.length === 0) return [];
    const { edges } = graphData;

    return edges
      .map((edge) => {
        const sourceNode = computedNodes.find((n) => n.id === edge.source);
        const targetNode = computedNodes.find((n) => n.id === edge.target);
        if (!sourceNode || !targetNode) return null;
        return {
          ...edge,
          x1: sourceNode.x,
          y1: sourceNode.y,
          x2: targetNode.x,
          y2: targetNode.y,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);
  }, [graphData, computedNodes]);

  // Highlight Logic on Hover
  const neighborNodeIds = useMemo(() => {
    if (!hoveredNodeId || !graphData) return new Set<string>();
    const neighbors = new Set<string>([hoveredNodeId]);
    graphData.edges.forEach((edge) => {
      if (edge.source === hoveredNodeId) {
        neighbors.add(edge.target);
      }
      if (edge.target === hoveredNodeId) {
        neighbors.add(edge.source);
      }
    });
    return neighbors;
  }, [hoveredNodeId, graphData]);

  const drawBezierPath = (x1: number, y1: number, x2: number, y2: number) => {
    const cx1 = x1 + 100;
    const cy1 = y1;
    const cx2 = x2 - 100;
    const cy2 = y2;
    return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
  };

  const getEdgeColor = (type: string) => {
    switch (type) {
      case "produces":
        return "#f38ba8"; // soft pink/red (column production)
      case "uses":
        return "#89dceb"; // sky blue (feature usage)
      case "triggers":
        return "#f9e2af"; // soft yellow (affects features)
      case "supports":
        return "#a6e3a1"; // emerald green (model adoption verification)
      default:
        return "#585b70";
    }
  };

  const activateGraphNode = (node: KnowledgeGraphNode) => {
    setSelectedGraphNode(node);
  };

  const handleGraphNodeKeyDown = (event: KeyboardEvent<SVGGElement>, node: KnowledgeGraphNode) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activateGraphNode(node);
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
      const ruleNode = computedNodes.find((n) => stringProperty(n.properties, "lesson_id") === lessonId);
      if (ruleNode) {
        setSelectedGraphNode(ruleNode);
        setHoveredNodeId(ruleNode.id);
        // Clean hover highlights after 2.5 seconds
        setTimeout(() => setHoveredNodeId(null), 2500);
      }
    } else if (insight.type === "knowledge_gap" && column) {
      const colNode = computedNodes.find((n) => n.label === column);
      if (colNode) {
        setSelectedGraphNode(colNode);
        setHoveredNodeId(colNode.id);
        setTimeout(() => setHoveredNodeId(null), 2500);
      }
    }
  };

  return (
    <main className="agent-workspace evolution-workspace">
      <style>{`
        .view-tabs {
          display: flex;
          gap: 12px;
          margin-bottom: 20px;
          border-bottom: 1.5px solid #313244;
          padding-bottom: 8px;
        }
        .view-tabs button {
          background: transparent;
          border: 1px solid transparent;
          color: #a6adc8;
          padding: 8px 16px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .view-tabs button:hover {
          color: #cdd6f4;
          background: #313244;
        }
        .view-tabs button.active {
          color: #11111b;
          background: #cba6f7;
          font-weight: 600;
          box-shadow: 0 4px 12px rgba(203, 166, 247, 0.35);
        }
        .graph-container {
          display: grid;
          grid-template-columns: 1fr 340px;
          gap: 20px;
          margin-top: 16px;
          background: #11111b;
          border: 1.5px solid #313244;
          border-radius: 12px;
          padding: 20px;
          min-height: 520px;
        }
        .svg-canvas {
          background-image: radial-gradient(#313244 1.2px, transparent 0);
          background-size: 24px 24px;
          border-radius: 8px;
          background-color: #181825;
          border: 1px solid #313244;
          box-shadow: inset 0 2px 8px rgba(0,0,0,0.5);
          position: relative;
        }
        .node-rect {
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          cursor: pointer;
        }
        .node-rect:hover {
          filter: drop-shadow(0 0 10px currentColor);
        }
        .edge-line {
          transition: all 0.3s ease;
        }
        @keyframes strokeFlow {
          to {
            stroke-dashoffset: -20;
          }
        }
        .flowing-edge {
          stroke-dasharray: 6, 6;
          animation: strokeFlow 1.2s linear infinite;
        }
        .node-active-highlight {
          animation: pulseGlow 1.6s infinite alternate cubic-bezier(0.4, 0, 0.2, 1);
        }
        @keyframes pulseGlow {
          from {
            filter: drop-shadow(0 0 3px currentColor);
            stroke-width: 2.5;
          }
          to {
            filter: drop-shadow(0 0 12px currentColor);
            stroke-width: 4;
          }
        }
        .graph-detail-sidebar {
          background: #181825;
          border: 1px solid #313244;
          border-radius: 8px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          overflow-y: auto;
          box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        }
        .graph-detail-sidebar h3 {
          margin: 0;
          font-size: 16px;
          color: #cdd6f4;
          border-bottom: 1px solid #313244;
          padding-bottom: 8px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .graph-detail-sidebar .badge {
          align-self: flex-start;
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 4px;
          font-weight: 500;
          text-transform: uppercase;
        }
        .graph-detail-sidebar .badge.column { background: rgba(137, 220, 235, 0.15); color: #89dceb; border: 1px solid rgba(137, 220, 235, 0.3); }
        .graph-detail-sidebar .badge.experiment { background: rgba(203, 166, 247, 0.15); color: #cba6f7; border: 1px solid rgba(203, 166, 247, 0.3); }
        .graph-detail-sidebar .badge.rule { background: rgba(249, 226, 175, 0.15); color: #f9e2af; border: 1px solid rgba(249, 226, 175, 0.3); }

        .insights-section {
          margin-top: 24px;
        }
        .insights-section h3 {
          color: #cdd6f4;
          font-size: 16px;
          margin-bottom: 14px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .insights-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
          gap: 16px;
        }
        .insight-card {
          padding: 16px;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          flex-direction: column;
          gap: 8px;
          position: relative;
          text-align: left;
        }
        button.insight-card {
          color: inherit;
          font: inherit;
        }
        .insight-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45);
        }
        .graph-retry-button,
        .graph-node-action {
          align-self: flex-start;
          border: 1px solid rgba(203, 166, 247, 0.45);
          background: rgba(203, 166, 247, 0.12);
          color: #cba6f7;
          border-radius: 6px;
          padding: 7px 12px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
        }
        .graph-retry-button:hover,
        .graph-node-action:hover {
          background: rgba(203, 166, 247, 0.2);
          border-color: rgba(203, 166, 247, 0.75);
        }
        .graph-empty-state {
          min-height: 400px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 18px;
          background: linear-gradient(135deg, rgba(203, 166, 247, 0.06), rgba(137, 220, 235, 0.03));
          border: 1px dashed rgba(166, 173, 200, 0.28);
          border-radius: 12px;
          padding: 28px;
        }
        .graph-empty-state h3 {
          margin: 0;
          color: #cdd6f4;
          font-size: 18px;
        }
        .graph-empty-state p {
          margin: 0;
          color: #a6adc8;
          line-height: 1.6;
          max-width: 680px;
        }
        .graph-empty-steps {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }
        .graph-empty-step {
          border: 1px solid rgba(166, 173, 200, 0.16);
          background: rgba(24, 24, 37, 0.72);
          border-radius: 8px;
          padding: 14px;
          min-height: 92px;
        }
        .graph-empty-step strong {
          display: block;
          color: #cdd6f4;
          margin-bottom: 6px;
        }
        .graph-empty-step span {
          color: #a6adc8;
          font-size: 12px;
          line-height: 1.45;
        }
        @media (max-width: 1100px) {
          .graph-empty-steps {
            grid-template-columns: 1fr;
          }
        }
        .insight-card.knowledge_gap {
          background: rgba(243, 139, 168, 0.05);
          border: 1px solid rgba(243, 139, 168, 0.15);
          border-left: 4.5px solid #f38ba8;
        }
        .insight-card.knowledge_gap:hover {
          background: rgba(243, 139, 168, 0.08);
          border-color: rgba(243, 139, 168, 0.3);
        }
        .insight-card.surprise_connection {
          background: rgba(166, 227, 161, 0.05);
          border: 1px solid rgba(166, 227, 161, 0.15);
          border-left: 4.5px solid #a6e3a1;
        }
        .insight-card.surprise_connection:hover {
          background: rgba(166, 227, 161, 0.08);
          border-color: rgba(166, 227, 161, 0.3);
        }
        .insight-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          color: #cdd6f4;
          font-weight: 600;
          font-size: 14px;
        }
        .insight-header span {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .insight-card p {
          margin: 0;
          font-size: 13px;
          line-height: 1.5;
          color: #bac2de;
        }
        .insight-action {
          align-self: flex-end;
          font-size: 11px;
          color: #a6adc8;
          display: flex;
          align-items: center;
          gap: 2px;
          margin-top: 4px;
        }
        .insight-card:hover .insight-action {
          color: #cba6f7;
        }
      `}</style>

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
        <div className="graph-view-wrapper">
          {loadingGraph ? (
            <div className="empty-state" style={{ minHeight: "400px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div className="loading-spinner">正在加载数据拓扑与高级洞察...</div>
            </div>
          ) : graphError ? (
            <div
              className="empty-state"
              style={{ minHeight: "400px", display: "flex", flexDirection: "column", gap: "12px", alignItems: "flex-start" }}
            >
              <strong>知识图谱加载失败</strong>
              <span>{graphError}</span>
              <button className="graph-retry-button" onClick={() => setGraphReloadToken((value) => value + 1)} type="button">
                重试加载
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
                {/* SVG Graph Canvas */}
                <div className="svg-canvas">
                  <svg
                    width="100%"
                    height="100%"
                    viewBox="0 0 800 480"
                    onMouseLeave={() => setHoveredNodeId(null)}
                  >
                    {/* Background indicators */}
                    <text x="140" y="25" fill="#585b70" fontSize="11" textAnchor="middle" fontWeight="600" letterSpacing="1">数据特征 (COLUMNS)</text>
                    <text x="400" y="25" fill="#585b70" fontSize="11" textAnchor="middle" fontWeight="600" letterSpacing="1">模型实验 (EXPERIMENTS)</text>
                    <text x="660" y="25" fill="#585b70" fontSize="11" textAnchor="middle" fontWeight="600" letterSpacing="1">自进化规则 (RULES)</text>

                    {/* Defs for Glow effects */}
                    <defs>
                      <filter id="glow-col" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="4" result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                      </filter>
                    </defs>

                    {/* Render Edges first */}
                    {computedEdges.map((edge) => {
                      const isHovered = hoveredNodeId !== null;
                      const isEdgeHighlighted = hoveredNodeId === edge.source || hoveredNodeId === edge.target;

                      const strokeColor = getEdgeColor(edge.type);
                      const strokeWidth = isEdgeHighlighted ? 3 : 1.5;
                      const opacity = isHovered ? (isEdgeHighlighted ? 0.95 : 0.08) : 0.35;

                      // Is rule in active/high_confidence state? Make it flow!
                      const isFlowing = edge.type === "supports" || edge.type === "triggers";

                      return (
                        <g key={edge.id}>
                          {/* Outer glow background line on hover */}
                          {isEdgeHighlighted && (
                            <path
                              d={drawBezierPath(edge.x1, edge.y1, edge.x2, edge.y2)}
                              fill="none"
                              stroke={strokeColor}
                              strokeWidth={6}
                              opacity={0.35}
                              className="edge-line"
                            />
                          )}
                          <path
                            d={drawBezierPath(edge.x1, edge.y1, edge.x2, edge.y2)}
                            fill="none"
                            stroke={strokeColor}
                            strokeWidth={strokeWidth}
                            opacity={opacity}
                            className={`edge-line ${isFlowing && isEdgeHighlighted ? "flowing-edge" : ""}`}
                          />
                        </g>
                      );
                    })}

                    {/* Render Nodes */}
                    {computedNodes.map((node) => {
                      const isHovered = hoveredNodeId !== null;
                      const isSelected = selectedGraphNode?.id === node.id;
                      const isHighlighted = !isHovered || neighborNodeIds.has(node.id);
                      const opacity = isHighlighted ? 1 : 0.2;

                      // Colors based on types
                      let strokeColor = "#585b70";

                      if (node.type === "column") {
                        strokeColor = "#89dceb";
                      } else if (node.type === "experiment") {
                        strokeColor = "#cba6f7";
                      } else if (node.type === "rule") {
                        strokeColor = "#f9e2af";
                      }

                      if (node.type === "column") {
                        return (
                          <g
                            aria-label={`数据特征列 ${node.label}`}
                            key={node.id}
                            transform={`translate(${node.x}, ${node.y})`}
                            onMouseEnter={() => setHoveredNodeId(node.id)}
                            onClick={() => activateGraphNode(node)}
                            onKeyDown={(event) => handleGraphNodeKeyDown(event, node)}
                            opacity={opacity}
                            role="button"
                            style={{ transition: "opacity 0.25s" }}
                            tabIndex={0}
                          >
                            <rect
                              x="-65"
                              y="-15"
                              width="130"
                              height="30"
                              rx="6"
                              fill="#1e1e2e"
                              stroke={isSelected ? "#f5c2e7" : strokeColor}
                              strokeWidth={isSelected ? 2.5 : 1.5}
                              className={`node-rect ${isSelected ? "node-active-highlight" : ""}`}
                              style={{ color: strokeColor }}
                            />
                            <text
                              textAnchor="middle"
                              y="4"
                              fill="#cdd6f4"
                              fontSize="11.5"
                              fontWeight="500"
                              pointerEvents="none"
                            >
                              {node.label}
                            </text>
                          </g>
                        );
                      } else if (node.type === "experiment") {
                        return (
                          <g
                            aria-label={`模型训练实验 ${node.label}`}
                            key={node.id}
                            transform={`translate(${node.x}, ${node.y})`}
                            onMouseEnter={() => setHoveredNodeId(node.id)}
                            onClick={() => activateGraphNode(node)}
                            onKeyDown={(event) => handleGraphNodeKeyDown(event, node)}
                            opacity={opacity}
                            role="button"
                            style={{ transition: "opacity 0.25s" }}
                            tabIndex={0}
                          >
                            <circle
                              r="24"
                              fill="#1e1e2e"
                              stroke={isSelected ? "#f5c2e7" : strokeColor}
                              strokeWidth={isSelected ? 2.5 : 1.5}
                              className={`node-rect ${isSelected ? "node-active-highlight" : ""}`}
                              style={{ color: strokeColor }}
                            />
                            <circle
                              r="20"
                              fill="none"
                              stroke={strokeColor}
                              strokeWidth="1"
                              strokeDasharray="4, 2"
                              opacity="0.5"
                              pointerEvents="none"
                            />
                            <text
                              textAnchor="middle"
                              y="4"
                              fill="#cdd6f4"
                              fontSize="9.5"
                              fontWeight="600"
                              pointerEvents="none"
                            >
                              EXP
                            </text>
                          </g>
                        );
                      } else {
                        // Rule Nodes
                        return (
                          <g
                            aria-label={`自进化经验 ${node.label}`}
                            key={node.id}
                            transform={`translate(${node.x}, ${node.y})`}
                            onMouseEnter={() => setHoveredNodeId(node.id)}
                            onClick={() => activateGraphNode(node)}
                            onKeyDown={(event) => handleGraphNodeKeyDown(event, node)}
                            opacity={opacity}
                            role="button"
                            style={{ transition: "opacity 0.25s" }}
                            tabIndex={0}
                          >
                            <rect
                              x="-75"
                              y="-18"
                              width="150"
                              height="36"
                              rx="8"
                              fill="#1e1e2e"
                              stroke={isSelected ? "#f5c2e7" : strokeColor}
                              strokeWidth={isSelected ? 2.5 : 1.5}
                              className={`node-rect ${isSelected ? "node-active-highlight" : ""}`}
                              style={{ color: strokeColor }}
                            />
                            <text
                              textAnchor="middle"
                              y="3"
                              fill="#cdd6f4"
                              fontSize="11"
                              fontWeight="500"
                              pointerEvents="none"
                            >
                              {node.label.length > 10 ? node.label.substring(0, 9) + "..." : node.label}
                            </text>
                          </g>
                        );
                      }
                    })}
                  </svg>
                </div>

                {/* Graph sidebar drawer detail card */}
                <div className="graph-detail-sidebar">
                  {selectedGraphNode ? (
                    <>
                      <h3>
                        <Sparkles size={16} style={{ color: "#cba6f7" }} />
                        节点详情
                      </h3>
                      <span className={`badge ${selectedGraphNode.type}`}>
                        {selectedGraphNode.type === "column" ? "数据特征列" :
                         selectedGraphNode.type === "experiment" ? "模型训练实验" : "自进化经验"}
                      </span>
                      <strong style={{ color: "#cdd6f4", fontSize: "16px", marginTop: "4px" }}>
                        {selectedGraphNode.label}
                      </strong>

                      <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "12px", fontSize: "13px" }}>
                        {selectedGraphNode.type === "column" && (
                          <>
                            <div>
                              <span style={{ color: "#a6adc8" }}>特征数据类型：</span>
                              <span style={{ color: "#89dceb", fontWeight: "600" }}>
                                {stringProperty(selectedGraphNode.properties, "type") === "numeric" ? "数值型 (Numeric)" : "分类码 (Categorical)"}
                              </span>
                            </div>
                            <div>
                              <span style={{ color: "#a6adc8" }}>缺失值比率：</span>
                              <span style={{ color: "#f38ba8" }}>{(numberProperty(selectedGraphNode.properties, "missing_rate") * 100).toFixed(2)}%</span>
                            </div>
                            <div style={{ background: "#313244", padding: "8px", borderRadius: "6px", color: "#a6adc8", lineHeight: "1.4", marginTop: "8px" }}>
                              <small>该特征列是模型的重要预测自变量。鼠标悬停其上可追溯其在哪些模型实验中被使用，或受到哪些自进化规则的推荐影响。</small>
                            </div>
                          </>
                        )}

                        {selectedGraphNode.type === "experiment" && (
                          <>
                            <div>
                              <span style={{ color: "#a6adc8" }}>算法引擎：</span>
                              <span style={{ color: "#cba6f7", fontWeight: "600" }}>
                                {stringProperty(selectedGraphNode.properties, "engine", "unknown").toUpperCase()}
                              </span>
                            </div>
                            <div>
                              <span style={{ color: "#a6adc8" }}>模型精度 (Acc)：</span>
                              <span style={{ color: "#a6e3a1", fontWeight: "600" }}>
                                {(numberProperty(selectedGraphNode.properties, "accuracy") * 100).toFixed(2)}%
                              </span>
                            </div>
                            <div>
                              <span style={{ color: "#a6adc8" }}>目标列字段：</span>
                              <span style={{ color: "#f9e2af" }}>{stringProperty(selectedGraphNode.properties, "target_column", "未知")}</span>
                            </div>
                            <div>
                              <span style={{ color: "#a6adc8" }}>训练时间：</span>
                              <span style={{ color: "#bac2de" }}>
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
                              <span style={{ color: "#a6adc8" }}>知识信度：</span>
                              <span style={{ color: "#a6e3a1", fontWeight: "600" }}>
                                {(numberProperty(selectedGraphNode.properties, "confidence") * 100).toFixed(1)}%
                              </span>
                            </div>
                            <div>
                              <span style={{ color: "#a6adc8" }}>注入状态：</span>
                              <span style={{ color: "#f9e2af", fontWeight: "600" }}>
                                {(() => {
                                  const status = lessonStatusProperty(selectedGraphNode.properties);
                                  return status ? statusLabel[status] : stringProperty(selectedGraphNode.properties, "status", "未知");
                                })()}
                              </span>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                              <span style={{ color: "#a6adc8" }}>业务规则推荐 (Recommendation)：</span>
                              <p style={{ color: "#bac2de", background: "#11111b", padding: "8px", borderRadius: "6px", fontSize: "12px", margin: "0", lineHeight: "1.4" }}>
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
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "#6c7086", textAlign: "center", gap: "10px" }}>
                      <HelpCircle size={32} />
                      <p style={{ margin: "0", fontSize: "13px" }}>点击图谱中的任意节点<br/>查看其演进链路与指标详情</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Advanced Insights Section */}
              <section className="insights-section">
                <h3>
                  <Zap size={18} style={{ color: "#fab387" }} />
                  自进化高级洞察 (Self-Evolution Insights)
                </h3>
                {graphData.insights.length === 0 ? (
                  <div className="empty-state compact-empty" style={{ background: "#181825", border: "1px dashed #313244" }}>
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
                              <AlertTriangle size={15} style={{ color: "#f38ba8" }} />
                            ) : (
                              <TrendingUp size={15} style={{ color: "#a6e3a1" }} />
                            )}
                            {insight.title}
                          </span>
                          <span style={{ fontSize: "10px", textTransform: "uppercase", background: "rgba(255,255,255,0.06)", padding: "1px 6px", borderRadius: "4px", color: "#a6adc8" }}>
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
        </div>
      )}
    </main>
  );
}
