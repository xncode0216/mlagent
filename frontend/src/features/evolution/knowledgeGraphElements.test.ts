import { describe, expect, it } from "vitest";

import type { KnowledgeGraphResult } from "../../lib/api";
import {
  buildKnowledgeGraphElements,
  GRAPH_CLUSTER_DEFINITIONS,
  graphNodeTypeLabel,
} from "./knowledgeGraphElements";

const graph: KnowledgeGraphResult = {
  nodes: [
    { id: "column-age", label: "age", type: "column", properties: {} },
    { id: "experiment-1", label: "baseline", type: "experiment", properties: {} },
    { id: "rule-1", label: "age should be scaled", type: "rule", properties: {} },
  ],
  edges: [
    {
      id: "edge-valid",
      source: "column-age",
      target: "experiment-1",
      label: "uses",
      type: "uses",
    },
    {
      id: "edge-orphaned",
      source: "missing-node",
      target: "rule-1",
      label: "supports",
      type: "supports",
    },
  ],
  insights: [],
};

describe("knowledge graph element mapping", () => {
  it("creates one compound parent for every supported graph domain", () => {
    const elements = buildKnowledgeGraphElements(graph);
    const clusters = elements.filter((element) => element.classes?.includes("graph-cluster"));

    expect(clusters).toHaveLength(3);
    expect(clusters.map((element) => element.data.id)).toEqual(
      GRAPH_CLUSTER_DEFINITIONS.map((cluster) => cluster.id),
    );
  });

  it("does not add disconnected cluster parents for domains without nodes", () => {
    const elements = buildKnowledgeGraphElements({
      nodes: [{ id: "column-age", label: "age", type: "column", properties: {} }],
      edges: [],
      insights: [],
    });
    const clusters = elements.filter((element) => element.classes?.includes("graph-cluster"));

    expect(clusters.map((element) => element.data.id)).toEqual(["graph-cluster-column"]);
  });

  it("assigns every real node to its semantic cluster", () => {
    const elements = buildKnowledgeGraphElements(graph);
    const nodes = elements.filter((element) => element.classes?.includes("graph-data-node"));

    expect(nodes.map((element) => [element.data.id, element.data.parent])).toEqual([
      ["column-age", "graph-cluster-column"],
      ["experiment-1", "graph-cluster-experiment"],
      ["rule-1", "graph-cluster-rule"],
    ]);
  });

  it("preserves canonical edge ids and excludes edges whose endpoint is missing", () => {
    const elements = buildKnowledgeGraphElements(graph);
    const edges = elements.filter((element) => element.group === "edges");

    expect(edges).toHaveLength(1);
    expect(edges[0]?.data).toMatchObject({
      id: "edge-valid",
      source: "column-age",
      target: "experiment-1",
      edgeType: "uses",
    });
  });

  it("provides accessible Chinese node type labels", () => {
    expect(graphNodeTypeLabel("column")).toBe("数据特征列");
    expect(graphNodeTypeLabel("experiment")).toBe("模型训练实验");
    expect(graphNodeTypeLabel("rule")).toBe("自进化经验");
  });
});
