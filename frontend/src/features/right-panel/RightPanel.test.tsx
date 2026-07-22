// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readProjectFileContent, updateProjectFileContent, type ProjectFileContent } from "../../lib/api";
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
