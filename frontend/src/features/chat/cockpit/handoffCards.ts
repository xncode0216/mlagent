import { action, arrayProp, numberProp, stringProp } from "./primitives";
import type { CardBuilderContext, CockpitComponentCard } from "./types";

export function buildHandoffCards(ctx: CardBuilderContext): CockpitComponentCard[] {
  const { input, signals, projectDisabled, missingRunCommand } = ctx;
  const exportBundleSignal = signals.get("export_bundle");
  const lessonReviewSignal = signals.get("lesson_review");
  const exportExperimentId = stringProp(exportBundleSignal?.props, "experiment_id");
  const exportDatasetPath = stringProp(exportBundleSignal?.props, "dataset_path");
  const exportTargetColumn = stringProp(exportBundleSignal?.props, "target_column");
  const exportMetricsPath = stringProp(exportBundleSignal?.props, "metrics_path");
  const exportModelPath = stringProp(exportBundleSignal?.props, "model_path");
  const exportReportPath = stringProp(exportBundleSignal?.props, "evaluation_report_path");
  const exportSamplesPath = stringProp(exportBundleSignal?.props, "prediction_samples_path");
  const exportPlanPath = stringProp(exportBundleSignal?.props, "preprocessing_plan_path");
  const exportBundlePath = stringProp(exportBundleSignal?.props, "export_bundle_path");
  const exportMissingArtifacts = arrayProp(exportBundleSignal?.props, "missing_required_artifacts") ?? [];
  const exportBundleReady =
    typeof exportBundleSignal?.props?.bundle_ready === "boolean"
      ? exportBundleSignal.props.bundle_ready
      : Boolean(exportExperimentId && exportMetricsPath && exportModelPath && exportReportPath);
  const lessonSourceSessionId = stringProp(lessonReviewSignal?.props, "source_session_id");
  const lessonSourceEventCount = numberProp(lessonReviewSignal?.props, "source_event_count");
  const lessonCandidateCount = numberProp(lessonReviewSignal?.props, "candidate_count");
  const lessonHighConfidenceCount = numberProp(lessonReviewSignal?.props, "high_confidence_count");
  const lessonLatestEventType = stringProp(lessonReviewSignal?.props, "latest_event_type");
  const lessonSourceArtifacts = arrayProp(lessonReviewSignal?.props, "source_artifacts") ?? [];
  const lessonHasExtractableCandidates =
    typeof lessonReviewSignal?.props?.has_extractable_candidates === "boolean"
      ? lessonReviewSignal.props.has_extractable_candidates
      : undefined;
  const cards: CockpitComponentCard[] = [];

  if (!missingRunCommand && (signals.has("export_bundle") || input.workflow.currentStage.id === "export")) {
    cards.push({
      id: "export-bundle",
      kind: "export_bundle",
      stage: "export",
      title: exportBundlePath ? "导出包已就绪" : "准备导出包",
      description: exportBundleReady
        ? "将所选运行打包为可复现的交接包，包含模型、指标、报告与可选诊断。"
        : "缺少必要的运行产物。导出交接包前，请重新生成报告或恢复缺失文件。",
      artifactPath: exportBundlePath ?? exportReportPath,
      status: exportBundleReady ? "ready" : "attention",
      facts: [
        { label: "实验", value: exportExperimentId ?? "-" },
        { label: "数据集", value: exportDatasetPath ?? input.trainingDatasetPath ?? "-" },
        { label: "目标列", value: exportTargetColumn ?? input.suggestedTargetColumn ?? "-" },
        { label: "报告", value: exportReportPath ?? "缺失" },
        { label: "导出包", value: exportBundlePath ?? "未导出" },
        {
          label: "缺失项",
          value: exportMissingArtifacts.length > 0 ? exportMissingArtifacts.map(String).join(", ") : "无",
        },
      ],
      actions: [
        action("open_artifact", exportBundlePath ? "打开导出包" : "打开报告", {
          disabledReason:
            exportBundlePath || exportReportPath ? undefined : "没有可用的导出包或报告产物。",
          payload: { path: exportBundlePath ?? exportReportPath },
          tone: exportBundlePath ? "primary" : "secondary",
        }),
        action("export_run_bundle", exportBundlePath ? "重新导出包" : "导出包", {
          disabledReason:
            projectDisabled ??
            (exportExperimentId ? undefined : "没有可用于导出包的实验 id。") ??
            (exportBundleReady ? undefined : "缺少必要的模型、指标或报告产物。"),
          payload: exportExperimentId ? { experimentId: exportExperimentId } : undefined,
          tone: exportBundleReady ? "primary" : "secondary",
        }),
        action("open_training", "打开训练", {
          disabledReason: projectDisabled,
          tone: "secondary",
        }),
      ],
    });

    cards.push({
      id: "export-artifacts",
      kind: "evaluation_report",
      stage: "export",
      title: "交接产物清单",
      description: "在创建或刷新归档之前，检查将纳入交接的产物。",
      artifactPath: exportReportPath,
      status: exportBundleReady ? "ready" : "attention",
      facts: [
        { label: "指标", value: exportMetricsPath ?? "缺失" },
        { label: "模型", value: exportModelPath ?? "缺失" },
        { label: "样本", value: exportSamplesPath ?? "可选" },
        { label: "计划", value: exportPlanPath ?? "可选" },
      ],
      actions: [
        action("open_artifact", "打开报告", {
          disabledReason: exportReportPath ? undefined : "没有可用的评估报告产物。",
          payload: { path: exportReportPath },
          tone: "primary",
        }),
        action("open_artifact", "打开指标", {
          disabledReason: exportMetricsPath ? undefined : "没有可用的指标产物。",
          payload: { path: exportMetricsPath },
          tone: "secondary",
        }),
      ],
    });
  }

  if (signals.has("lesson_review") || input.workflow.currentStage.id === "learn") {
    cards.push({
      id: "lesson-review",
      kind: "lesson_review",
      stage: "learn",
      title: "习得规则审核",
      description:
        lessonHasExtractableCandidates === false
          ? "本次会话有证据，但当前提取器尚未找到可复用的规则候选。"
          : "从当前会话证据中提取可审核的经验候选，采纳前先在「自进化知识」中查看。",
      artifactPath: lessonSourceArtifacts.at(-1) ? String(lessonSourceArtifacts.at(-1)) : undefined,
      status: lessonHasExtractableCandidates === false ? "attention" : "ready",
      facts: [
        { label: "来源会话", value: lessonSourceSessionId ?? "-" },
        { label: "事件数", value: String(lessonSourceEventCount ?? 0) },
        { label: "候选数", value: String(lessonCandidateCount ?? 0) },
        { label: "高置信数", value: String(lessonHighConfidenceCount ?? 0) },
        { label: "最新事件", value: lessonLatestEventType ?? "-" },
      ],
      actions: [
        action("extract_lessons", "提取经验", {
          disabledReason:
            projectDisabled ??
            (lessonSourceSessionId ? undefined : "没有可用于经验提取的来源会话。"),
          payload: lessonSourceSessionId ? { sourceSessionId: lessonSourceSessionId } : undefined,
          tone: "primary",
        }),
        action("open_artifact", "打开证据", {
          disabledReason: lessonSourceArtifacts.at(-1) ? undefined : "没有可用的来源产物证据。",
          payload: { path: lessonSourceArtifacts.at(-1) ? String(lessonSourceArtifacts.at(-1)) : undefined },
          tone: "secondary",
        }),
      ],
    });
  }

  return cards;
}
