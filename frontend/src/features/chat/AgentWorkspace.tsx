import {
  Bot,
  CheckCircle2,
  Command as CommandIcon,
  ExternalLink,
  FileCheck2,
  Route,
  SendHorizontal,
  Sparkles,
  UserRound,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

import type { AgentStreamEvent, WorkflowStageId } from "./types";
import {
  buildCockpitComponentCards,
  selectVisibleCockpitCards,
  type CockpitComponentAction,
  type CockpitComponentCard,
  type CockpitComponentControl,
} from "./componentRegistry";
import { deriveWorkflowCompletionFeedback } from "./completionFeedback";
import { InformationValue } from "./InformationValue";
import { CommandPalette, SlashCommandSuggestions } from "./CommandPalette";
import {
  availableAgentCommands,
  filterAgentCommands,
  quickAgentCommands,
  resolveSlashCommand,
  type AgentCommandDefinition,
} from "./agentCommands";
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
  onApplyFeatureSelection?: (features: string[]) => Promise<void> | void;
  onOpenTrace?: (traceId: string) => void;
  onSelectExperimentRun?: (experimentId: string) => void;
  onSelectFile?: (path: string) => void;
  onSelectTargetColumn?: (column: string) => void;
  onSelectPlanTargetColumn?: (column: string) => Promise<void> | void;
  onSelectPlanStrategies?: (strategies: Record<string, string>) => Promise<void> | void;
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
    tools: ["load_data()", "profile_dataset()", "detect_missing()", "correlation_matrix()"],
  },
  "machine-learning": {
    title: "ML 训练 Agent",
    description: "基于清洗后的数据设计训练计划、选择模型、跟踪实验并导出模型产物。",
    tools: ["load_data()", "build_features()", "train_baseline()", "train_sklearn()"],
  },
};
const toolStatusLabel: Record<ToolActivityStatus, string> = {
  idle: "可用",
  running: "运行中",
  success: "完成",
  error: "失败",
};
const stageKickerLabel: Record<string, string> = {
  ingest: "接入",
  profile: "画像",
  clean: "清洗",
  transform: "变换",
  train: "训练",
  evaluate: "评估",
  diagnose: "诊断",
  iterate: "迭代",
  export: "导出",
  learn: "沉淀",
};
// Agent 常在一次回复里引导用户查看多张卡片（例如"review the model comparison and
// report cards"）。工作流有 10 个阶段，上限过低会让这类引导指向被截断的卡片。
const VISIBLE_COCKPIT_CARDS = 8;

const cockpitStatusLabel: Record<string, string> = {
  ready: "就绪",
  attention: "需关注",
  blocked: "待处理",
  complete: "已完成",
};

type ActionFeedback = {
  kind: "info" | "success" | "warning" | "error";
  message: string;
};

const PLAN_STRATEGY_IDS = ["numeric_imputer", "numeric_scaler", "categorical_imputer"] as const;

/**
 * 从已渲染的计划卡片上读回当前策略。后端每次都是按**完整**策略重算整份计划，
 * 只送改动的那一项会让另外两项悄悄回到默认值。
 */
function planStrategiesFromCards(cards: CockpitComponentCard[]): Record<string, string> {
  const controls = cards.find((card) => card.kind === "preprocessing_plan")?.controls ?? [];
  const strategies: Record<string, string> = {};
  for (const control of controls) {
    if (control.kind === "select" && (PLAN_STRATEGY_IDS as readonly string[]).includes(control.id)) {
      strategies[control.id] = control.value;
    }
  }
  return strategies;
}

/** 后端把产生该消息的 trace 写进 metadata；旧消息可能没有，此时不提供入口。 */
function messageTraceId(message: AgentMessage) {
  const traceId = message.metadata?.trace_id;
  return typeof traceId === "string" && traceId ? traceId : undefined;
}

type CockpitCardProps = {
  card: CockpitComponentCard;
  featureSelectionDraft: string[] | null;
  onRunAction: (action: CockpitComponentAction) => void;
  onRunControl: (control: CockpitComponentControl, value: string) => void;
  onToggleFeature: (
    control: Extract<CockpitComponentControl, { kind: "multi_select" }>,
    value: string,
  ) => void;
};

// 定义在模块作用域而非 AgentWorkspace 内部：内部定义会使每次渲染产生新的组件类型，
// React 因此卸载并重建整张卡片，勾选特征时焦点会丢失、无法连续操作。
function CockpitCard({
  card,
  featureSelectionDraft,
  onRunAction,
  onRunControl,
  onToggleFeature,
}: CockpitCardProps) {
  return (
    <article className={`cockpit-component-card ${card.status}`} data-cockpit-component={card.kind}>
      <div className="cockpit-component-header">
        <div>
          <span className="section-kicker">{stageKickerLabel[card.stage] ?? card.stage}</span>
          <strong>{card.title}</strong>
        </div>
        <span className={`cockpit-component-status ${card.status}`}>
          {cockpitStatusLabel[card.status] ?? card.status}
        </span>
      </div>
      <p>{card.description}</p>
      <div className="cockpit-component-facts">
        {card.facts.map((fact) => (
          <div key={`${card.id}-${fact.label}`}>
            <span>{fact.label}</span>
            <InformationValue label={fact.label} value={fact.value} />
          </div>
        ))}
      </div>
      {card.controls && card.controls.length > 0 ? (
        <div className="cockpit-component-controls">
          {card.controls.map((control) => {
            const descriptionId = control.description
              ? `${card.id}-${control.id}-description`
              : undefined;
            if (control.kind === "multi_select") {
              const selected = featureSelectionDraft ?? control.values;
              return (
                <fieldset
                  aria-describedby={descriptionId}
                  className="cockpit-component-control"
                  key={`${card.id}-${control.id}`}
                >
                  <legend>{control.label}</legend>
                  <div className="cockpit-component-checkboxes">
                    {control.options.map((option) => {
                      // input 置于 label 外并用 htmlFor 关联：label 包裹会把点击再转发给
                      // input，导致一次点击 toggle 两次而净效果为零。
                      const optionId = `${card.id}-${control.id}-${option.value}`;
                      return (
                        <div key={optionId}>
                          <input
                            checked={selected.includes(option.value)}
                            disabled={Boolean(control.disabledReason)}
                            id={optionId}
                            onChange={() => onToggleFeature(control, option.value)}
                            type="checkbox"
                          />
                          <label htmlFor={optionId}>{option.label}</label>
                        </div>
                      );
                    })}
                  </div>
                  {control.description ? <small id={descriptionId}>{control.description}</small> : null}
                </fieldset>
              );
            }
            return (
              <div className="cockpit-component-control" key={`${card.id}-${control.id}`}>
                <span>{control.label}</span>
                <select
                  aria-describedby={descriptionId}
                  aria-label={control.label}
                  disabled={Boolean(control.disabledReason)}
                  onChange={(event) => onRunControl(control, event.target.value)}
                  title={control.disabledReason ?? control.description ?? control.label}
                  value={control.value}
                >
                  {control.value ? null : (
                    <option value="" disabled>
                      请选择
                    </option>
                  )}
                  {control.options.map((option) => (
                    <option key={`${card.id}-${control.id}-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {control.description ? <small id={descriptionId}>{control.description}</small> : null}
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="cockpit-component-actions">
        {card.actions.map((action, index) => (
          <button
            className={action.tone === "primary" ? "primary" : ""}
            disabled={Boolean(action.disabledReason)}
            key={`${card.id}-${action.id}-${index}`}
            onClick={() => onRunAction(action)}
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
  onApplyFeatureSelection,
  onOpenTrace,
  onSelectExperimentRun,
  onSelectFile,
  onSelectTargetColumn,
  onSelectPlanTargetColumn,
  onSelectPlanStrategies,
  onTrainSklearn,
  sendMessage,
}: AgentWorkspaceProps) {
  // 当前文件 / 聚焦实验改为直接订阅 uiStore（替代原先经 AppShell 钻取的 props）。
  const activeFile = useUiStore((state) => state.activeFile);
  const focusedExperimentId = useUiStore((state) => state.focusedExperimentId);
  const copy = modeCopy[mode];
  const [draft, setDraft] = useState("");
  // null 表示未编辑，直接采用计划里的当前特征；编辑后在提交前保持本地草稿。
  const [featureSelectionDraft, setFeatureSelectionDraft] = useState<string[] | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [slashMenuDismissed, setSlashMenuDismissed] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const lastSubmissionRef = useRef<{ content: string; submittedAt: number } | null>(null);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null);
  const workflow = useMemo(() => deriveWorkflowState(events, mode, activeFile), [activeFile, events, mode]);
  const completionFeedback = useMemo(() => deriveWorkflowCompletionFeedback(events), [events]);
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

  const commandContext = useMemo(
    () => ({
      mode,
      activeFile,
      focusedExperimentId,
      preprocessingPlanPath,
      targetColumn: suggestedTargetColumn,
      trainingDatasetPath,
    }),
    [activeFile, focusedExperimentId, mode, preprocessingPlanPath, suggestedTargetColumn, trainingDatasetPath],
  );
  const commands = useMemo(() => availableAgentCommands(mode), [mode]);
  const quickCommands = useMemo(() => quickAgentCommands(mode), [mode]);
  const slashMatch = draft.match(/^\/(\S*)$/);
  const slashCommands = useMemo(
    () => (slashMatch ? filterAgentCommands(commands, slashMatch[1]).slice(0, 6) : []),
    [commands, slashMatch],
  );
  const slashMenuOpen = !commandPaletteOpen && !slashMenuDismissed && Boolean(slashMatch) && slashCommands.length > 0;

  useEffect(() => {
    function openCommandPalette(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
    }
    document.addEventListener("keydown", openCommandPalette);
    return () => document.removeEventListener("keydown", openCommandPalette);
  }, []);

  useEffect(() => {
    setSlashActiveIndex(0);
  }, [draft]);

  function insertCommand(command: AgentCommandDefinition) {
    setDraft(`${command.slash} `);
    setSlashMenuDismissed(false);
    setCommandPaletteOpen(false);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  function submit(content = draft, label = "自定义消息") {
    let text = content.trim();
    if (!text) {
      setActionFeedback({ kind: "warning", message: "请输入需求或选择一个快捷命令。" });
      return false;
    }

    if (text.startsWith("/")) {
      const resolved = resolveSlashCommand(text, commandContext);
      if (!resolved) {
        const unknownCommand = text.split(/\s+/, 1)[0];
        setActionFeedback({ kind: "warning", message: `未知命令 ${unknownCommand}。按 Ctrl+K 查看可用命令。` });
        return false;
      }
      text = resolved.prompt;
      label = resolved.command.label;
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
    setSlashMenuDismissed(false);
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
          // 本地发起的审批在后端没有待办记录，发过去只会得到 approval_not_found，
          // 因此直接就地执行；只有编排器发起的审批才走审批响应通道。
          if (action.payload?.approvalId && action.payload.approvalOrigin !== "local") {
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
        case "apply_feature_selection": {
          const features = featureSelectionDraft;
          if (features === null) {
            setActionFeedback({ kind: "error", message: "特征选择没有变化。" });
            return;
          }
          if (features.length === 0) {
            // 后端也会拒绝空选择；这里就地拦下，避免用户白跑一次重生成
            setActionFeedback({ kind: "error", message: "请至少选择一个特征。" });
            return;
          }
          await onApplyFeatureSelection?.(features);
          setFeatureSelectionDraft(null);
          break;
        }
        case "abandon_task_state":
          await onAbandonTaskState?.(action.payload?.stage ?? "train");
          break;
      }
      setActionFeedback({ kind: "success", message: `${action.label} 已完成。` });
    } catch (error) {
      setActionFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : `${action.label} 失败。`,
      });
    }
  }

  async function runCockpitControl(control: CockpitComponentControl, value: string) {
    if (control.kind !== "select" || !value || value === control.value) return;
    switch (control.id) {
      case "target_column":
        onSelectTargetColumn?.(value);
        setActionFeedback({ kind: "success", message: `目标列已切换为 ${value}。` });
        break;
      case "plan_target_column":
        // 计划围绕目标列算出丢弃列、特征列与管道脚本，所以只能重算整份计划，
        // 不能在计划之外改一个字段——那会让计划与它的派生产物自相矛盾。
        try {
          await onSelectPlanTargetColumn?.(value);
          setActionFeedback({ kind: "success", message: `已按目标列 ${value} 重新生成计划。` });
        } catch (error) {
          setActionFeedback({
            kind: "error",
            message: error instanceof Error ? error.message : `按目标列 ${value} 重新生成计划失败。`,
          });
        }
        break;
      case "numeric_imputer":
      case "numeric_scaler":
      case "categorical_imputer":
        // 三项策略一起送：后端每次都是按完整策略重算整份计划，只送改动的那一项
        // 会让另外两项悄悄回到默认值。当前值从同一张卡片的其余控件上读。
        try {
          await onSelectPlanStrategies?.({ ...planStrategiesFromCards(cockpitCards), [control.id]: value });
          setActionFeedback({ kind: "success", message: `已按新的${control.label}重新生成计划。` });
        } catch (error) {
          setActionFeedback({
            kind: "error",
            message: error instanceof Error ? error.message : `按新的${control.label}重新生成计划失败。`,
          });
        }
        break;
    }
  }

  function toggleFeature(control: Extract<CockpitComponentControl, { kind: "multi_select" }>, value: string) {
    const current = featureSelectionDraft ?? control.values;
    setFeatureSelectionDraft(
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
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
          <span className="runtime-chip ready">内核: Python 3.11</span>
          <span className="runtime-chip">工具: 20</span>
          <span className="runtime-chip muted">GPU: 未启用</span>
        </div>
      </div>

      {lastError ? <div className="inline-alert">{lastError}</div> : null}

      <section className="workflow-cockpit" aria-label="Agent 工作流状态">
        <div className="workflow-cockpit-summary">
          <div>
            <span className="section-kicker">工作流</span>
            <strong>{workflow.currentStage.label}</strong>
          </div>
          <div className="workflow-cockpit-summary-copy">
            <p>{workflow.nextAction}</p>
            {completionFeedback ? (
              <div
                aria-atomic="true"
                aria-label="最新工作流完成"
                aria-live="polite"
                className="workflow-completion-feedback"
                data-completion-kind={completionFeedback.kind}
                key={completionFeedback.id}
                role="status"
              >
                {completionFeedback.kind === "artifact" ? (
                  <FileCheck2 aria-hidden="true" size={16} />
                ) : (
                  <CheckCircle2 aria-hidden="true" size={16} />
                )}
                <div>
                  <span>{completionFeedback.label}</span>
                  <strong>{completionFeedback.title}</strong>
                  {completionFeedback.detail ? (
                    <InformationValue label="产物路径" value={completionFeedback.detail} />
                  ) : null}
                </div>
                {completionFeedback.artifactPath && onSelectFile ? (
                  <button
                    aria-label={`打开已完成产物 ${completionFeedback.title}`}
                    onClick={() => onSelectFile(completionFeedback.artifactPath!)}
                    type="button"
                  >
                    打开产物
                    <ExternalLink aria-hidden="true" size={14} />
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div
          aria-label="工作流阶段，可横向滚动"
          className="workflow-stage-strip"
          role="list"
          tabIndex={0}
        >
          {workflow.stages.map((stage, index) => (
            /* status 同时出现在 class 与 data 属性上：class 供样式，data 供断言。
               只靠 class 的话测试得解析类名字符串，加一个修饰类就会误判。 */
            <div
              className={`workflow-stage ${stage.status}`}
              data-workflow-stage={stage.id}
              data-workflow-status={stage.status}
              key={stage.id}
              role="listitem"
            >
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
            <span className="section-kicker">审批</span>
            <strong>{workflow.approval ? workflow.approval.title : "无待审批"}</strong>
            {workflow.approval?.description ? <small>{workflow.approval.description}</small> : null}
          </div>
          <div>
            <span className="section-kicker">组件</span>
            <strong>{workflow.component ? workflow.component.title : "检查器跟随产物"}</strong>
            {workflow.component?.artifactPath ? (
              <InformationValue label="组件产物" value={workflow.component.artifactPath} />
            ) : null}
          </div>
          <div>
            <span className="section-kicker">产物</span>
            <strong>{workflow.latestArtifact ? workflow.latestArtifact.name : activeFile || "无活动文件"}</strong>
            <InformationValue label="产物路径" value={workflow.latestArtifact?.path ?? (activeFile || "无活动文件")} />
          </div>
        </div>
        {cockpitCards.length > 0 ? (
          <div className="cockpit-component-grid" aria-label="Agent 上下文工具">
            {selectVisibleCockpitCards(cockpitCards, VISIBLE_COCKPIT_CARDS).map((card) => (
              <CockpitCard
                card={card}
                featureSelectionDraft={featureSelectionDraft}
                key={card.id}
                onRunAction={(action) => void runCockpitAction(action)}
                onRunControl={runCockpitControl}
                onToggleFeature={toggleFeature}
              />
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
                {historyMessage.role !== "user" && messageTraceId(historyMessage) ? (
                  <button
                    className="message-trace-link"
                    onClick={() => onOpenTrace?.(messageTraceId(historyMessage) as string)}
                    type="button"
                  >
                    <Route aria-hidden="true" size={12} />
                    查看该回复的执行链路
                  </button>
                ) : null}
              </div>
            </div>
          ))
        ) : (
          <div className="conversation-empty">
            <Sparkles size={22} />
            <strong>{copy.title}</strong>
            <p>{copy.description}</p>
            <p className="conversation-empty-hint">
              选择或上传数据文件，然后在下方描述你的目标——我会规划并执行工作流，结果会显示在右侧检查面板。
            </p>
          </div>
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

      <div className="composer-shell">
        {slashMenuOpen ? (
          <SlashCommandSuggestions activeIndex={slashActiveIndex} commands={slashCommands} onChoose={insertCommand} />
        ) : null}
        <div className="composer">
          <button
            aria-label="打开命令面板（Ctrl/Command+K）"
            className="composer-command-trigger"
            onClick={() => setCommandPaletteOpen(true)}
            title="打开命令面板 (Ctrl/Command+K)"
            type="button"
          >
            <CommandIcon aria-hidden="true" size={16} />
            <kbd>Ctrl K</kbd>
          </button>
          <textarea
            aria-controls={slashMenuOpen ? "slash-command-results" : undefined}
            aria-label="Agent 输入"
            placeholder="描述目标，输入 / 查看命令，或按 Ctrl+K"
            ref={composerRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setSlashMenuDismissed(false);
            }}
            onKeyDown={(event) => {
              if (slashMenuOpen && event.key === "ArrowDown") {
                event.preventDefault();
                setSlashActiveIndex((current) => (current + 1) % slashCommands.length);
                return;
              }
              if (slashMenuOpen && event.key === "ArrowUp") {
                event.preventDefault();
                setSlashActiveIndex((current) => (current - 1 + slashCommands.length) % slashCommands.length);
                return;
              }
              if (slashMenuOpen && event.key === "Escape") {
                event.preventDefault();
                setSlashMenuDismissed(true);
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (resolveSlashCommand(draft, commandContext) || !slashMenuOpen) {
                  submit(draft);
                } else if (slashCommands[slashActiveIndex]) {
                  insertCommand(slashCommands[slashActiveIndex]);
                }
              }
            }}
          />
          <button
            aria-label="发送消息"
            className="composer-send"
            disabled={!connected || !projectId || !draft.trim()}
            onClick={() => submit(draft)}
            title="发送"
            type="button"
          >
            <SendHorizontal aria-hidden="true" size={17} />
          </button>
        </div>
      </div>

      <div className="quick-actions">
        {quickCommands.map((command) => (
          <button
            disabled={!connected || !projectId}
            key={command.id}
            onClick={() => submit(command.buildPrompt(commandContext), command.label)}
            type="button"
          >
            {command.label}
          </button>
        ))}
      </div>
      {commandPaletteOpen ? (
        <CommandPalette mode={mode} onChoose={insertCommand} onClose={() => setCommandPaletteOpen(false)} />
      ) : null}
    </main>
  );
}
