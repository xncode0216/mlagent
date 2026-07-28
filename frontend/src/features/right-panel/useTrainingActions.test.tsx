// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUiStore } from "../../app/uiStore";
import { createQueryClient } from "../../lib/queryClient";
import {
  extractLesson,
  getGPUStatus,
  trainSklearnModel,
  type AgentSession,
  type Project,
} from "../../lib/api";
import type { AgentStreamEvent } from "../chat/types";
import { useTrainingActions } from "./useTrainingActions";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    trainSklearnModel: vi.fn(),
    trainBaselineModel: vi.fn(),
    extractLesson: vi.fn(),
    getGPUStatus: vi.fn(),
  };
});

const project = { id: "project-1", name: "p", workspace_path: "/w" } as Project;
const session = { id: "session-1", project_id: "project-1", mode: "machine-learning" } as AgentSession;

function trainingArtifact(name: string, path: string) {
  return { id: path, name, path, created_at: "now" };
}

function trainingResult() {
  return {
    experiment_id: "exp-1",
    engine: "sklearn",
    model: { algorithm: "logistic_regression" },
    metrics: { accuracy: 0.82, f1_weighted: 0.8 },
    runs: [{ model_name: "logistic_regression" }],
    dataset_path: "data/churn.csv",
    target_column: "churn",
    metrics_artifact: trainingArtifact("metrics.json", "results/s1/metrics.json"),
    model_artifact: trainingArtifact("model.pkl", "models/model.pkl"),
  } as never;
}

function renderTrainingActions() {
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
    () => useTrainingActions({ project, activeSession: session, setLocalEvents }),
    { wrapper: Wrapper },
  );
  return { ...view, events };
}

beforeEach(() => {
  vi.mocked(getGPUStatus).mockResolvedValue({ status: "idle" } as never);
  vi.mocked(extractLesson).mockResolvedValue({ id: "lesson-1" } as never);
  vi.mocked(trainSklearnModel).mockResolvedValue(trainingResult());
  useUiStore.setState({
    activeFile: "data/churn.csv",
    trainingDatasetPath: "data/churn.csv",
    trainingError: null,
    trainingResult: null,
    gpuActionError: null,
  });
});

afterEach(() => vi.clearAllMocks());

describe("训练后自动沉淀的经验", () => {
  it("使用与规则匹配一致的领域词汇", async () => {
    const { result } = renderTrainingActions();

    await act(() => result.current.handleTrainModel("churn", "sklearn", false));

    const lesson = vi.mocked(extractLesson).mock.calls[0][1];
    // 全系统的经验领域用连字符（data-analysis / kernel-error / machine-learning）。
    // 这里若写成下划线，标签维度永远对不上，该经验便注定匹配不到。
    expect(lesson.domain).toContain("machine-learning");
    expect(lesson.domain).not.toContain("machine_learning");
  });

  it("把真实实验与指标写进证据，便于回溯", async () => {
    const { result } = renderTrainingActions();

    await act(() => result.current.handleTrainModel("churn", "sklearn", false));

    const lesson = vi.mocked(extractLesson).mock.calls[0][1];
    expect(lesson.source_id).toBe("exp-1");
    expect(lesson.observation).toContain("data/churn.csv");
  });
});

describe("训练入参解析", () => {
  it("显式数据集优先于当前选择", async () => {
    const { result } = renderTrainingActions();

    await act(() =>
      result.current.handleTrainModel("churn", "sklearn", false, null, "results/s1/planned.csv"),
    );

    expect(trainSklearnModel).toHaveBeenCalledWith(
      "project-1",
      "results/s1/planned.csv",
      "churn",
      "session-1",
      false,
      null,
    );
  });

  it("没有显式数据集时回退到训练数据集，再回退到活动文件", async () => {
    useUiStore.setState({ trainingDatasetPath: "", activeFile: "data/fallback.csv" });
    const { result } = renderTrainingActions();

    await act(() => result.current.handleTrainModel("churn", "sklearn", false));

    expect(vi.mocked(trainSklearnModel).mock.calls[0][1]).toBe("data/fallback.csv");
  });
});

describe("训练失败的处理", () => {
  it("记录错误、发出可重试事件，且不沉淀经验", async () => {
    vi.mocked(trainSklearnModel).mockRejectedValue(new Error("Target column was not found"));
    const { result, events } = renderTrainingActions();

    // 记录之后仍向上抛出，调用方据此给出自己的反馈
    await act(async () => {
      await expect(
        result.current.handleTrainModel("churn", "sklearn", false),
      ).rejects.toThrow("Target column was not found");
    });

    expect(useUiStore.getState().trainingError).toContain("Target column was not found");
    expect(events.find((event) => event.type === "step_failed")).toMatchObject({
      retryable: true,
      resume_stage: "train",
    });
    // 失败的运行没有可沉淀的结论
    expect(extractLesson).not.toHaveBeenCalled();
  });

  it("GPU 状态刷新失败不会连累训练结果", async () => {
    vi.mocked(getGPUStatus).mockRejectedValue(new Error("gpu offline"));
    const { result } = renderTrainingActions();

    await act(() => result.current.handleTrainModel("churn", "sklearn", true));

    expect(useUiStore.getState().trainingResult).toMatchObject({ experiment_id: "exp-1" });
    expect(useUiStore.getState().trainingError).toBeNull();
  });
});
