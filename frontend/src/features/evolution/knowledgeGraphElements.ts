import type cytoscape from "cytoscape";

import type { KnowledgeGraphNode, KnowledgeGraphResult } from "../../lib/api";

export const GRAPH_CLUSTER_DEFINITIONS: ReadonlyArray<{
  id: string;
  label: string;
  nodeType: KnowledgeGraphNode["type"];
}> = [
  { id: "graph-cluster-column", label: "数据特征", nodeType: "column" },
  { id: "graph-cluster-experiment", label: "模型实验", nodeType: "experiment" },
  { id: "graph-cluster-rule", label: "自进化规则", nodeType: "rule" },
];

const clusterIdByNodeType = new Map(
  GRAPH_CLUSTER_DEFINITIONS.map((cluster) => [cluster.nodeType, cluster.id]),
);

export function graphNodeTypeLabel(type: KnowledgeGraphNode["type"]) {
  switch (type) {
    case "column":
      return "数据特征列";
    case "experiment":
      return "模型训练实验";
    case "rule":
      return "自进化经验";
  }
}

export function buildKnowledgeGraphElements(
  graph: KnowledgeGraphResult,
): cytoscape.ElementDefinition[] {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const populatedNodeTypes = new Set(graph.nodes.map((node) => node.type));
  const clusterElements: cytoscape.NodeDefinition[] = GRAPH_CLUSTER_DEFINITIONS.filter(
    (cluster) => populatedNodeTypes.has(cluster.nodeType),
  ).map((cluster) => ({
      group: "nodes",
      data: {
        id: cluster.id,
        label: cluster.label,
        nodeType: cluster.nodeType,
        isCluster: true,
      },
      classes: `graph-cluster graph-cluster-${cluster.nodeType}`,
    }));
  const nodeElements: cytoscape.NodeDefinition[] = graph.nodes.map((node) => ({
    group: "nodes",
    data: {
      id: node.id,
      label: node.label,
      nodeType: node.type,
      parent: clusterIdByNodeType.get(node.type),
      isCluster: false,
    },
    classes: `graph-data-node graph-node-${node.type}`,
  }));
  const edgeElements: cytoscape.EdgeDefinition[] = graph.edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => ({
      group: "edges",
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        edgeType: edge.type,
      },
      classes: `graph-edge graph-edge-${edge.type}`,
    }));

  return [...clusterElements, ...nodeElements, ...edgeElements];
}
