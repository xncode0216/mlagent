import {
  action,
  buildTargetColumnControls,
  disabledWithoutDataset,
  stringProp,
  targetCandidatesFromProps,
} from "./primitives";
import type { CardBuilderContext, CockpitComponentCard } from "./types";

export function buildModelCards(ctx: CardBuilderContext): CockpitComponentCard[] {
  const { input, signals, projectDisabled, effectiveTargetColumn, planPath, plannedDatasetPath, missingRunCommand, missingDatasetCommand } = ctx;
  const trainingSignal = signals.get("training_config");
  const modelComparisonSignal = signals.get("model_comparison");
  const evaluationReportSignal = signals.get("evaluation_report");
  const requestedTrainingDatasetPath = stringProp(trainingSignal?.props, "dataset_path");
  const effectiveTrainingDatasetPath = requestedTrainingDatasetPath ?? input.trainingDatasetPath;
  const targetCandidateColumns = targetCandidatesFromProps(signals.get("data_quality")?.props);
  const evaluationExperimentId =
    stringProp(evaluationReportSignal?.props, "experiment_id") ?? stringProp(modelComparisonSignal?.props, "experiment_id");
  const evaluationDatasetPath =
    stringProp(evaluationReportSignal?.props, "dataset_path") ?? stringProp(modelComparisonSignal?.props, "dataset_path");
  const evaluationTargetColumn =
    stringProp(evaluationReportSignal?.props, "target_column") ?? stringProp(modelComparisonSignal?.props, "target_column");
  const evaluationMetricsPath =
    stringProp(evaluationReportSignal?.props, "metrics_path") ??
    stringProp(modelComparisonSignal?.props, "metrics_path") ??
    modelComparisonSignal?.artifactPath;
  const evaluationModelPath =
    stringProp(evaluationReportSignal?.props, "model_path") ?? stringProp(modelComparisonSignal?.props, "model_path");
  const evaluationReportPath =
    stringProp(evaluationReportSignal?.props, "evaluation_report_path") ?? evaluationReportSignal?.artifactPath;
  const evaluationPredictionSamplesPath =
    stringProp(evaluationReportSignal?.props, "prediction_samples_path") ??
    stringProp(modelComparisonSignal?.props, "prediction_samples_path");
  const evaluationBestModel =
    stringProp(evaluationReportSignal?.props, "best_model_name") ?? stringProp(modelComparisonSignal?.props, "best_model_name");
  const retryableTrainingFailure = Boolean(
    input.workflow.currentStage.id === "train" &&
      input.workflow.currentStage.status === "failed" &&
      input.workflow.currentStage.retryable,
  );
  const cards: CockpitComponentCard[] = [];

  if (!missingDatasetCommand && (plannedDatasetPath || input.workflow.currentStage.id === "train" || input.mode === "machine-learning")) {
    const trainingDataset = plannedDatasetPath ?? effectiveTrainingDatasetPath ?? input.activeFile;
    const targetControls = buildTargetColumnControls(targetCandidateColumns, effectiveTargetColumn);
    cards.push({
      id: "training-config",
      kind: "training_config",
      stage: "train",
      title: retryableTrainingFailure ? "训练执行失败" : "训练配置",
      description: retryableTrainingFailure
        ? "sklearn 训练运行失败。从已保存的训练状态重试，或先调整数据集、目标列、GPU 或预处理计划。"
        : "使用当前数据集与目标列，启动一次可复现的 sklearn 训练运行。",
      artifactPath: trainingDataset,
      status: retryableTrainingFailure ? "attention" : effectiveTargetColumn ? "ready" : "attention",
      facts: [
        { label: "数据集", value: trainingDataset },
        // 有选择器时目标列由控件自身呈现，不再重复一条只读事实
        ...(targetControls.length > 0
          ? []
          : [{ label: "目标列", value: effectiveTargetColumn || "缺失" }]),
        { label: "计划", value: planPath ?? "无" },
      ],
      ...(targetControls.length > 0 ? { controls: targetControls } : {}),
      actions: [
        action("open_training", "打开训练", {
          disabledReason: projectDisabled,
          tone: "secondary",
        }),
        retryableTrainingFailure
          ? action("retry_sklearn_training", "重试训练", {
              disabledReason: projectDisabled,
              payload: { stage: input.workflow.currentStage.resumeStage ?? "train" },
              tone: "primary",
            })
          : action("start_sklearn_training", "启动 sklearn", {
              disabledReason:
                projectDisabled ??
                (effectiveTargetColumn ? undefined : "训练前请选择或推断一个目标列。") ??
                disabledWithoutDataset(trainingDataset),
              payload: {
                path: trainingDataset,
                datasetPath: trainingDataset,
                preprocessingPlanPath: planPath,
                targetColumn: effectiveTargetColumn,
              },
              tone: "primary",
            }),
      ],
    });
  }

  if (
    !missingRunCommand &&
    (signals.has("model_comparison") || signals.has("evaluation_report") || input.workflow.currentStage.id === "evaluate")
  ) {
    cards.push({
      id: "model-comparison",
      kind: "model_comparison",
      stage: "evaluate",
      title: "模型对比",
      description:
        "在重新生成报告或进入诊断之前，检查所选实验的指标、候选模型对比与产物路径。",
      artifactPath: evaluationMetricsPath,
      status: evaluationMetricsPath ? "ready" : "attention",
      facts: [
        { label: "实验", value: evaluationExperimentId ?? "-" },
        { label: "数据集", value: evaluationDatasetPath ?? input.trainingDatasetPath ?? "-" },
        { label: "目标列", value: evaluationTargetColumn ?? input.suggestedTargetColumn ?? "-" },
        { label: "最佳模型", value: evaluationBestModel ?? "-" },
      ],
      actions: [
        action("open_training", "打开训练", {
          disabledReason: projectDisabled,
          tone: "secondary",
        }),
        action("open_artifact", "打开指标", {
          disabledReason: evaluationMetricsPath ? undefined : "没有可用的指标产物。",
          payload: { path: evaluationMetricsPath },
          tone: "primary",
        }),
      ],
    });

    cards.push({
      id: "evaluation-report",
      kind: "evaluation_report",
      stage: "evaluate",
      title: evaluationReportPath ? "评估报告已就绪" : "评估报告缺失",
      description: evaluationReportPath
        ? "打开已生成的模型评估报告，或从已保存的实验产物重新生成。"
        : "该实验有指标但尚无报告产物。请从所选运行重新生成报告。",
      artifactPath: evaluationReportPath,
      status: evaluationReportPath ? "ready" : "attention",
      facts: [
        { label: "报告", value: evaluationReportPath ?? "未生成" },
        { label: "指标", value: evaluationMetricsPath ?? "-" },
        { label: "模型", value: evaluationModelPath ?? "-" },
        { label: "样本", value: evaluationPredictionSamplesPath ?? "-" },
      ],
      actions: [
        action("open_artifact", "打开报告", {
          disabledReason: evaluationReportPath ? undefined : "没有可用的评估报告产物。",
          payload: { path: evaluationReportPath },
          tone: evaluationReportPath ? "primary" : "secondary",
        }),
        action("regenerate_evaluation_report", evaluationReportPath ? "重新生成报告" : "生成报告", {
          disabledReason:
            projectDisabled ?? (evaluationExperimentId ? undefined : "没有可用于生成报告的实验 id。"),
          payload: evaluationExperimentId ? { experimentId: evaluationExperimentId } : undefined,
          tone: evaluationReportPath ? "secondary" : "primary",
        }),
      ],
    });
  }

  return cards;
}
