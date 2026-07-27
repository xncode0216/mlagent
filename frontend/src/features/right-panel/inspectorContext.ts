import type { RightPanelTabId } from "../../app/appDeepLink";
import type { WorkflowStageId } from "../chat/types";

/**
 * 右侧检查器应当跟随工作流所处的阶段，而不是只由主模式固定映射——否则在数据分析
 * 模式下跑完训练，检查器仍停在图表页，用户必须自己去找训练详情。
 *
 * 映射按"该阶段的产物在哪个检查器里可读"划分：数据形态的阶段落在数据页，
 * 模型形态的阶段落在训练页，沉淀阶段的证据是事件流本身。
 */
const STAGE_TAB: Record<WorkflowStageId, RightPanelTabId> = {
  ingest: "data",
  profile: "data",
  clean: "data",
  transform: "data",
  train: "training",
  evaluate: "training",
  diagnose: "training",
  iterate: "training",
  export: "training",
  learn: "logs",
};

export function inspectorTabForStage(stage: WorkflowStageId): RightPanelTabId {
  return STAGE_TAB[stage];
}

type WorkflowSnapshot = {
  currentStage: { id: WorkflowStageId };
  latestArtifact?: { stage: WorkflowStageId } | null;
};

/**
 * `currentStage` 表达的是"需要用户注意的阶段"——失败与待审批优先，因此训练完成后
 * 它仍可能停在更早的阶段。检查器要带用户去看刚产出的东西，所以以最新产物的阶段为准，
 * 尚无产物时才回退到当前阶段。
 */
export function inspectorTabForWorkflow(workflow: WorkflowSnapshot): RightPanelTabId {
  return inspectorTabForStage(workflow.latestArtifact?.stage ?? workflow.currentStage.id);
}
