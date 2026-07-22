// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getKnowledgeGraph, type KnowledgeGraphResult } from "../../lib/api";
import { EvolutionWorkspace } from "./EvolutionWorkspace";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getKnowledgeGraph: vi.fn(),
  };
});

const graph: KnowledgeGraphResult = {
  nodes: [
    {
      id: "column-age",
      label: "age",
      type: "column",
      properties: { type: "numeric", missing_rate: 0 },
    },
  ],
  edges: [],
  insights: [],
};

const baseProps: ComponentProps<typeof EvolutionWorkspace> = {
  projectId: "project-1",
  lessons: [],
  injectionLogs: [],
  protocols: [],
  initialTab: "graph",
  onAdopt: vi.fn(async () => undefined),
  onReject: vi.fn(async () => undefined),
  onMarkConflict: vi.fn(async () => undefined),
};

function renderWorkspace(overrides: Partial<ComponentProps<typeof EvolutionWorkspace>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { queryClient, ...render(<EvolutionWorkspace {...baseProps} {...overrides} />, { wrapper: Wrapper }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getKnowledgeGraph).mockReset();
});

afterEach(() => cleanup());

describe("EvolutionWorkspace knowledge graph async states", () => {
  it("explains that a project is required without issuing a graph request", () => {
    renderWorkspace({ projectId: "" });

    const region = screen.getByRole("region", { name: "自进化知识图谱" });
    expect(region.getAttribute("aria-busy")).toBe("false");
    expect(within(region).getByText("先创建或选择项目")).toBeTruthy();
    expect(getKnowledgeGraph).not.toHaveBeenCalled();
  });

  it("keeps the evidence-building guidance when the project graph is empty", async () => {
    vi.mocked(getKnowledgeGraph).mockResolvedValue({ nodes: [], edges: [], insights: [] });
    renderWorkspace();

    expect(await screen.findByText("还没有足够的演进证据生成知识图谱")).toBeTruthy();
    expect(screen.getByRole("button", { name: "刷新知识图谱" })).toBeTruthy();
  });

  it("marks the graph busy and renders a stable first-load skeleton", () => {
    vi.mocked(getKnowledgeGraph).mockImplementation(() => new Promise(() => undefined));
    const { container } = renderWorkspace();

    const region = screen.getByRole("region", { name: "自进化知识图谱" });
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(within(region).getByText("正在读取知识图谱…")).toBeTruthy();
    expect(container.querySelectorAll(".graph-skeleton-node")).toHaveLength(3);
  });

  it("shows a local error and recovers through the graph retry action", async () => {
    vi.mocked(getKnowledgeGraph)
      .mockRejectedValueOnce(new Error("Graph API unavailable"))
      .mockResolvedValueOnce(graph);
    renderWorkspace();

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Graph API unavailable")).toBeTruthy();
    fireEvent.click(within(alert).getByRole("button", { name: "重试知识图谱" }));

    expect(await screen.findByRole("button", { name: "数据特征列 age" })).toBeTruthy();
    expect(getKnowledgeGraph).toHaveBeenCalledTimes(2);
  });

  it("keeps the last graph visible while a background refresh runs and fails", async () => {
    let rejectRefresh: ((reason: Error) => void) | undefined;
    vi.mocked(getKnowledgeGraph)
      .mockResolvedValueOnce(graph)
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectRefresh = reject;
          }),
      );
    renderWorkspace();

    expect(await screen.findByRole("button", { name: "数据特征列 age" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "刷新知识图谱" }));

    const region = screen.getByRole("region", { name: "自进化知识图谱" });
    await waitFor(() => expect(region.getAttribute("aria-busy")).toBe("true"));
    expect(within(region).getByText("正在更新知识图谱…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "数据特征列 age" })).toBeTruthy();

    rejectRefresh?.(new Error("Graph refresh failed"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(within(screen.getByRole("alert")).getByText("Graph refresh failed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "数据特征列 age" })).toBeTruthy();
  });
});
