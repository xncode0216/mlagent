import { buildBlockedCards } from "./cockpit/blockedCards";
import { buildDataCards } from "./cockpit/dataCards";
import { buildDiagnosisCards } from "./cockpit/diagnosisCards";
import { buildHandoffCards } from "./cockpit/handoffCards";
import { buildModelCards } from "./cockpit/modelCards";
import { buildPreprocessingCards } from "./cockpit/preprocessingCards";
import { buildRecoveryCards } from "./cockpit/recoveryCards";
import {
  action,
  disabledWithoutDataset,
  disabledWithoutProject,
  isDatasetPath,
  stringProp,
} from "./cockpit/primitives";
import {
  collectSignals,
  latestMissingDatasetCommand,
  latestMissingRunCommand,
} from "./cockpit/signals";
import type { BuildCockpitComponentCardsInput, CardBuilderContext, CockpitComponentCard } from "./cockpit/types";

export type {
  BuildCockpitComponentCardsInput,
  CockpitActionId,
  CockpitComponentAction,
  CockpitComponentCard,
  CockpitComponentControl,
  CockpitControlId,
} from "./cockpit/types";

/**
 * cockpit 只渲染有限张卡片。卡片按工作流顺序产生，因此取最前面几张等于永远优先
 * 显示最早期的阶段——流程推进后，Agent 引导用户查看的当前阶段卡片反而被挤出。
 * 保留最新的若干张，让可见集合跟着工作流走。
 */
export function selectVisibleCockpitCards(
  cards: CockpitComponentCard[],
  limit: number,
): CockpitComponentCard[] {
  return cards.length <= limit ? cards : cards.slice(cards.length - limit);
}

/**
 * 卡片按工作流顺序拼装，各组 builder 只负责自己那一段。**顺序即产品语义**——
 * `selectVisibleCockpitCards` 取末尾若干张，调换顺序会改变用户看到哪些卡片。
 */
export function buildCockpitComponentCards(input: BuildCockpitComponentCardsInput): CockpitComponentCard[] {
  const signals = collectSignals(input.events);
  const missingRunCommand = latestMissingRunCommand(input.events);
  const missingDatasetCommand = latestMissingDatasetCommand(input.events);
  const trainingSignal = signals.get("training_config");
  const activeDatasetPath = isDatasetPath(input.activeFile) ? input.activeFile : input.trainingDatasetPath;
  const requestedTargetColumn = stringProp(trainingSignal?.props, "target_column");
  const requestedPreprocessingPlanPath = stringProp(trainingSignal?.props, "preprocessing_plan_path");
  const effectiveTargetColumn = requestedTargetColumn ?? input.suggestedTargetColumn;
  const planPath =
    requestedPreprocessingPlanPath ??
    input.preprocessingPlanPath ??
    signals.get("preprocessing_plan")?.artifactPath ??
    input.workflow.approval?.artifactPath ??
    (input.activeFile.endsWith("preprocessing_plan.json") ? input.activeFile : undefined);
  const plannedDatasetPath =
    signals.get("planned_dataset")?.artifactPath ??
    (input.activeFile.includes("_planned.csv") || input.activeFile.includes("planned") ? input.activeFile : undefined);
  const projectDisabled = disabledWithoutProject(input.projectId);
  const datasetDisabled = disabledWithoutDataset(activeDatasetPath);
  const ctx: CardBuilderContext = {
    input,
    signals,
    projectDisabled,
    datasetDisabled,
    activeDatasetPath,
    effectiveTargetColumn,
    planPath,
    plannedDatasetPath,
    missingRunCommand,
    missingDatasetCommand,
  };

  const cards: CockpitComponentCard[] = [
    ...buildBlockedCards(ctx),
    ...buildRecoveryCards(ctx),
    ...buildDataCards(ctx),
    ...buildPreprocessingCards(ctx),
    ...buildModelCards(ctx),
    ...buildDiagnosisCards(ctx),
    ...buildHandoffCards(ctx),
  ];

  const requested = input.workflow.component;
  if (requested && !cards.some((card) => card.kind === requested.kind)) {
    cards.push({
      id: `requested-${requested.kind}`,
      kind: requested.kind,
      stage: requested.stage,
      title: requested.title,
      description: "智能体请求了这个上下文组件。打开产物以查看完整详情。",
      artifactPath: requested.artifactPath,
      status: "ready",
      facts: [{ label: "产物", value: requested.artifactPath ?? "暂无产物" }],
      actions: [
        action("open_artifact", "打开产物", {
          disabledReason: requested.artifactPath ? undefined : "暂无可用的产物路径。",
          payload: { path: requested.artifactPath },
          tone: "primary",
        }),
      ],
    });
  }


  return cards;
}
