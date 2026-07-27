// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  readProjectFileContent,
  updateProjectFileContent,
  type ExperimentRun,
  type ProjectFileContent,
} from "../../lib/api";
import { useUiStore } from "../../app/uiStore";
import type { AgentStreamEvent } from "../chat/types";
import { RightPanel } from "./RightPanel";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    readProjectFileContent: vi.fn(),
    updateProjectFileContent: vi.fn(),
  };
});

const artifactPath = "results/profile.json";
const artifactEvent: AgentStreamEvent = {
  type: "artifact_created",
  artifact: {
    id: "artifact-profile",
    project_id: "project-1",
    session_id: "session-1",
    type: "dataframe",
    name: "Data profile",
    path: artifactPath,
    metadata: {},
    created_at: "2026-07-22T00:00:00Z",
  },
};

const baseProps: ComponentProps<typeof RightPanel> = {
  events: [artifactEvent],
  projectId: "project-1",
  sessionId: "session-1",
  trainingRuns: [],
  gpuStatus: null,
  onCleanDataset: vi.fn(async () => undefined),
  onExecutePreprocessingPlan: vi.fn(async () => undefined),
  onExportRunBundle: vi.fn(async () => undefined),
  onGenerateReport: vi.fn(async () => undefined),
  onGenerateEvaluationReport: vi.fn(async () => undefined),
  onGenerateProfile: vi.fn(async () => undefined),
  onGeneratePreprocessingPlan: vi.fn(async () => undefined),
  onTransferToMl: vi.fn(async () => undefined),
  onSelectFile: vi.fn(),
  onTrainModel: vi.fn(async () => undefined),
  onCancelGpuTask: vi.fn(async () => undefined),
  onRefreshGpuStatus: vi.fn(async () => undefined),
};

function fileContent(
  content: string,
  path = artifactPath,
  mimeType = "application/json",
): ProjectFileContent {
  return {
    path,
    content,
    size: content.length,
    mime_type: mimeType,
  };
}

function trainingRun(overrides: Partial<ExperimentRun> = {}): ExperimentRun {
  return {
    experiment_id: "experiment-baseline",
    project_id: "project-1",
    status: "completed",
    engine: "baseline",
    dataset_path: "data/customer_churn.csv",
    target_column: "churn",
    use_gpu: false,
    best_model_name: "MajorityClass",
    metrics: { accuracy: 0.7, f1_weighted: 0.68, eval_row_count: 10 },
    model: {},
    candidate_runs: [],
    model_artifact: { type: "model", name: "Model", path: "models/model.json" },
    metrics_artifact: {
      id: "metrics",
      type: "training",
      name: "Metrics",
      path: "results/metrics.json",
      created_at: "2026-07-22T00:00:00Z",
    },
    created_at: "2026-07-22T00:00:00Z",
    ...overrides,
  };
}

function renderPanel(overrides: Partial<ComponentProps<typeof RightPanel>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { queryClient, ...render(<RightPanel {...baseProps} {...overrides} />, { wrapper: Wrapper }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readProjectFileContent).mockReset();
  vi.mocked(updateProjectFileContent).mockReset();
  useUiStore.setState({
    activeMode: "analysis",
    activeFile: "",
    rightPanelTab: "data",
    selectedPreprocessingPlanPath: null,
    trainingDatasetPath: "",
  });
});

afterEach(() => cleanup());

describe("RightPanel artifact preview async states", () => {
  it("marks the preview busy and shows a stable first-load skeleton", async () => {
    vi.mocked(readProjectFileContent).mockImplementation(() => new Promise(() => undefined));
    renderPanel();

    const preview = await screen.findByRole("region", { name: "产物预览" });
    expect(preview.getAttribute("aria-busy")).toBe("true");
    expect(within(preview).getByText("正在读取产物内容…")).toBeTruthy();
    expect(preview.querySelectorAll(".inspector-skeleton-row")).toHaveLength(3);
  });

  it("shows an actionable read error and retries locally", async () => {
    vi.mocked(readProjectFileContent)
      .mockRejectedValueOnce(new Error("Artifact network unavailable"))
      .mockResolvedValueOnce(fileContent('{"status":"recovered"}'));
    renderPanel();

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Artifact network unavailable")).toBeTruthy();
    fireEvent.click(within(alert).getByRole("button", { name: "重试产物内容" }));

    expect(await screen.findByText(/recovered/)).toBeTruthy();
    expect(readProjectFileContent).toHaveBeenCalledTimes(2);
  });

  it("keeps the last real preview visible when a background refresh fails", async () => {
    vi.mocked(readProjectFileContent)
      .mockResolvedValueOnce(fileContent('{"status":"stable"}'))
      .mockRejectedValueOnce(new Error("Artifact refresh failed"));
    const { queryClient } = renderPanel();

    expect(await screen.findByText(/stable/)).toBeTruthy();
    await queryClient.invalidateQueries({ queryKey: ["project-file-content", "project-1", artifactPath] });

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(/stable/)).toBeTruthy();
    expect(within(screen.getByRole("alert")).getByText("Artifact refresh failed")).toBeTruthy();
  });
});

describe("RightPanel active file preview async states", () => {
  const activePath = "src/model.py";

  function renderActiveFile(mode: "code" | "data" = "code") {
    useUiStore.setState({ activeFile: activePath, rightPanelTab: mode });
    return renderPanel({ events: [] });
  }

  it("marks the active file preview busy and shows a stable first-load skeleton", () => {
    vi.mocked(readProjectFileContent).mockImplementation(() => new Promise(() => undefined));
    const { container } = renderActiveFile();

    const preview = screen.getByRole("region", { name: "活动文件预览" });
    expect(preview.getAttribute("aria-busy")).toBe("true");
    expect(within(preview).getByText("正在读取文件内容…")).toBeTruthy();
    expect(container.querySelectorAll(".active-file-preview .inspector-skeleton-row")).toHaveLength(3);
  });

  it("shows a local read error and retries without leaving the file panel", async () => {
    vi.mocked(readProjectFileContent)
      .mockRejectedValueOnce(new Error("File API unavailable"))
      .mockResolvedValueOnce(fileContent("print('recovered')", activePath, "text/x-python"));
    renderActiveFile();

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("File API unavailable")).toBeTruthy();
    fireEvent.click(within(alert).getByRole("button", { name: "重试文件内容" }));

    const editor = await screen.findByRole("textbox", { name: "文件内容编辑器" });
    expect((editor as HTMLTextAreaElement).value).toContain("recovered");
    expect(readProjectFileContent).toHaveBeenCalledTimes(2);
  });

  it("preserves an unsaved draft while a background refresh runs and fails", async () => {
    let rejectRefresh: ((reason: Error) => void) | undefined;
    vi.mocked(readProjectFileContent)
      .mockResolvedValueOnce(fileContent("server content", activePath, "text/x-python"))
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectRefresh = reject;
          }),
      );
    const { queryClient } = renderActiveFile();

    const editor = await screen.findByRole("textbox", { name: "文件内容编辑器" });
    fireEvent.change(editor, { target: { value: "local unsaved draft" } });
    void queryClient.invalidateQueries({ queryKey: ["project-file-content", "project-1", activePath] });

    const preview = screen.getByRole("region", { name: "活动文件预览" });
    await waitFor(() => expect(preview.getAttribute("aria-busy")).toBe("true"));
    expect(within(preview).getByText("正在刷新文件内容…")).toBeTruthy();
    expect((editor as HTMLTextAreaElement).value).toBe("local unsaved draft");

    rejectRefresh?.(new Error("File refresh failed"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(within(screen.getByRole("alert")).getByText("File refresh failed")).toBeTruthy();
    expect((editor as HTMLTextAreaElement).value).toBe("local unsaved draft");
  });

  it("writes the saved content into the query cache and invalidates file metadata", async () => {
    vi.mocked(readProjectFileContent).mockResolvedValue(fileContent("old", activePath, "text/x-python"));
    vi.mocked(updateProjectFileContent).mockResolvedValue(fileContent("saved draft", activePath, "text/x-python"));
    const { queryClient } = renderActiveFile();
    queryClient.setQueryData(["files", "project-1", []], []);

    const editor = await screen.findByRole("textbox", { name: "文件内容编辑器" });
    fireEvent.change(editor, { target: { value: "saved draft" } });
    fireEvent.click(screen.getByRole("button", { name: "保存文件" }));

    await waitFor(() => expect(within(screen.getByRole("region", { name: "活动文件预览" })).getByText("已保存")).toBeTruthy());
    expect(queryClient.getQueryData(["project-file-content", "project-1", activePath, "current"])).toEqual(
      fileContent("saved draft", activePath, "text/x-python"),
    );
    expect(queryClient.getQueryState(["files", "project-1", []])?.isInvalidated).toBe(true);
  });

  it("offers a download action when the selected file is binary", async () => {
    vi.mocked(readProjectFileContent).mockRejectedValue(new Error("HTTP 415 Unsupported Media Type"));
    renderActiveFile("data");

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("当前文件是二进制内容，暂不支持直接预览。")).toBeTruthy();
    expect(within(alert).getByRole("link", { name: "下载二进制文件" })).toBeTruthy();
    expect(within(alert).queryByRole("button", { name: "重试文件内容" })).toBeNull();
  });
});

describe("RightPanel training information empty states", () => {
  function renderTrainingPanel(run: ExperimentRun) {
    useUiStore.setState({
      activeMode: "machine-learning",
      activeFile: run.dataset_path,
      rightPanelTab: "training",
    });
    return renderPanel({ events: [], trainingRuns: [run] });
  }

  it("explains an empty experiment filter and restores all runs", () => {
    renderTrainingPanel(trainingRun());

    fireEvent.change(screen.getByLabelText("Filter"), { target: { value: "gpu" } });

    expect(screen.getByText("当前筛选没有匹配的实验")).toBeTruthy();
    expect(screen.getByText("重置筛选后可查看全部历史运行。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重置实验筛选" }));

    expect(screen.queryByText("当前筛选没有匹配的实验")).toBeNull();
    expect(screen.getByText("MajorityClass")).toBeTruthy();
    expect((screen.getByLabelText("Filter") as HTMLSelectElement).value).toBe("all");
  });

  it("explains an empty prediction-sample filter and restores all samples", async () => {
    const samplePath = "results/prediction_samples.json";
    vi.mocked(readProjectFileContent).mockResolvedValue(
      fileContent(
        JSON.stringify({
          samples: [
            { row_index: 12, actual: "no", predicted: "no", is_error: false, features: { tenure: 3 } },
            { row_index: 18, actual: "yes", predicted: "no", is_error: true, features: { tenure: 11 } },
          ],
        }),
        samplePath,
      ),
    );
    renderTrainingPanel(
      trainingRun({
        prediction_samples_artifact: {
          id: "samples",
          type: "dataframe",
          name: "Prediction samples",
          path: samplePath,
          created_at: "2026-07-22T00:00:00Z",
        },
      }),
    );

    expect(await screen.findByText("2 / 2 samples")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "no-such-sample" } });

    expect(screen.getByText("当前筛选没有匹配的预测样本")).toBeTruthy();
    expect(screen.getByText("调整条件，或重置筛选后查看全部样本。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重置样本筛选" }));

    expect(screen.queryByText("当前筛选没有匹配的预测样本")).toBeNull();
    expect(screen.getByText("2 / 2 samples")).toBeTruthy();
    expect((screen.getByLabelText("Search") as HTMLInputElement).value).toBe("");
  });
});

describe("RightPanel 变换报告 diff 预览", () => {
  const transformReport = {
    source_dataset_path: "data/customer_churn.csv",
    output_dataset_path: "results/session-1/customer_churn_planned.csv",
    target_column: "churn",
    input_shape: { rows: 120, columns: 4 },
    output_shape: { rows: 120, columns: 4 },
    drop_columns: ["customer_id"],
    numeric_features: ["age"],
    categorical_features: ["contract"],
    encoded_feature_columns: ["age", "contract_annual", "contract_monthly"],
    transformations: {
      numeric: {
        age: { imputer: "median", fill_value: 41, scaler: "standard", mean: 41.2, std: 12.4 },
      },
      categorical: {
        contract: {
          imputer: "most_frequent",
          fill_value: "monthly",
          encoder: "one_hot_ignore_unknown",
        },
      },
    },
  };

  it("把变换报告渲染成逐列的输入到输出对照", async () => {
    vi.mocked(readProjectFileContent).mockResolvedValue(
      fileContent(JSON.stringify(transformReport)),
    );
    renderPanel();

    const diff = await screen.findByRole("table", { name: "预处理变换列对照" });
    const droppedRow = within(diff).getByRole("row", { name: /customer_id/ });
    expect(within(droppedRow).getByText("已丢弃")).toBeTruthy();

    const categoricalRow = within(diff).getByRole("row", { name: /contract_annual/ });
    expect(within(categoricalRow).getByText(/one_hot_ignore_unknown/)).toBeTruthy();
  });

  it("行数变化时给出明确提示", async () => {
    vi.mocked(readProjectFileContent).mockResolvedValue(
      fileContent(JSON.stringify({ ...transformReport, output_shape: { rows: 100, columns: 4 } })),
    );
    renderPanel();

    expect(await screen.findByRole("status", { name: "变换行数变化" })).toBeTruthy();
  });
});
