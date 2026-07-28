import { action } from "./primitives";
import type { CardBuilderContext, CockpitComponentCard } from "./types";

export function buildRecoveryCards(ctx: CardBuilderContext): CockpitComponentCard[] {
  const { input, projectDisabled } = ctx;
  const retryableEvaluationFailure = Boolean(
    input.workflow.currentStage.id === "evaluate" &&
      input.workflow.currentStage.status === "failed" &&
      input.workflow.currentStage.retryable,
  );
  const retryableExportFailure = Boolean(
    input.workflow.currentStage.id === "export" &&
      input.workflow.currentStage.status === "failed" &&
      input.workflow.currentStage.retryable,
  );
  const retryableLearnFailure = Boolean(
    input.workflow.currentStage.id === "learn" &&
      input.workflow.currentStage.status === "failed" &&
      input.workflow.currentStage.retryable,
  );
  const taskInspection = input.taskStateInspection;
  const cards: CockpitComponentCard[] = [];

  if (taskInspection) {
    const inspectionArtifactLabel =
      taskInspection.stage === "evaluate" && taskInspection.planPath
        ? "打开指标"
        : taskInspection.stage === "export" && taskInspection.planPath
          ? "打开报告"
        : taskInspection.planPath
          ? "打开计划"
          : "打开数据集";
    const inspectionArtifactDisabledReason =
      taskInspection.planPath || taskInspection.datasetPath
        ? undefined
        : "没有可用的已保存数据集、计划或指标路径。";

    cards.push({
      id: "task-state-inspector",
      kind: "task_state_inspector",
      stage: taskInspection.stage,
      title: taskInspection.title,
      description: taskInspection.description,
      artifactPath: taskInspection.planPath ?? taskInspection.datasetPath,
      status: "attention",
      facts: taskInspection.facts,
      actions: [
        ...(taskInspection.stage === "evaluate"
          ? [
              action("retry_evaluation_report", "重试评估", {
                disabledReason: projectDisabled,
                payload: { stage: "evaluate" },
                tone: "primary" as const,
              }),
            ]
          : []),
        ...(taskInspection.stage === "export"
          ? [
              action("retry_export_bundle", "重试导出", {
                disabledReason: projectDisabled,
                payload: { stage: "export" },
                tone: "primary" as const,
              }),
            ]
          : []),
        ...(taskInspection.stage === "learn"
          ? [
              action("retry_lesson_extraction", "重试沉淀", {
                disabledReason: projectDisabled,
                payload: { stage: "learn" },
                tone: "primary" as const,
              }),
            ]
          : []),
        action("inspect_logs", "查看日志", {
          payload: { taskId: taskInspection.taskId },
          tone: ["evaluate", "export", "learn"].includes(taskInspection.stage) ? "secondary" : "primary",
        }),
        action("open_artifact", inspectionArtifactLabel, {
          disabledReason: inspectionArtifactDisabledReason,
          payload: { path: taskInspection.planPath ?? taskInspection.datasetPath },
          tone: "secondary",
        }),
        action("abandon_task_state", "放弃状态", {
          disabledReason: taskInspection.taskId ? undefined : "没有可用的已保存任务状态 id。",
          payload: { taskId: taskInspection.taskId, stage: taskInspection.stage },
          tone: "secondary",
        }),
      ],
    });
  }

  if (retryableEvaluationFailure && !cards.some((card) => card.id === "task-state-inspector")) {
    cards.push({
      id: "evaluation-retry",
      kind: "evaluation_report",
      stage: "evaluate",
      title: "评估报告失败",
      description:
        "训练后的评估/报告步骤失败。修复缺失的指标或报告依赖后，从已保存的评估状态重试。",
      status: "attention",
      facts: [
        { label: "阶段", value: "评估" },
        { label: "下一步", value: "重试已保存的评估/报告步骤。" },
      ],
      actions: [
        action("retry_evaluation_report", "重试评估", {
          disabledReason: projectDisabled,
          payload: { stage: "evaluate" },
          tone: "primary",
        }),
      ],
    });
  }

  if (retryableExportFailure && !cards.some((card) => card.id === "task-state-inspector")) {
    cards.push({
      id: "export-retry",
      kind: "export_bundle",
      stage: "export",
      title: "导出包失败",
      description:
        "模型交接包写入失败。修复缺失的产物或文件系统访问后重试导出。",
      status: "attention",
      facts: [
        { label: "阶段", value: "导出" },
        { label: "下一步", value: "重试已保存的导出包步骤。" },
      ],
      actions: [
        action("retry_export_bundle", "重试导出", {
          disabledReason: projectDisabled,
          payload: { stage: "export" },
          tone: "primary",
        }),
      ],
    });
  }

  if (retryableLearnFailure && !cards.some((card) => card.id === "task-state-inspector")) {
    cards.push({
      id: "learn-retry",
      kind: "lesson_review",
      stage: "learn",
      title: "经验沉淀失败",
      description:
        "经验提取步骤无法读取或转换已保存的证据。恢复会话证据后重试沉淀。",
      status: "attention",
      facts: [
        { label: "阶段", value: "沉淀" },
        { label: "下一步", value: "从已保存的会话上下文重试经验提取。" },
      ],
      actions: [
        action("retry_lesson_extraction", "重试沉淀", {
          disabledReason: projectDisabled,
          payload: { stage: "learn" },
          tone: "primary",
        }),
      ],
    });
  }

  return cards;
}
