import { Maximize2, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape, { type Core, type StylesheetJson } from "cytoscape";

import type { KnowledgeGraphNode, KnowledgeGraphResult } from "../../lib/api";
import {
  buildKnowledgeGraphElements,
  GRAPH_CLUSTER_DEFINITIONS,
  graphNodeTypeLabel,
} from "./knowledgeGraphElements";

type KnowledgeGraphCanvasProps = {
  graph: KnowledgeGraphResult;
  highlightedNodeId?: string | null;
  onSelectNode: (node: KnowledgeGraphNode) => void;
  selectedNodeId: string | null;
};

type GraphColors = {
  background: string;
  border: string;
  borderStrong: string;
  column: string;
  danger: string;
  experiment: string;
  muted: string;
  pink: string;
  rule: string;
  success: string;
  surface: string;
  text: string;
  textSecondary: string;
};

function resolveCssColor(container: HTMLElement, variable: string) {
  const probe = document.createElement("span");
  probe.style.color = `var(${variable})`;
  probe.style.display = "none";
  container.append(probe);
  const color = window.getComputedStyle(probe).color;
  probe.remove();
  return color;
}

function resolveGraphColors(container: HTMLElement): GraphColors {
  return {
    background: resolveCssColor(container, "--color-bg-raised"),
    border: resolveCssColor(container, "--color-border"),
    borderStrong: resolveCssColor(container, "--color-border-strong"),
    column: resolveCssColor(container, "--color-sky"),
    danger: resolveCssColor(container, "--color-danger"),
    experiment: resolveCssColor(container, "--color-ml"),
    muted: resolveCssColor(container, "--color-graph-muted"),
    pink: resolveCssColor(container, "--color-pink"),
    rule: resolveCssColor(container, "--color-warning"),
    success: resolveCssColor(container, "--color-success"),
    surface: resolveCssColor(container, "--color-bg-surface"),
    text: resolveCssColor(container, "--color-text"),
    textSecondary: resolveCssColor(container, "--color-text-secondary"),
  };
}

function graphStyles(colors: GraphColors): StylesheetJson {
  return [
    {
      selector: "node.graph-cluster",
      style: {
        "background-color": colors.surface,
        "background-opacity": 0.5,
        "border-color": colors.borderStrong,
        "border-style": "dashed",
        "border-width": 1,
        color: colors.textSecondary,
        "font-family": "Inter, system-ui, sans-serif",
        "font-size": 12,
        "font-weight": 600,
        label: "data(label)",
        "min-zoomed-font-size": 7,
        padding: "28px",
        shape: "roundrectangle",
        "text-halign": "center",
        "text-margin-y": -10,
        "text-valign": "top",
      },
    },
    {
      selector: "node.graph-data-node",
      style: {
        "background-color": colors.background,
        "border-color": colors.muted,
        "border-width": 2,
        color: colors.text,
        "font-family": "Inter, system-ui, sans-serif",
        "font-size": 13,
        "font-weight": 500,
        height: 38,
        label: "data(label)",
        "min-zoomed-font-size": 7,
        padding: "10px",
        "text-max-width": "104px",
        "text-overflow-wrap": "anywhere",
        "text-wrap": "ellipsis",
        width: "118px",
      },
    },
    {
      selector: "node.graph-node-column",
      style: {
        "border-color": colors.column,
        shape: "roundrectangle",
      },
    },
    {
      selector: "node.graph-node-experiment",
      style: {
        "border-color": colors.experiment,
        shape: "round-diamond",
      },
    },
    {
      selector: "node.graph-node-rule",
      style: {
        "border-color": colors.rule,
        shape: "round-tag",
      },
    },
    {
      selector: "edge.graph-edge",
      style: {
        "curve-style": "bezier",
        "font-family": "Inter, system-ui, sans-serif",
        "font-size": 10,
        label: "data(label)",
        "line-color": colors.muted,
        "min-zoomed-font-size": 8,
        opacity: 0.58,
        "target-arrow-color": colors.muted,
        "target-arrow-shape": "triangle",
        "text-background-color": colors.surface,
        "text-background-opacity": 0.84,
        "text-background-padding": "2px",
        "text-rotation": "autorotate",
        width: 1.5,
      },
    },
    {
      selector: "edge.graph-edge-produces",
      style: { "line-color": colors.danger, "target-arrow-color": colors.danger },
    },
    {
      selector: "edge.graph-edge-uses",
      style: { "line-color": colors.column, "target-arrow-color": colors.column },
    },
    {
      selector: "edge.graph-edge-triggers",
      style: { "line-color": colors.rule, "target-arrow-color": colors.rule },
    },
    {
      selector: "edge.graph-edge-supports",
      style: { "line-color": colors.success, "target-arrow-color": colors.success },
    },
    {
      selector: ".graph-muted",
      style: { opacity: 0.12 },
    },
    {
      selector: "edge.graph-neighbor",
      style: { opacity: 0.96, width: 3 },
    },
    {
      selector: "node.graph-data-node.graph-neighbor",
      style: { "border-width": 3 },
    },
    {
      selector: "node.graph-data-node.graph-selected",
      style: {
        "border-color": colors.pink,
        "border-width": 4,
      },
    },
    {
      selector: "node.graph-data-node.graph-highlighted",
      style: {
        "border-color": colors.success,
        "border-width": 5,
      },
    },
  ];
}

function graphTopologySignature(graph: KnowledgeGraphResult) {
  return [
    graph.nodes.map((node) => `${node.id}:${node.type}`).sort().join("|"),
    graph.edges.map((edge) => `${edge.id}:${edge.source}:${edge.target}`).sort().join("|"),
  ].join("::");
}

function replaceGraphElements(cy: Core, graph: KnowledgeGraphResult) {
  cy.batch(() => {
    cy.elements().remove();
    cy.add(buildKnowledgeGraphElements(graph));
  });
  cy.layout({
    animate: false,
    componentSpacing: 44,
    fit: true,
    gravity: 0.7,
    idealEdgeLength: 72,
    name: "cose",
    nestingFactor: 0.9,
    nodeRepulsion: 4200,
    padding: 28,
    randomize: true,
  }).run();
}

export default function KnowledgeGraphCanvas({
  graph,
  highlightedNodeId = null,
  onSelectNode,
  selectedNodeId,
}: KnowledgeGraphCanvasProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const cytoscapeRef = useRef<Core | null>(null);
  const graphRef = useRef(graph);
  const highlightedNodeIdRef = useRef(highlightedNodeId);
  const onSelectNodeRef = useRef(onSelectNode);
  const selectedNodeIdRef = useRef(selectedNodeId);
  const topologySignatureRef = useRef("");
  const [zoomPercent, setZoomPercent] = useState(100);

  graphRef.current = graph;
  highlightedNodeIdRef.current = highlightedNodeId;
  onSelectNodeRef.current = onSelectNode;
  selectedNodeIdRef.current = selectedNodeId;

  const groupedNodes = useMemo(
    () =>
      GRAPH_CLUSTER_DEFINITIONS.map((cluster) => ({
        ...cluster,
        nodes: graph.nodes.filter((node) => node.type === cluster.nodeType),
      })).filter((cluster) => cluster.nodes.length > 0),
    [graph.nodes],
  );

  useEffect(() => {
    const container = canvasRef.current;
    if (!container) return;

    const colors = resolveGraphColors(container);
    const cy = cytoscape({
      autounselectify: true,
      boxSelectionEnabled: false,
      container,
      elements: [],
      maxZoom: 2.5,
      minZoom: 0.45,
      motionBlur: false,
      style: graphStyles(colors),
    });
    cytoscapeRef.current = cy;

    const syncZoom = () => setZoomPercent(Math.round(cy.zoom() * 100));
    const clearNeighborhood = () => {
      cy.elements().removeClass("graph-muted graph-neighbor");
    };
    cy.on("zoom", syncZoom);
    cy.on("tap", "node.graph-data-node", (event) => {
      const node = graphRef.current.nodes.find((candidate) => candidate.id === event.target.id());
      if (node) onSelectNodeRef.current(node);
    });
    cy.on("mouseover", "node.graph-data-node", (event) => {
      const neighborhood = event.target.closedNeighborhood();
      clearNeighborhood();
      cy.elements().difference(neighborhood).addClass("graph-muted");
      neighborhood.addClass("graph-neighbor");
    });
    cy.on("mouseout", "node.graph-data-node", clearNeighborhood);

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            cy.resize();
          });
    resizeObserver?.observe(container);

    const themeObserver = new MutationObserver(() => {
      cy.style(graphStyles(resolveGraphColors(container)));
    });
    themeObserver.observe(document.documentElement, {
      attributeFilter: ["class", "data-brand-accent", "data-theme"],
      attributes: true,
    });

    const initialGraph = graphRef.current;
    topologySignatureRef.current = graphTopologySignature(initialGraph);
    replaceGraphElements(cy, initialGraph);
    if (selectedNodeIdRef.current) {
      cy.$id(selectedNodeIdRef.current).addClass("graph-selected");
    }
    if (highlightedNodeIdRef.current) {
      cy.$id(highlightedNodeIdRef.current).addClass("graph-highlighted");
    }
    syncZoom();
    return () => {
      resizeObserver?.disconnect();
      themeObserver.disconnect();
      cy.destroy();
      cytoscapeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const cy = cytoscapeRef.current;
    if (!cy) return;

    const nextSignature = graphTopologySignature(graph);
    const topologyChanged = topologySignatureRef.current !== nextSignature;
    topologySignatureRef.current = nextSignature;

    if (topologyChanged) {
      replaceGraphElements(cy, graph);
    } else {
      graph.nodes.forEach((node) => {
        cy.$id(node.id).data("label", node.label);
      });
    }
  }, [graph]);

  useEffect(() => {
    const cy = cytoscapeRef.current;
    if (!cy) return;
    cy.nodes(".graph-data-node").removeClass("graph-selected");
    if (selectedNodeId) cy.$id(selectedNodeId).addClass("graph-selected");
  }, [selectedNodeId, graph]);

  useEffect(() => {
    const cy = cytoscapeRef.current;
    if (!cy) return;
    cy.nodes(".graph-data-node").removeClass("graph-highlighted");
    if (!highlightedNodeId) return;
    const node = cy.$id(highlightedNodeId);
    if (node.empty()) return;
    node.addClass("graph-highlighted");
    cy.fit(node.closedNeighborhood(), 56);
  }, [highlightedNodeId, graph]);

  const changeZoom = (factor: number) => {
    const cy = cytoscapeRef.current;
    if (!cy) return;
    const nextZoom = Math.min(cy.maxZoom(), Math.max(cy.minZoom(), cy.zoom() * factor));
    cy.zoom({ level: nextZoom, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  };

  const fitGraph = () => {
    const cy = cytoscapeRef.current;
    if (!cy) return;
    cy.fit(cy.elements(), 36);
  };

  const selectNode = (nodeId: string) => {
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;
    onSelectNode(node);
    const cyNode = cytoscapeRef.current?.$id(node.id);
    if (cyNode && !cyNode.empty()) cytoscapeRef.current?.center(cyNode);
  };

  return (
    <section className="knowledge-graph-canvas" aria-label="交互式知识图谱画布">
      <div className="graph-canvas-toolbar">
        <label className="graph-node-locator">
          <span>定位节点</span>
          <select
            aria-label="定位图谱节点"
            onChange={(event) => selectNode(event.target.value)}
            value={selectedNodeId ?? ""}
          >
            <option disabled value="">
              选择节点
            </option>
            {groupedNodes.map((cluster) => (
              <optgroup key={cluster.id} label={cluster.label}>
                {cluster.nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="graph-viewport-controls" aria-label="图谱视口控制">
          <button aria-label="缩小知识图谱" onClick={() => changeZoom(0.82)} title="缩小" type="button">
            <Minus aria-hidden="true" size={16} />
          </button>
          <output aria-label="知识图谱缩放比例">{zoomPercent}%</output>
          <button aria-label="放大知识图谱" onClick={() => changeZoom(1.22)} title="放大" type="button">
            <Plus aria-hidden="true" size={16} />
          </button>
          <button aria-label="适应知识图谱画布" onClick={fitGraph} title="显示全部" type="button">
            <Maximize2 aria-hidden="true" size={16} />
          </button>
        </div>
      </div>
      <div
        aria-label={`知识图谱，共 ${graph.nodes.length} 个节点、${graph.edges.length} 条关系。可拖拽平移、滚轮缩放；也可使用上方定位控件选择节点。`}
        className="cytoscape-canvas"
        ref={canvasRef}
        role="img"
      />
      <p className="graph-canvas-help">
        拖拽空白处平移，滚轮缩放，拖拽节点调整布局；键盘用户可通过“定位节点”访问全部
        {graph.nodes.map((node) => graphNodeTypeLabel(node.type)).filter((label, index, labels) => labels.indexOf(label) === index).join("、")}。
      </p>
    </section>
  );
}
