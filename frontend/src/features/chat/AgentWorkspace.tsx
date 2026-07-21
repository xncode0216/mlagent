import { Bot, CheckCircle2, Database, FileCode2, SendHorizontal, Sparkles, UserRound } from "lucide-react";
import { lazy, Suspense, useMemo, useRef, useState } from "react";

import type { AgentStreamEvent, WorkflowStageId } from "./types";
import {
  buildCockpitComponentCards,
  type CockpitComponentAction,
  type CockpitComponentCard,
} from "./componentRegistry";
import type { TaskStateInspection } from "./taskStateInspector";
import { buildToolActivitySummaries, type ToolActivityStatus } from "./toolActivity";
import { deriveWorkflowState } from "./workflowState";
import type { AgentMessage } from "../../lib/api";
import { useUiStore } from "../../app/uiStore";

// Lazy so react-markdown + highlight.js load only when an agent message needs
// Markdown rendering, keeping them out of the initial bundle.
const MarkdownMessage = lazy(() => import("./MarkdownMessage"));

type AgentWorkspaceProps = {
  mode: "analysis" | "machine-learning";
  connected: boolean;
  events: AgentStreamEvent[];
  historyMessages: AgentMessage[];
  lastError: string | null;
  preprocessingPlanPath?: string | null;
  projectId?: string;
  suggestedTargetColumn?: string;
  taskStateInspection?: TaskStateInspection | null;
  trainingDatasetPath?: string;
  onExecutePreprocessingPlan?: (preprocessingPlanPath?: string | null) => Promise<void>;
  onAbandonTaskState?: (stage: WorkflowStageId) => Promise<void>;
  onExportRunBundle?: (experimentId: string) => Promise<void>;
  onExtractLessons?: (sourceSessionId?: string) => Promise<void>;
  onGeneratePreprocessingPlan?: () => Promise<void>;
  onGenerateProfile?: () => Promise<void>;
  onOpenTraining?: () => void;
  onOpenLogs?: (taskId?: string) => void;
  onRespondToApproval?: (approvalId: string, decision: "execute" | "revise", preprocessingPlanPath?: string | null) => void;
  onRegenerateEvaluationReport?: (experimentId: string) => Promise<void>;
  onResumeStep?: (stage: WorkflowStageId) => void;
  onRetryEvaluation?: () => Promise<void>;
  onRetryExport?: () => Promise<void>;
  onRetryLearning?: () => Promise<void>;
  onRetrySklearnTraining?: () => Promise<void>;
  onSelectExperimentRun?: (experimentId: string) => void;
  onSelectFile?: (path: string) => void;
  onTrainSklearn?: (targetColumn: string, preprocessingPlanPath?: string | null, datasetPath?: string) => Promise<void>;
  sendMessage: (
    content: string,
    context: {
      projectId?: string;
      activeFile?: string;
      experimentId?: string | null;
      mode?: string;
      preprocessingPlanPath?: string | null;
      targetColumn?: string;
      trainingDatasetPath?: string;
    },
  ) => void;
};

const modeCopy = {
  analysis: {
    title: "数据分析 Agent",
    description: "面向当前项目文件执行探索、清洗、统计分析和经验沉淀。",
    assistant:
      "我会先完成数据概览和质量检测，然后把结果同步到右侧图表、数据和日志面板。你也可以直接在底部输入新的分析需求。",
    plan: ["加载数据并概览", "检测缺失值", "分析字段相关性", "生成清洗建议", "沉淀可复用经验"],
    tools: ["load_data()", "profile_dataset()", "detect_missing()", "correlation_matrix()"],
    primaryQuick: "示例分析",
    secondaryQuick: "清洗与特征",
    tertiaryQuick: "建模评估",
    primaryPrompt: (file: string) => `分析 ${file} 的缺失值和相关性`,
    secondaryPrompt: (file: string) => `为 ${file} 生成清洗方案和特征工程建议`,
    tertiaryPrompt: (file: string) => `根据 ${file} 判断是否适合进入机器学习建模`,
    code: (file: string) => `import pandas as pd

df = pd.read_csv('${file}')
profile = df.describe(include='all')
missing = df.isnull().mean().sort_values(ascending=False)
corr = df.select_dtypes('number').corr()`,
  },
  "machine-learning": {
    title: "ML 训练 Agent",
    description: "基于清洗后的数据设计训练计划、选择模型、跟踪实验并导出模型产物。",
    assistant:
      "我会先确认目标列、数据切分和评估指标，再启动 baseline/sklearn 训练；如果需要 GPU，会在训练前明确请求。",
    plan: ["确认目标列与任务类型", "划分 Train/Valid/Test", "训练 baseline", "比较 sklearn 候选模型", "导出最佳模型与实验经验"],
    tools: ["load_data()", "build_features()", "train_baseline()", "train_sklearn()"],
    primaryQuick: "启动训练计划",
    secondaryQuick: "申请 GPU",
    tertiaryQuick: "对比实验",
    primaryPrompt: (file: string) => `基于 ${file} 制定 churn 预测训练计划`,
    secondaryPrompt: (file: string) => `评估 ${file} 是否需要 GPU 训练，并说明原因`,
    tertiaryPrompt: (file: string) => `对 ${file} 的历史实验进行模型对比和导出建议`,
    code: (file: string) => `from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier

df = pd.read_csv('${file}')
X = df.drop(columns=['churn'])
y = df['churn']
X_train, X_valid, y_train, y_valid = train_test_split(X, y, stratify=y)`,
  },
};
const sampleRows = [
  ["7590-VHVEG", "1", "29.85", "No"],
  ["5575-GNVDE", "34", "56.95", "No"],
  ["3668-QPYBK", "2", "53.85", "Yes"],
  ["7795-CFOCW", "45", "42.30", "No"],
];

const toolStatusLabel: Record<ToolActivityStatus, string> = {
  idle: "可用",
  running: "运行中",
  success: "完成",
  error: "失败",
};

type ActionFeedback = {
  kind: "info" | "success" | "warning" | "error";
  message: string;
};

export function AgentWorkspace({
  mode,
  connected,
  events,
  historyMessages,
  lastError,
  preprocessingPlanPath,
  projectId,
  suggestedTargetColumn,
  taskStateInspection,
  trainingDatasetPath,
  onExecutePreprocessingPlan,
  onAbandonTaskState,
  onExportRunBundle,
  onExtractLessons,
  onGeneratePreprocessingPlan,
  onGenerateProfile,
  onOpenTraining,
  onOpenLogs,
  onRespondToApproval,
  onRegenerateEvaluationReport,
  onResumeStep,
  onRetryEvaluation,
  onRetryExport,
  onRetryLearning,
  onRetrySklearnTraining,
  onSelectExperimentRun,
  onSelectFile,
  onTrainSklearn,
  sendMessage,
}: AgentWorkspaceProps) {
  // 当前文件 / 聚焦实验改为直接订阅 uiStore（替代原先经 AppShell 钻取的 props）。
  const activeFile = useUiStore((state) => state.activeFile);
  const focusedExperimentId = useUiStore((state) => state.focusedExperimentId);
  const copy = modeCopy[mode];
  const [draft, setDraft] = useState("");
  const lastSubmissionRef = useRef<{ content: string; submittedAt: number } | null>(null);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null);
  const workflow = useMemo(() => deriveWorkflowState(events, mode, activeFile), [activeFile, events, mode]);
  const cockpitCards = useMemo(
    () =>
      buildCockpitComponentCards({
        activeFile,
        events,
        mode,
        preprocessingPlanPath,
        projectId,
        suggestedTargetColumn,
        taskStateInspection,
        trainingDatasetPath,
        workflow,
      }),
    [
      activeFile,
      events,
      mode,
      preprocessingPlanPath,
      projectId,
      suggestedTargetColumn,
      taskStateInspection,
      trainingDatasetPath,
      workflow,
    ],
  );
  const message = events
    .filter((event) => event.type === "message_delta")
    .map((event) => event.delta)
    .join("");
  const toolEvents = events.filter(
    (event) => event.type === "tool_call_started" || event.type === "tool_started" || event.type === "tool_call_finished",
  );
  const progressEvents = events.filter((event) => event.type === "task_progress");
  const latestProgress = progressEvents.at(-1);
  const latestRuleMatch = [...events]
    .reverse()
    .find((event): event is Extract<AgentStreamEvent, { type: "rules_matched" }> => event.type === "rules_matched");
  const streamingMessage = message.trim();
  const toolNames = useMemo(() => {
    return buildToolActivitySummaries(toolEvents, copy.tools);
  }, [copy.tools, toolEvents]);

  function submit(content = draft, label = "自定义消息") {
    const text = content.trim();
    if (!text) {
      setActionFeedback({ kind: "warning", message: "请输入需求或选择一个快捷命令。" });
      return false;
    }
    if (!projectId) {
      setActionFeedback({ kind: "error", message: "当前还没有可用项目，无法发送任务。" });
      return false;
    }
    if (!connected) {
      setActionFeedback({ kind: "error", message: "后端 WebSocket 尚未连接，任务没有发送。" });
      return false;
    }

    const now = Date.now();
    const lastSubmission = lastSubmissionRef.current;
    if (lastSubmission?.content === text && now - lastSubmission.submittedAt < 3000) {
      setActionFeedback({ kind: "warning", message: `${label} 已发送，等待 Agent 返回后再重复执行。` });
      return false;
    }

    lastSubmissionRef.current = { content: text, submittedAt: now };
    sendMessage(text, {
      projectId,
      activeFile,
      experimentId: focusedExperimentId,
      mode,
      preprocessingPlanPath,
      targetColumn: suggestedTargetColumn,
      trainingDatasetPath,
    });
    setActionFeedback({ kind: "success", message: `已发送：${label}。可在右侧日志查看执行事件。` });
    setDraft("");
    return true;
  }

  async function runCockpitAction(action: CockpitComponentAction) {
    if (action.disabledReason) {
      setActionFeedback({ kind: "warning", message: action.disabledReason });
      return;
    }

    setActionFeedback({ kind: "info", message: `${action.label}...` });
    try {
      switch (action.id) {
        case "generate_profile":
          await onGenerateProfile?.();
          break;
        case "generate_preprocessing_plan":
          await onGeneratePreprocessingPlan?.();
          break;
        case "open_artifact":
          if (action.payload?.path) onSelectFile?.(action.payload.path);
          break;
        case "approve_preprocessing_plan":
          if (action.payload?.approvalId) {
            onRespondToApproval?.(action.payload.approvalId, "execute", action.payload.preprocessingPlanPath);
          } else {
            await onExecutePreprocessingPlan?.(action.payload?.preprocessingPlanPath);
          }
          break;
        case "revise_preprocessing_plan":
          if (action.payload?.approvalId) {
            onRespondToApproval?.(action.payload.approvalId, "revise", action.payload.preprocessingPlanPath);
          }
          break;
        case "execute_preprocessing_plan":
          await onExecutePreprocessingPlan?.(action.payload?.preprocessingPlanPath);
          break;
        case "retry_transform":
          onResumeStep?.(action.payload?.stage ?? "transform");
          break;
        case "inspect_logs":
          onOpenLogs?.(action.payload?.taskId);
          break;
        case "open_training":
          onOpenTraining?.();
          break;
        case "start_sklearn_training":
          await onTrainSklearn?.(
            action.payload?.targetColumn ?? suggestedTargetColumn ?? "churn",
            action.payload?.preprocessingPlanPath,
            action.payload?.datasetPath ?? action.payload?.path,
          );
          break;
        case "retry_sklearn_training":
          await onRetrySklearnTraining?.();
          break;
        case "select_experiment_run": {
          const experimentId = action.payload?.experimentId;
          const intent = action.payload?.intent ?? "evaluate";
          if (experimentId) {
            onSelectExperimentRun?.(experimentId);
            sendMessage(`${intent} experiment ${experimentId}`, {
              projectId,
              activeFile,
              experimentId,
              mode,
              preprocessingPlanPath,
              targetColumn: suggestedTargetColumn,
              trainingDatasetPath,
            });
          }
          break;
        }
        case "select_training_dataset": {
          const datasetPath = action.payload?.datasetPath;
          const targetColumn = action.payload?.targetColumn ?? suggestedTargetColumn;
          if (datasetPath) {
            sendMessage(`train on ${datasetPath}`, {
              projectId,
              activeFile,
              mode,
              preprocessingPlanPath,
              targetColumn,
              trainingDatasetPath: datasetPath,
            });
          }
          break;
        }
        case "retry_evaluation_report":
          await onRetryEvaluation?.();
          break;
        case "regenerate_evaluation_report":
          if (action.payload?.experimentId) await onRegenerateEvaluationReport?.(action.payload.experimentId);
          break;
        case "export_run_bundle":
          if (action.payload?.experimentId) await onExportRunBundle?.(action.payload.experimentId);
          break;
        case "extract_lessons":
          await onExtractLessons?.(action.payload?.sourceSessionId);
          break;
        case "retry_export_bundle":
          await onRetryExport?.();
          break;
        case "retry_lesson_extraction":
          await onRetryLearning?.();
          break;
        case "abandon_task_state":
          await onAbandonTaskState?.(action.payload?.stage ?? "train");
          break;
      }
      setActionFeedback({ kind: "success", message: `${action.label} completed.` });
    } catch (error) {
      setActionFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : `${action.label} failed.`,
      });
    }
  }

  function CockpitCard({ card }: { card: CockpitComponentCard }) {
    return (
      <article className={`cockpit-component-card ${card.status}`} data-cockpit-component={card.kind}>
        <div className="cockpit-component-header">
          <div>
            <span className="section-kicker">{card.stage}</span>
            <strong>{card.title}</strong>
          </div>
          <span className={`cockpit-component-status ${card.status}`}>{card.status}</span>
        </div>
        <p>{card.description}</p>
        <div className="cockpit-component-facts">
          {card.facts.map((fact) => (
            <div key={`${card.id}-${fact.label}`}>
              <span>{fact.label}</span>
              <code>{fact.value}</code>
            </div>
          ))}
        </div>
        <div className="cockpit-component-actions">
          {card.actions.map((action, index) => (
            <button
              className={action.tone === "primary" ? "primary" : ""}
              disabled={Boolean(action.disabledReason)}
              key={`${card.id}-${action.id}-${index}`}
              onClick={() => void runCockpitAction(action)}
              title={action.disabledReason ?? action.label}
              type="button"
            >
              {action.label}
            </button>
          ))}
        </div>
      </article>
    );
  }

  return (
    <main className="agent-workspace">
      <div className="agent-header workbench-header">
        <div>
          <h2>
            <Bot size={18} />
            {copy.title}
          </h2>
          <p>{copy.description}</p>
        </div>
        <div className="runtime-chips" aria-label="运行环境">
          <span className="runtime-chip ready">Kernel: Python 3.11</span>
          <span className="runtime-chip">Tools: 20</span>
          <span className="runtime-chip muted">GPU: 未启用</span>
        </div>
      </div>

      {lastError ? <div className="inline-alert">{lastError}</div> : null}

      <section className="workflow-cockpit" aria-label="Agent workflow state">
        <div className="workflow-cockpit-summary">
          <div>
            <span className="section-kicker">Workflow</span>
            <strong>{workflow.currentStage.label}</strong>
          </div>
          <p>{workflow.nextAction}</p>
        </div>
        <div className="workflow-stage-strip" role="list">
          {workflow.stages.map((stage, index) => (
            <div className={`workflow-stage ${stage.status}`} data-workflow-stage={stage.id} key={stage.id} role="listitem">
              <span className="workflow-stage-index">{index + 1}</span>
              <div>
                <strong>{stage.label}</strong>
                <small>{stage.detail}</small>
              </div>
            </div>
          ))}
        </div>
        <div className="workflow-signal-grid">
          <div>
            <span className="section-kicker">Approval</span>
            <strong>{workflow.approval ? workflow.approval.title : "No pending approval"}</strong>
            {workflow.approval?.description ? <small>{workflow.approval.description}</small> : null}
          </div>
          <div>
            <span className="section-kicker">Component</span>
            <strong>{workflow.component ? workflow.component.title : "Inspector follows artifacts"}</strong>
            {workflow.component?.artifactPath ? <small>{workflow.component.artifactPath}</small> : null}
          </div>
          <div>
            <span className="section-kicker">Artifact</span>
            <strong>{workflow.latestArtifact ? workflow.latestArtifact.name : activeFile || "No active file"}</strong>
            <small>{workflow.latestArtifact?.path ?? activeFile}</small>
          </div>
        </div>
        {cockpitCards.length > 0 ? (
          <div className="cockpit-component-grid" aria-label="Agent contextual tools">
            {cockpitCards.slice(0, 4).map((card) => (
              <CockpitCard card={card} key={card.id} />
            ))}
          </div>
        ) : null}
      </section>

      <div className="conversation-stream">
        {historyMessages.length > 0 ? (
          historyMessages.map((historyMessage) => (
            <div className={`chat-row ${historyMessage.role === "user" ? "user" : "agent"}`} key={historyMessage.id}>
              <div className={`avatar ${historyMessage.role === "user" ? "user-avatar" : "agent-avatar"}`}>
                {historyMessage.role === "user" ? <UserRound size={16} /> : <Sparkles size={16} />}
              </div>
              <div className={`message-card ${historyMessage.role === "user" ? "user-message" : "agent-message"}`}>
                <span className="message-label">
                  {historyMessage.role === "user" ? "你" : copy.title} · {new Date(historyMessage.created_at).toLocaleTimeString()}
                </span>
                {historyMessage.role === "user" ? (
                  <p>{historyMessage.content}</p>
                ) : (
                  <Suspense fallback={<p>{historyMessage.content}</p>}>
                    <MarkdownMessage content={historyMessage.content} />
                  </Suspense>
                )}
              </div>
            </div>
          ))
        ) : (
          <>
            <div className="chat-row user">
              <div className="avatar user-avatar">
                <UserRound size={16} />
              </div>
              <div className="message-card user-message">
                <span className="message-label">你 · 10:21</span>
                请分析 <code>{activeFile}</code> 的缺失值、字段类型和相关性，并给出可执行的数据处理建议。
              </div>
            </div>

            <div className="chat-row agent">
              <div className="avatar agent-avatar">
                <Sparkles size={16} />
              </div>
              <div className="message-card agent-message">
                <span className="message-label">{copy.title} · 10:21</span>
                <p>{copy.assistant}</p>
                <div className="plan-card">
                  <div className="panel-title">执行计划</div>
                  <div className="plan-grid">
                    {copy.plan.map((step, index) => (
                      <span key={step}>
                        <CheckCircle2 size={14} />
                        {index + 1}. {step}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {streamingMessage ? (
          <div className="chat-row agent">
            <div className="avatar agent-avatar">
              <Sparkles size={16} />
            </div>
            <div className="message-card agent-message">
              <span className="message-label">{copy.title} · 正在回复</span>
              <Suspense fallback={<p>{streamingMessage}</p>}>
                <MarkdownMessage content={streamingMessage} />
              </Suspense>
            </div>
          </div>
        ) : null}
      </div>

      <section className="analysis-grid" aria-label="分析结果预览">
        <div className="workbench-card">
          <div className="card-heading">
            <Database size={15} />
            数据预览（前 4 行）
          </div>
          <div className="compact-table">
            <table>
              <thead>
                <tr>
                  <th>customer_id</th>
                  <th>tenure</th>
                  <th>monthly_charges</th>
                  <th>churn</th>
                </tr>
              </thead>
              <tbody>
                {sampleRows.map((row) => (
                  <tr key={row[0]}>
                    {row.map((cell) => (
                      <td key={cell}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="workbench-card">
          <div className="card-heading">
            <FileCode2 size={15} />
            分析代码
          </div>
          <pre className="code-preview">{copy.code(activeFile)}</pre>
        </div>
      </section>

      <div className="tool-strip">
        {latestRuleMatch && latestRuleMatch.matched_rules.length > 0 ? (
          <div className="matched-rules-panel">
            <strong>命中的历史经验</strong>
            <div>
              {latestRuleMatch.matched_rules.map((rule) => (
                <span key={rule.lesson_id}>
                  {rule.lesson_id.slice(0, 8)} · {Math.round(rule.score * 100)}%
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {toolNames.map((tool) => (
          <span
            key={tool.id}
            className={`tool-chip ${tool.status}`}
            title={tool.detail ? `${tool.label}: ${tool.detail}` : tool.label}
          >
            {tool.label}
            {tool.count > 1 ? ` x${tool.count}` : ""}
            {tool.status !== "idle" ? ` · ${toolStatusLabel[tool.status]}` : ""}
          </span>
        ))}
        {latestProgress ? <span className="tool-chip progress">{Math.round(latestProgress.progress * 100)}% · {latestProgress.label}</span> : null}
      </div>

      {actionFeedback ? (
        <div className={`action-feedback ${actionFeedback.kind}`} role={actionFeedback.kind === "error" ? "alert" : "status"}>
          {actionFeedback.message}
        </div>
      ) : null}

      <div className="composer">
        <textarea
          aria-label="Agent 输入"
          placeholder="输入你的数据分析需求，或输入 / 查看可用命令"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit(draft);
            }
          }}
        />
        <button
          aria-label="发送消息"
          disabled={!connected || !projectId || !draft.trim()}
          onClick={() => submit(draft)}
          title="发送"
          type="button"
        >
          <SendHorizontal size={17} />
        </button>
      </div>

      <div className="quick-actions">
        <button disabled={!connected || !projectId} onClick={() => submit(copy.primaryPrompt(activeFile), copy.primaryQuick)}>
          {copy.primaryQuick}
        </button>
        <button disabled={!connected || !projectId} onClick={() => submit(copy.secondaryPrompt(activeFile), copy.secondaryQuick)}>
          {copy.secondaryQuick}
        </button>
        <button disabled={!connected || !projectId} onClick={() => submit(copy.tertiaryPrompt(activeFile), copy.tertiaryQuick)}>
          {copy.tertiaryQuick}
        </button>
      </div>
    </main>
  );
}
