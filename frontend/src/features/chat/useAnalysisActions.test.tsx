// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUiStore } from "../../app/uiStore";
import { createQueryClient } from "../../lib/queryClient";
import {
  executePreprocessingPlan,
  generatePreprocessingPlan,
  type AgentSession,
  type Project,
} from "../../lib/api";
import type { AgentStreamEvent } from "./types";
import { useAnalysisActions } from "./useAnalysisActions";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    generatePreprocessingPlan: vi.fn(),
    executePreprocessingPlan: vi.fn(),
  };
});

const project = { id: "project-1", name: "p", workspace_path: "/w" } as Project;
const session = { id: "session-1", project_id: "project-1", mode: "analysis" } as AgentSession;

function artifact(path: string) {
  return {
    id: path,
    project_id: "project-1",
    session_id: "session-1",
    type: "dataframe",
    name: path.split("/").pop(),
    path,
    metadata: {},
    created_at: "now",
  };
}

function renderAnalysisActions(overrides: { project?: Project | null } = {}) {
  const events: AgentStreamEvent[] = [];
  const setLocalEvents = vi.fn((update) => {
    const next = typeof update === "function" ? update(events) : update;
    events.length = 0;
    events.push(...next);
  });
  const queryClient = createQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const view = renderHook(
    () =>
      useAnalysisActions({
        project: overrides.project === undefined ? project : overrides.project,
        activeSession: session,
        setLocalEvents,
        sendApprovalResponse: vi.fn(),
        sendResumeStep: vi.fn(),
      }),
    { wrapper: Wrapper },
  );
  return { ...view, events };
}

beforeEach(() => {
  useUiStore.setState({
    activeFile: "data/churn.csv",
    trainingDatasetPath: "data/churn.csv",
    selectedPreprocessingPlanPath: null,
    suggestedTargetColumn: "",
    expandedFolders: [],
  });
});

afterEach(() => vi.clearAllMocks());

describe("生成预处理计划", () => {
  it("把生成的计划设为待审批，并展开产物所在目录", async () => {
    vi.mocked(generatePreprocessingPlan).mockResolvedValue({
      plan: { output_dataset_path: "results/s1/churn_planned.csv" },
      plan_artifact: artifact("results/s1/preprocessing_plan.json"),
      pipeline_artifact: artifact("notebooks/s1_pipeline.py"),
    } as never);
    const { result, events } = renderAnalysisActions();

    await act(() => result.current.handleGeneratePreprocessingPlan());

    expect(useUiStore.getState().expandedFolders).toEqual(
      expect.arrayContaining(["results", "results/s1", "notebooks"]),
    );
    // 该审批由前端本地流程发起，后端没有对应待办，必须标注来源
    const approval = events.find((event) => event.type === "approval_required");
    expect(approval).toMatchObject({ origin: "local", stage: "transform" });
  });

  it("把特征选择透传给后端而不是本地裁剪", async () => {
    vi.mocked(generatePreprocessingPlan).mockResolvedValue({
      plan: {},
      plan_artifact: artifact("results/s1/preprocessing_plan.json"),
      pipeline_artifact: artifact("notebooks/s1_pipeline.py"),
    } as never);
    const { result } = renderAnalysisActions();

    await act(() => result.current.handleGeneratePreprocessingPlan(["age", "income"]));

    expect(generatePreprocessingPlan).toHaveBeenCalledWith(
      "project-1",
      "data/churn.csv",
      "session-1",
      ["age", "income"],
      undefined,
    );
  });

  it("重算计划时把显式目标列透传给后端", async () => {
    vi.mocked(generatePreprocessingPlan).mockResolvedValue({
      plan: {},
      plan_artifact: artifact("results/s1/preprocessing_plan.json"),
      pipeline_artifact: artifact("notebooks/s1_pipeline.py"),
    } as never);
    const { result } = renderAnalysisActions();

    await act(() => result.current.handleGeneratePreprocessingPlan(undefined, "converted"));

    // 不带特征选择：那是上一版计划里的选择，换目标列后未必仍然成立
    expect(generatePreprocessingPlan).toHaveBeenCalledWith(
      "project-1",
      "data/churn.csv",
      "session-1",
      undefined,
      "converted",
    );
  });
});

describe("执行预处理计划", () => {
  function planResult() {
    return {
      summary: { target_column: "churn" },
      transformed_data_artifact: artifact("results/s1/churn_planned.csv"),
      summary_artifact: artifact("results/s1/transform_report.json"),
      report_artifact: artifact("results/s1/transform_report.md"),
    } as never;
  }

  it("把变换后的数据集交接为下一步的训练输入", async () => {
    vi.mocked(executePreprocessingPlan).mockResolvedValue(planResult());
    useUiStore.setState({ selectedPreprocessingPlanPath: "results/s1/preprocessing_plan.json" });
    const { result, events } = renderAnalysisActions();

    await act(() => result.current.handleExecutePreprocessingPlan());

    const state = useUiStore.getState();
    expect(state.trainingDatasetPath).toBe("results/s1/churn_planned.csv");
    expect(state.activeFile).toBe("results/s1/churn_planned.csv");
    // 目标列来自后端的变换摘要，不该由前端猜测
    expect(state.suggestedTargetColumn).toBe("churn");
    expect(state.selectedPreprocessingPlanPath).toBe("results/s1/preprocessing_plan.json");
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["stage_completed", "component_requested", "artifact_created"]),
    );
  });

  it("显式传入的计划路径优先于当前选中的计划", async () => {
    vi.mocked(executePreprocessingPlan).mockResolvedValue(planResult());
    useUiStore.setState({ selectedPreprocessingPlanPath: "results/old/preprocessing_plan.json" });
    const { result } = renderAnalysisActions();

    await act(() =>
      result.current.handleExecutePreprocessingPlan("results/s1/preprocessing_plan.json"),
    );

    expect(executePreprocessingPlan).toHaveBeenCalledWith(
      "project-1",
      "data/churn.csv",
      "results/s1/preprocessing_plan.json",
      "session-1",
    );
  });

  it("活动文件不是数据集时不把它当作变换输入", async () => {
    vi.mocked(executePreprocessingPlan).mockResolvedValue(planResult());
    useUiStore.setState({
      activeFile: "results/s1/preprocessing_plan.json",
      selectedPreprocessingPlanPath: "results/s1/preprocessing_plan.json",
    });
    const { result } = renderAnalysisActions();

    await act(() => result.current.handleExecutePreprocessingPlan());

    // 传 null 让后端从计划自身推断数据集，而不是把计划文件当数据集
    expect(executePreprocessingPlan).toHaveBeenCalledWith(
      "project-1",
      null,
      "results/s1/preprocessing_plan.json",
      "session-1",
    );
  });

  it("没有计划可执行时不发出请求", async () => {
    const { result } = renderAnalysisActions();

    await act(() => result.current.handleExecutePreprocessingPlan());

    expect(executePreprocessingPlan).not.toHaveBeenCalled();
  });

  it("没有项目时不发出请求", async () => {
    useUiStore.setState({ selectedPreprocessingPlanPath: "results/s1/preprocessing_plan.json" });
    const { result } = renderAnalysisActions({ project: null });

    await act(() => result.current.handleExecutePreprocessingPlan());

    expect(executePreprocessingPlan).not.toHaveBeenCalled();
  });
});
