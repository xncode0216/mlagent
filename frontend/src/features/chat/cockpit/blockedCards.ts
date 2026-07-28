import type { WorkflowStageId } from "../types";
import {
  action,
  datasetCandidateFacts,
  datasetCandidateLabel,
  datasetCandidateTarget,
  runCandidateFacts,
  runCandidateLabel,
  stringValue,
} from "./primitives";
import type { CardBuilderContext, CockpitComponentCard } from "./types";

export function buildBlockedCards(ctx: CardBuilderContext): CockpitComponentCard[] {
  const { input, projectDisabled, missingRunCommand, missingDatasetCommand } = ctx;
  const missingRunCandidates = missingRunCommand?.command.candidate_runs ?? [];
  const missingDatasetCandidates = missingDatasetCommand?.command.candidate_datasets ?? [];
  const cards: CockpitComponentCard[] = [];

  if (missingRunCommand) {
    const intent = missingRunCommand.command.intent;
    const stage = (
      intent === "diagnose" || intent === "export" || intent === "evaluate" ? intent : input.workflow.currentStage.id
    ) as WorkflowStageId;
    cards.push({
      id: "experiment-run-selection",
      kind: "experiment_run_selection",
      stage,
      title: "选择实验运行",
      description:
        "智能体发现了多个已完成的运行。请先选择要继续的运行，再打开评估、诊断或导出卡片。",
      status: "blocked",
      facts: [
        { label: "缺少", value: "experiment_id" },
        { label: "意图", value: intent },
        { label: "候选数", value: String(missingRunCandidates.length) },
        ...missingRunCandidates.slice(0, 3).flatMap((candidate, index) => [
          { label: `运行 ${index + 1}`, value: runCandidateFacts(candidate) },
          { label: `运行 ${index + 1} ID`, value: stringValue(candidate.experiment_id) ?? "-" },
        ]),
      ],
      actions: missingRunCandidates.slice(0, 5).map((candidate, index) =>
        action("select_experiment_run", `选择 ${runCandidateLabel(candidate)}`, {
          disabledReason: projectDisabled ?? (stringValue(candidate.experiment_id) ? undefined : "此运行缺少 id。"),
          payload: {
            experimentId: stringValue(candidate.experiment_id),
            intent,
            stage,
          },
          tone: index === 0 ? "primary" : "secondary",
        }),
      ),
    });
  }

  if (missingDatasetCommand) {
    const intent = missingDatasetCommand.command.intent;
    const stage = (
      intent === "train" || intent === "profile" || intent === "clean" || intent === "transform"
        ? intent
        : input.workflow.currentStage.id
    ) as WorkflowStageId;
    cards.push({
      id: "dataset-selection",
      kind: "dataset_selection",
      stage,
      title: "选择训练数据集",
      description:
        "智能体需要一个明确的数据集才能配置训练。请选择源数据集，以保证运行可审计。",
      status: "blocked",
      facts: [
        { label: "缺少", value: "dataset_path" },
        { label: "意图", value: intent },
        { label: "候选数", value: String(missingDatasetCandidates.length) },
        ...missingDatasetCandidates.slice(0, 3).flatMap((candidate, index) => [
          { label: `数据集 ${index + 1}`, value: stringValue(candidate.dataset_path) ?? "-" },
          { label: `版本 ${index + 1}`, value: stringValue(candidate.dataset_version_id) ?? "-" },
          { label: `规模 ${index + 1}`, value: datasetCandidateFacts(candidate) },
        ]),
      ],
      actions: missingDatasetCandidates.slice(0, 5).map((candidate, index) =>
        action("select_training_dataset", `选择 ${datasetCandidateLabel(candidate)}`, {
          disabledReason:
            projectDisabled ?? (stringValue(candidate.dataset_path) ? undefined : "此数据集缺少路径。"),
          payload: {
            datasetPath: stringValue(candidate.dataset_path),
            datasetVersionId: stringValue(candidate.dataset_version_id),
            targetColumn: datasetCandidateTarget(candidate),
            intent,
            stage,
          },
          tone: index === 0 ? "primary" : "secondary",
        }),
      ),
    });
  }

  return cards;
}
