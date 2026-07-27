// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { KnowledgeGraphResult } from "../../lib/api";
import KnowledgeGraphCanvas from "./KnowledgeGraphCanvas";

const cytoscapeHarness = vi.hoisted(() => ({
  core: null as import("cytoscape").Core | null,
}));

vi.mock("cytoscape", async (importOriginal) => {
  const actual = await importOriginal<typeof import("cytoscape")>();
  const cytoscapeFactory = (
    actual as unknown as {
      default: (options?: import("cytoscape").CytoscapeOptions) => import("cytoscape").Core;
    }
  ).default;
  return {
    ...actual,
    default: (options: import("cytoscape").CytoscapeOptions) => {
      const core = cytoscapeFactory({
        ...options,
        container: undefined,
        headless: true,
        styleEnabled: true,
      });
      cytoscapeHarness.core = core;
      return core;
    },
  };
});

const graph: KnowledgeGraphResult = {
  nodes: [
    { id: "column-age", label: "age", type: "column", properties: {} },
    { id: "experiment-1", label: "baseline", type: "experiment", properties: {} },
    { id: "rule-1", label: "scale age", type: "rule", properties: {} },
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
  insights: [],
};

beforeEach(() => {
  const getComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const style = getComputedStyle(element);
    Object.defineProperty(style, "color", {
      configurable: true,
      value: "rgb(205, 214, 244)",
    });
    return style;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  cytoscapeHarness.core = null;
});

describe("KnowledgeGraphCanvas", () => {
  it("renders keyboard-accessible node location and viewport controls", async () => {
    render(
      <StrictMode>
        <KnowledgeGraphCanvas
          graph={graph}
          onSelectNode={vi.fn()}
          selectedNodeId="column-age"
        />
      </StrictMode>,
    );

    const locator = screen.getByRole("combobox", { name: "定位图谱节点" });
    expect((locator as HTMLSelectElement).value).toBe("column-age");
    expect(screen.getByRole("group", { name: "数据特征" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "模型实验" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "自进化规则" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "缩小知识图谱" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "放大知识图谱" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "适应知识图谱画布" })).toBeTruthy();
    expect(
      screen.getByRole("img", { name: /共 3 个节点、1 条关系/ }),
    ).toBeTruthy();

    await waitFor(() => expect(cytoscapeHarness.core?.nodes(".graph-data-node")).toHaveLength(3));
    expect(cytoscapeHarness.core?.nodes(".graph-cluster")).toHaveLength(3);

    const zoomBefore = cytoscapeHarness.core?.zoom() ?? 0;
    fireEvent.click(screen.getByRole("button", { name: "放大知识图谱" }));
    expect(cytoscapeHarness.core?.zoom()).toBeGreaterThan(zoomBefore);
  });

  it("selects a node through the accessible locator and mirrors selection in the graph", async () => {
    const onSelectNode = vi.fn();
    const { rerender } = render(
      <KnowledgeGraphCanvas
        graph={graph}
        onSelectNode={onSelectNode}
        selectedNodeId="column-age"
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "定位图谱节点" }), {
      target: { value: "experiment-1" },
    });
    expect(onSelectNode).toHaveBeenCalledWith(graph.nodes[1]);

    rerender(
      <KnowledgeGraphCanvas
        graph={graph}
        onSelectNode={onSelectNode}
        selectedNodeId="experiment-1"
      />,
    );
    await waitFor(() =>
      expect(cytoscapeHarness.core?.$id("experiment-1").hasClass("graph-selected")).toBe(true),
    );
  });

  it("focuses an insight-highlighted node without animated motion", async () => {
    const { rerender } = render(
      <KnowledgeGraphCanvas
        graph={graph}
        onSelectNode={vi.fn()}
        selectedNodeId="column-age"
      />,
    );

    rerender(
      <KnowledgeGraphCanvas
        graph={graph}
        highlightedNodeId="rule-1"
        onSelectNode={vi.fn()}
        selectedNodeId="rule-1"
      />,
    );

    await waitFor(() =>
      expect(cytoscapeHarness.core?.$id("rule-1").hasClass("graph-highlighted")).toBe(true),
    );
  });
});
