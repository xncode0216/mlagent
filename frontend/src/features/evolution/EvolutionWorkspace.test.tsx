// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getKnowledgeGraph, type KnowledgeGraphResult, type Lesson } from "../../lib/api";
import { EvolutionWorkspace } from "./EvolutionWorkspace";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getKnowledgeGraph: vi.fn(),
  };
});

vi.mock("./KnowledgeGraphCanvas", () => ({
  default: ({
    graph,
    onSelectNode,
    selectedNodeId,
  }: {
    graph: import("../../lib/api").KnowledgeGraphResult;
    onSelectNode: (node: import("../../lib/api").KnowledgeGraphNode) => void;
    selectedNodeId: string | null;
  }) => (
    <select
      aria-label="定位图谱节点"
      onChange={(event) => {
        const node = graph.nodes.find((candidate) => candidate.id === event.target.value);
        if (node) onSelectNode(node);
      }}
      value={selectedNodeId ?? ""}
    >
      {graph.nodes.map((node) => (
        <option key={node.id} value={node.id}>
          {node.label}
        </option>
      ))}
    </select>
  ),
}));

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

const graphWithProvenance: KnowledgeGraphResult = {
  nodes: [
    {
      id: "column-age",
      label: "age",
      type: "column",
      properties: {
        provenance: {
          column: "age",
          dataset_paths: ["data/customer_churn.csv"],
          kind: "dataset_column",
        },
        type: "numeric",
        missing_rate: 0,
      },
    },
    {
      id: "experiment-1",
      label: "baseline",
      type: "experiment",
      properties: {
        accuracy: 0.84,
        engine: "sklearn",
        provenance: {
          dataset_path: "data/customer_churn.csv",
          experiment_id: "run-1",
          kind: "experiment_run",
          metrics_path: "results/run-1.metrics.json",
          model_path: "models/run-1.model.json",
        },
        target_column: "churn",
      },
    },
  ],
  edges: [
    {
      id: "edge-1",
      source: "column-age",
      target: "experiment-1",
      label: "uses",
      type: "uses",
    },
  ],
  insights: [
    {
      type: "knowledge_gap",
      title: "年龄字段缺少稳定规则",
      description: "建议补充年龄字段的长期处理经验。",
      meta: { column: "age" },
    },
  ],
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

    expect(await screen.findByRole("combobox", { name: "定位图谱节点" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "age" })).toBeTruthy();
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

    expect(await screen.findByRole("combobox", { name: "定位图谱节点" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "刷新知识图谱" }));

    const region = screen.getByRole("region", { name: "自进化知识图谱" });
    await waitFor(() => expect(region.getAttribute("aria-busy")).toBe("true"));
    expect(within(region).getByText("正在更新知识图谱…")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "定位图谱节点" })).toBeTruthy();

    rejectRefresh?.(new Error("Graph refresh failed"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(within(screen.getByRole("alert")).getByText("Graph refresh failed")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "定位图谱节点" })).toBeTruthy();
  });

  it("preserves graph-to-file, graph-to-experiment, and insight-to-node navigation", async () => {
    const onSelectExperimentRun = vi.fn();
    const onSelectProjectFile = vi.fn();
    vi.mocked(getKnowledgeGraph).mockResolvedValue(graphWithProvenance);
    renderWorkspace({ onSelectExperimentRun, onSelectProjectFile });

    const locator = await screen.findByRole("combobox", { name: "定位图谱节点" });
    fireEvent.change(locator, { target: { value: "experiment-1" } });

    expect(await screen.findByText("SKLEARN")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "定位实验" }));
    expect(onSelectExperimentRun).toHaveBeenCalledWith("run-1");

    fireEvent.click(screen.getAllByRole("button", { name: "定位文件" })[0]!);
    expect(onSelectProjectFile).toHaveBeenCalledWith("data/customer_churn.csv");

    fireEvent.click(screen.getByRole("button", { name: /年龄字段缺少稳定规则/ }));
    await waitFor(() => expect((locator as HTMLSelectElement).value).toBe("column-age"));
    expect(screen.getByText("数值型 (Numeric)")).toBeTruthy();
  });
});

describe("已采纳规则的停用与启用", () => {
  function adoptedLesson(overrides: Partial<Lesson> = {}): Lesson {
    return {
      id: "lesson-1",
      source_type: "analysis",
      source_id: "session-1",
      domain: ["data_analysis"],
      observation: "低缺失率数值列适合中位数填充。",
      recommendation: "对偏态数值列优先使用中位数填充。",
      confidence: 0.82,
      status: "high_confidence",
      evidence: {},
      enabled: true,
      created_at: "2026-07-27T00:00:00Z",
      updated_at: "2026-07-27T00:00:00Z",
      ...overrides,
    };
  }

  function openRulesTab(lesson: Lesson, onSetEnabled = vi.fn(async () => undefined)) {
    renderWorkspace({ initialTab: "rules", lessons: [lesson], onSetLessonEnabled: onSetEnabled });
    fireEvent.click(screen.getByRole("button", { name: /中位数填充/ }));
    return onSetEnabled;
  }

  it("为生效中的规则提供停用入口", () => {
    const onSetEnabled = openRulesTab(adoptedLesson());

    fireEvent.click(screen.getByRole("button", { name: "停用规则" }));

    expect(onSetEnabled).toHaveBeenCalledWith("lesson-1", false);
  });

  it("已停用的规则显示为不再注入，并可重新启用", () => {
    const onSetEnabled = openRulesTab(adoptedLesson({ enabled: false }));

    expect(screen.getByText(/已停用/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新启用" }));

    expect(onSetEnabled).toHaveBeenCalledWith("lesson-1", true);
  });

  it("待审核的经验不提供停用入口", () => {
    openRulesTab(adoptedLesson({ status: "pending_review" }));

    expect(screen.queryByRole("button", { name: "停用规则" })).toBeNull();
  });
});
