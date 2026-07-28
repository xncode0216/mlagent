import { action, arrayProp, numberProp, stringProp } from "./primitives";
import type { CardBuilderContext, CockpitComponentCard } from "./types";

export function buildDiagnosisCards(ctx: CardBuilderContext): CockpitComponentCard[] {
  const { input, signals, projectDisabled, missingRunCommand } = ctx;
  const errorAnalysisSignal = signals.get("error_analysis");
  const predictionSamplesSignal = signals.get("prediction_samples");
  const iterationProposalSignal = signals.get("iteration_proposal");
  const diagnosisExperimentId =
    stringProp(errorAnalysisSignal?.props, "experiment_id") ?? stringProp(predictionSamplesSignal?.props, "experiment_id");
  const diagnosisDatasetPath =
    stringProp(errorAnalysisSignal?.props, "dataset_path") ?? stringProp(predictionSamplesSignal?.props, "dataset_path");
  const diagnosisTargetColumn =
    stringProp(errorAnalysisSignal?.props, "target_column") ?? stringProp(predictionSamplesSignal?.props, "target_column");
  const diagnosisMetricsPath =
    stringProp(errorAnalysisSignal?.props, "metrics_path") ??
    stringProp(predictionSamplesSignal?.props, "metrics_path") ??
    errorAnalysisSignal?.artifactPath;
  const diagnosisReportPath =
    stringProp(errorAnalysisSignal?.props, "evaluation_report_path") ??
    stringProp(predictionSamplesSignal?.props, "evaluation_report_path");
  const diagnosisSamplesPath =
    stringProp(errorAnalysisSignal?.props, "prediction_samples_path") ??
    stringProp(predictionSamplesSignal?.props, "prediction_samples_path") ??
    predictionSamplesSignal?.artifactPath;
  const diagnosisWorstClass =
    stringProp(errorAnalysisSignal?.props, "worst_class") ?? stringProp(predictionSamplesSignal?.props, "worst_class");
  const diagnosisMainConfusion =
    stringProp(errorAnalysisSignal?.props, "main_confusion") ?? stringProp(predictionSamplesSignal?.props, "main_confusion");
  const diagnosisRecommendation =
    stringProp(errorAnalysisSignal?.props, "recommendation") ?? stringProp(predictionSamplesSignal?.props, "recommendation");
  const diagnosisErrorCount =
    numberProp(errorAnalysisSignal?.props, "error_count") ?? numberProp(predictionSamplesSignal?.props, "error_count");
  const diagnosisSliceCount =
    arrayProp(errorAnalysisSignal?.props, "error_slices")?.length ??
    arrayProp(predictionSamplesSignal?.props, "error_slices")?.length;
  const iterationExperimentId = stringProp(iterationProposalSignal?.props, "experiment_id");
  const iterationDatasetPath = stringProp(iterationProposalSignal?.props, "dataset_path");
  const iterationTargetColumn = stringProp(iterationProposalSignal?.props, "target_column");
  const iterationMetricsPath = stringProp(iterationProposalSignal?.props, "metrics_path") ?? iterationProposalSignal?.artifactPath;
  const iterationReportPath = stringProp(iterationProposalSignal?.props, "evaluation_report_path");
  const iterationSamplesPath = stringProp(iterationProposalSignal?.props, "prediction_samples_path");
  const iterationPlanPath = stringProp(iterationProposalSignal?.props, "preprocessing_plan_path");
  const iterationWorstClass = stringProp(iterationProposalSignal?.props, "worst_class");
  const iterationMainConfusion = stringProp(iterationProposalSignal?.props, "main_confusion");
  const iterationRecommendation = stringProp(iterationProposalSignal?.props, "recommendation");
  const iterationNextActions = arrayProp(iterationProposalSignal?.props, "next_actions") ?? [];
  const cards: CockpitComponentCard[] = [];

  if (
    !missingRunCommand &&
    (signals.has("error_analysis") || signals.has("prediction_samples") || input.workflow.currentStage.id === "diagnose")
  ) {
    cards.push({
      id: "error-analysis",
      kind: "error_analysis",
      stage: "diagnose",
      title: "误差分析",
      description:
        "在决定是否调整特征、预处理或注意事项之前，检查类别级误差集中度与最强混淆方向。",
      artifactPath: diagnosisMetricsPath,
      status: diagnosisMetricsPath ? "ready" : "attention",
      facts: [
        { label: "实验", value: diagnosisExperimentId ?? "-" },
        { label: "数据集", value: diagnosisDatasetPath ?? input.trainingDatasetPath ?? "-" },
        { label: "最差类别", value: diagnosisWorstClass ?? "无" },
        { label: "主要混淆", value: diagnosisMainConfusion ?? "无" },
        { label: "误差行数", value: String(diagnosisErrorCount ?? 0) },
        { label: "切片数", value: String(diagnosisSliceCount ?? 0) },
      ],
      actions: [
        action("open_training", "打开训练", {
          disabledReason: projectDisabled,
          tone: "secondary",
        }),
        action("open_artifact", "打开指标", {
          disabledReason: diagnosisMetricsPath ? undefined : "没有可用的指标产物。",
          payload: { path: diagnosisMetricsPath },
          tone: "primary",
        }),
        action("open_artifact", "打开报告", {
          disabledReason: diagnosisReportPath ? undefined : "没有可用的评估报告产物。",
          payload: { path: diagnosisReportPath },
          tone: "secondary",
        }),
      ],
    });

    cards.push({
      id: "prediction-samples",
      kind: "prediction_samples",
      stage: "diagnose",
      title: "预测样本",
      description:
        diagnosisRecommendation ??
        "打开行级预测样本，查看诊断摘要背后被误分类的样本及其特征值。",
      artifactPath: diagnosisSamplesPath,
      status: diagnosisSamplesPath ? "ready" : "attention",
      facts: [
        { label: "样本", value: diagnosisSamplesPath ?? "未生成" },
        { label: "目标列", value: diagnosisTargetColumn ?? input.suggestedTargetColumn ?? "-" },
        { label: "最差类别", value: diagnosisWorstClass ?? "无" },
        { label: "建议", value: diagnosisRecommendation ?? "查看聚焦实验的诊断结果。" },
      ],
      actions: [
        action("open_artifact", "打开样本", {
          disabledReason: diagnosisSamplesPath ? undefined : "没有可用的预测样本产物。",
          payload: { path: diagnosisSamplesPath },
          tone: "primary",
        }),
        action("open_training", "打开诊断", {
          disabledReason: projectDisabled,
          tone: "secondary",
        }),
      ],
    });
  }

  if (signals.has("iteration_proposal") || input.workflow.currentStage.id === "iterate") {
    cards.push({
      id: "iteration-proposal",
      kind: "iteration_proposal",
      stage: "iterate",
      title: "迭代建议",
      description:
        iterationRecommendation ??
        "查看所选实验的诊断结果，在开始下一次运行前决定是否调整预处理、特征或训练。",
      artifactPath: iterationMetricsPath,
      status: "attention",
      facts: [
        { label: "实验", value: iterationExperimentId ?? "-" },
        { label: "数据集", value: iterationDatasetPath ?? input.trainingDatasetPath ?? "-" },
        { label: "目标列", value: iterationTargetColumn ?? input.suggestedTargetColumn ?? "-" },
        { label: "最差类别", value: iterationWorstClass ?? "无" },
        { label: "主要混淆", value: iterationMainConfusion ?? "无" },
        {
          label: "下一步",
          value: iterationNextActions.at(0) ? String(iterationNextActions.at(0)) : "重新训练前先查看诊断结果。",
        },
      ],
      actions: [
        action("open_artifact", "打开指标", {
          disabledReason: iterationMetricsPath ? undefined : "没有可用的指标产物。",
          payload: { path: iterationMetricsPath },
          tone: "primary",
        }),
        action("open_artifact", "打开报告", {
          disabledReason: iterationReportPath ? undefined : "没有可用的评估报告产物。",
          payload: { path: iterationReportPath },
          tone: "secondary",
        }),
        action("open_artifact", "打开样本", {
          disabledReason: iterationSamplesPath ? undefined : "没有可用的预测样本产物。",
          payload: { path: iterationSamplesPath },
          tone: "secondary",
        }),
        action("open_artifact", "打开计划", {
          disabledReason: iterationPlanPath ? undefined : "没有可用的预处理计划产物。",
          payload: { path: iterationPlanPath },
          tone: "secondary",
        }),
        action("open_training", "打开训练", {
          disabledReason: projectDisabled,
          tone: "secondary",
        }),
      ],
    });
  }

  return cards;
}
