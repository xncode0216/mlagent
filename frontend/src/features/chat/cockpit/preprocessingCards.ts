import {
  action,
  buildFeatureSelectionControls,
  buildPlanStrategyControls,
  buildTargetColumnControls,
  stringListFromProps,
  stringProp,
  targetCandidatesFromProps,
} from "./primitives";
import type { CardBuilderContext, CockpitComponentCard } from "./types";

export function buildPreprocessingCards(ctx: CardBuilderContext): CockpitComponentCard[] {
  const { input, signals, projectDisabled, datasetDisabled, effectiveTargetColumn, planPath, plannedDatasetPath } = ctx;
  const failedTransformNeedsRevision = Boolean(
    input.workflow.currentStage.id === "transform" &&
      input.workflow.currentStage.status === "failed" &&
      !input.workflow.currentStage.retryable &&
      !input.workflow.approval &&
      !plannedDatasetPath,
  );
  const retryableTransformFailure = Boolean(
    input.workflow.currentStage.id === "transform" &&
      input.workflow.currentStage.status === "failed" &&
      input.workflow.currentStage.retryable &&
      !input.workflow.approval &&
      !plannedDatasetPath,
  );
  const cards: CockpitComponentCard[] = [];

  if (planPath || input.workflow.approval?.stage === "transform" || signals.has("preprocessing_plan")) {
    const isPendingApproval = Boolean(input.workflow.approval?.stage === "transform" && !plannedDatasetPath);
    const planSignalProps = signals.get("preprocessing_plan")?.props;
    const featureControls = buildFeatureSelectionControls(
      stringListFromProps(planSignalProps, "feature_columns"),
      stringListFromProps(planSignalProps, "drop_columns"),
    );
    // 目标列决定了哪些列进 drop、哪些进特征、pipeline_script 怎么写，所以纠正它要在
    // 审批检查点这里、并重算整份计划。放到训练卡片上改已经太晚：那时计划早已按错的
    // 目标列算完了，而计划才是训练目标列的权威来源。
    const planTargetControls = isPendingApproval
      ? buildTargetColumnControls(
          targetCandidatesFromProps(signals.get("data_quality")?.props),
          stringProp(planSignalProps, "target_column") ?? effectiveTargetColumn,
          {
            id: "plan_target_column",
            description: "切换后会按新目标列重算整份计划：丢弃列、特征列与管道脚本都会更新。",
          },
        )
      : [];
    // 策略选择器与目标列一样只在审批检查点提供：变换执行后计划已经产出数据集，
    // 改策略不会回头重算。
    const strategyControls = isPendingApproval ? buildPlanStrategyControls(planSignalProps) : [];
    cards.push({
      id: "preprocessing-plan",
      kind: "preprocessing_plan",
      stage: "transform",
      title: retryableTransformFailure
        ? "变换执行失败"
        : failedTransformNeedsRevision
        ? "预处理计划需要修订"
        : input.workflow.approval?.title ?? "审核预处理计划",
      description:
        retryableTransformFailure
          ? "批准后的预处理运行失败。从已保存的变换状态重试；若问题出在计划本身，请刷新计划。"
          : failedTransformNeedsRevision
          ? "审批检查点被拒绝或变换失败。请先刷新计划，再尝试执行。"
          : input.workflow.approval?.description ??
            "执行变换前，先检查生成的丢弃列、填充器、编码器与输出路径。",
      artifactPath: planPath,
      status: plannedDatasetPath ? "complete" : failedTransformNeedsRevision || retryableTransformFailure ? "attention" : "blocked",
      facts: [
        { label: "计划", value: planPath ?? "未选择计划" },
        { label: "输出", value: plannedDatasetPath ?? "等待执行" },
      ],
      // 顺序即阅读顺序：先定预测什么，再定用哪些列，最后才是这些列怎么处理
      ...(planTargetControls.length + featureControls.length + strategyControls.length > 0
        ? { controls: [...planTargetControls, ...featureControls, ...strategyControls] }
        : {}),
      actions: [
        action("open_artifact", "打开计划", {
          disabledReason: planPath ? undefined : "没有可用的预处理计划产物。",
          payload: { path: planPath },
          tone: "secondary",
        }),
        ...(featureControls.length > 0
          ? [
              action("apply_feature_selection", "应用特征选择", {
                disabledReason: projectDisabled ?? datasetDisabled,
                tone: "secondary",
              }),
            ]
          : []),
        failedTransformNeedsRevision
          ? action("generate_preprocessing_plan", "刷新计划", {
              disabledReason: projectDisabled ?? datasetDisabled,
              tone: "primary",
            })
          : retryableTransformFailure
          ? action("retry_transform", "重试变换", {
              disabledReason: projectDisabled ?? (planPath ? undefined : "没有可用的预处理计划产物。"),
              payload: {
                preprocessingPlanPath: planPath,
                stage: input.workflow.currentStage.resumeStage ?? "transform",
              },
              tone: "primary",
            })
          : action(
              isPendingApproval ? "approve_preprocessing_plan" : "execute_preprocessing_plan",
              plannedDatasetPath ? "重新执行计划" : "批准并执行",
              {
                disabledReason: projectDisabled ?? (planPath ? undefined : "没有可用的预处理计划产物。"),
                payload: {
                  approvalId: input.workflow.approval?.id,
                  ...(input.workflow.approval?.origin
                    ? { approvalOrigin: input.workflow.approval.origin }
                    : {}),
                  preprocessingPlanPath: planPath,
                },
                tone: "primary",
              },
            ),
        ...(isPendingApproval
          ? [
              // 批准是不可逆的一步（会写出变换后的数据集），所以先给一条"看清楚"的路径。
              action("preview_preprocessing_plan", "预览变换", {
                disabledReason: projectDisabled ?? (planPath ? undefined : "没有可用的预处理计划产物。"),
                payload: { preprocessingPlanPath: planPath },
                tone: "secondary" as const,
              }),
              action("revise_preprocessing_plan", "修订计划", {
                disabledReason: projectDisabled ?? (planPath ? undefined : "没有可用的预处理计划产物。"),
                payload: { approvalId: input.workflow.approval?.id, preprocessingPlanPath: planPath },
                tone: "secondary" as const,
              }),
            ]
          : []),
        ...(retryableTransformFailure
          ? [
              action("generate_preprocessing_plan", "刷新计划", {
                disabledReason: projectDisabled ?? datasetDisabled,
                tone: "secondary" as const,
              }),
            ]
          : []),
      ],
    });
  }

  if (signals.has("transformation_report")) {
    const transformSignal = signals.get("transformation_report");
    // 执行计划会写出同名的 .json 明细与 .md 报告，事件里后到的 .md 会覆盖 signal。
    // 结构化列对照只存在于 .json，因此两个入口都按扩展名归一化后分别给出。
    const transformArtifactPath = transformSignal?.artifactPath;
    const transformDetailPath = transformArtifactPath?.replace(/\.md$/, ".json");
    const transformReportPath = transformArtifactPath?.replace(/\.json$/, ".md");
    const transformOutputPath =
      stringProp(transformSignal?.props, "output_dataset_path") ?? plannedDatasetPath;
    const transformSourcePath = stringProp(transformSignal?.props, "dataset_path");
    cards.push({
      id: "transformation-report",
      kind: "transformation_report",
      stage: "transform",
      title: "变换结果复核",
      description:
        "对照变换前后的列与形状，确认丢弃、填充与编码结果符合预期，再把数据集交给训练。",
      artifactPath: transformDetailPath,
      status: transformOutputPath ? "complete" : "attention",
      facts: [
        { label: "源数据", value: transformSourcePath ?? "-" },
        { label: "输出", value: transformOutputPath ?? "等待执行" },
        { label: "明细", value: transformDetailPath ?? "未生成" },
      ],
      actions: [
        action("open_artifact", "打开列对照", {
          disabledReason: transformDetailPath ? undefined : "没有可用的变换明细产物。",
          payload: { path: transformDetailPath },
          tone: "primary",
        }),
        action("open_artifact", "打开变换报告", {
          disabledReason: transformReportPath ? undefined : "没有可用的变换报告产物。",
          payload: { path: transformReportPath },
          tone: "secondary",
        }),
        action("open_artifact", "打开输出数据集", {
          disabledReason: transformOutputPath ? undefined : "没有可用的变换后数据集产物。",
          payload: { path: transformOutputPath },
          tone: "secondary",
        }),
      ],
    });
  }

  if (plannedDatasetPath || signals.has("planned_dataset")) {
    cards.push({
      id: "planned-dataset",
      kind: "planned_dataset",
      stage: "train",
      title: "变换后数据集已就绪",
      description: "变换后的数据集现在可作为 sklearn 对比运行的训练输入。",
      artifactPath: plannedDatasetPath,
      status: "ready",
      facts: [
        { label: "数据集", value: plannedDatasetPath ?? input.trainingDatasetPath ?? "-" },
        { label: "目标列", value: effectiveTargetColumn || "未选择" },
      ],
      actions: [
        action("open_artifact", "打开数据集", {
          disabledReason: plannedDatasetPath ? undefined : "没有可用的变换后数据集产物。",
          payload: { path: plannedDatasetPath },
          tone: "secondary",
        }),
        action("open_training", "打开训练", {
          disabledReason: projectDisabled,
          tone: "primary",
        }),
      ],
    });
  }

  return cards;
}
