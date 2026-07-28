import {
  action,
  arrayProp,
  disabledWithoutDataset,
  numberProp,
  stringProp,
} from "./primitives";
import type { CardBuilderContext, CockpitComponentCard } from "./types";

export function buildDataCards(ctx: CardBuilderContext): CockpitComponentCard[] {
  const { input, signals, projectDisabled, datasetDisabled, activeDatasetPath, planPath } = ctx;
  const datasetSummarySignal = signals.get("dataset_summary");
  const dataProfilePath = signals.get("data_quality")?.artifactPath;
  const registeredDatasetPath = stringProp(datasetSummarySignal?.props, "dataset_path") ?? activeDatasetPath;
  const datasetRegistryPath =
    stringProp(datasetSummarySignal?.props, "registry_path") ?? datasetSummarySignal?.artifactPath;
  const datasetVersionId = stringProp(datasetSummarySignal?.props, "dataset_version_id");
  const datasetRowCount = numberProp(datasetSummarySignal?.props, "row_count");
  const datasetColumnCount = numberProp(datasetSummarySignal?.props, "column_count");
  const datasetColumns = arrayProp(datasetSummarySignal?.props, "columns") ?? [];
  const datasetSampleStrategy = stringProp(datasetSummarySignal?.props, "sample_strategy");
  const cards: CockpitComponentCard[] = [];

  if (signals.has("dataset_summary") || input.workflow.currentStage.id === "ingest") {
    cards.push({
      id: "dataset-summary",
      kind: "dataset_summary",
      stage: "ingest",
      title: datasetRegistryPath ? "数据集已登记" : "数据集接入",
      description:
        "在画像、清洗、变换或训练之前，先查看当前数据集的来源、版本与结构快照。",
      artifactPath: datasetRegistryPath,
      status: datasetRegistryPath ? "ready" : "attention",
      facts: [
        { label: "数据集", value: registeredDatasetPath || input.activeFile || "-" },
        { label: "版本", value: datasetVersionId ?? "未登记" },
        {
          label: "规模",
          value:
            datasetRowCount !== undefined && datasetColumnCount !== undefined
              ? `${datasetRowCount} 行 × ${datasetColumnCount} 列`
              : "未知",
        },
        { label: "采样", value: datasetSampleStrategy ?? "未知" },
        {
          label: "列",
          value: datasetColumns.length > 0 ? datasetColumns.map(String).join(", ") : "未检查",
        },
      ],
      actions: [
        action("open_artifact", "打开登记表", {
          disabledReason: datasetRegistryPath ? undefined : "没有可用的数据集登记产物。",
          payload: { path: datasetRegistryPath },
          tone: "secondary",
        }),
        action("generate_profile", "生成画像", {
          disabledReason: projectDisabled ?? disabledWithoutDataset(registeredDatasetPath),
          tone: "primary",
        }),
      ],
    });
  }

  if (
    input.workflow.currentStage.id === "ingest" ||
    input.workflow.currentStage.id === "profile" ||
    signals.has("data_quality") ||
    input.mode === "analysis"
  ) {
    cards.push({
      id: "data-quality",
      kind: "data_quality",
      stage: "profile",
      title: dataProfilePath ? "数据质量画像已就绪" : "为当前数据集生成画像",
      description: dataProfilePath
        ? "查看列级质量画像，然后基于同一数据集生成预处理计划。"
        : "在决定如何清洗、变换或训练之前，先为该数据集生成数据质量画像。",
      artifactPath: dataProfilePath,
      status: dataProfilePath ? "complete" : "ready",
      facts: [
        { label: "数据集", value: activeDatasetPath || input.activeFile || "-" },
        { label: "画像", value: dataProfilePath ?? "未生成" },
      ],
      actions: [
        action("generate_profile", dataProfilePath ? "刷新画像" : "生成画像", {
          disabledReason: projectDisabled ?? datasetDisabled,
          tone: dataProfilePath ? "secondary" : "primary",
        }),
        action("generate_preprocessing_plan", planPath ? "刷新计划" : "生成计划", {
          disabledReason: projectDisabled ?? datasetDisabled,
          tone: "secondary",
        }),
      ],
    });
  }

  return cards;
}
