// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readProjectFileContent, type ProjectFileContent } from "../../lib/api";
import { useUiStore } from "../../app/uiStore";
import type { AgentStreamEvent } from "../chat/types";
import { RightPanel } from "./RightPanel";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    readProjectFileContent: vi.fn(),
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

function fileContent(content: string): ProjectFileContent {
  return {
    path: artifactPath,
    content,
    size: content.length,
    mime_type: "application/json",
  };
}

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { queryClient, ...render(<RightPanel {...baseProps} />, { wrapper: Wrapper }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readProjectFileContent).mockReset();
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
