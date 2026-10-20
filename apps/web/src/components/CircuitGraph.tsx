import {
  BUILTIN_BY_NAME,
  type CircuitIR,
  type CircuitNode,
  type CircuitOutput,
  type SimulationSnapshot,
} from "@shortcircuit/engine";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Check, Maximize, Minus, Plus, X } from "./Icons";

const CELL_WIDTH = 174;
const GAP_X = 86;
const GAP_Y = 24;
const PADDING = 54;
const EDGE_PADDING = 32;

type VisualKind = "input" | "state" | "constant" | "operation" | "output";

interface GraphNode {
  id: string;
  sourceId: string | null;
  kind: VisualKind;
  label: string;
  op?: string;
  width: number;
  scope: string[];
  line: number;
  column: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rank: number;
  value?: string;
  output?: CircuitOutput;
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  width: number;
}

interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

interface CircuitGraphProps {
  circuit: CircuitIR;
  snapshot: SimulationSnapshot | null;
}

function compactValue(binary: string | undefined, width: number): string {
  if (binary === undefined) return "?";
  if (binary.length <= 10) return binary;
  if (binary.length <= 64 && width % 4 === 0) {
    try {
      const hex = BigInt(`0b${binary}`).toString(16).toUpperCase();
      return `0x${hex.padStart(width / 4, "0")}`;
    } catch {
      return `${binary.slice(0, 6)}…`;
    }
  }
  return `${binary.slice(0, 8)}…`;
}

function decimalValue(binary: string | undefined): string {
  if (!binary) return "—";
  try {
    return BigInt(`0b${binary}`).toString(10);
  } catch {
    return "—";
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function nodeTitle(node: GraphNode): string {
  if (node.kind === "output") return "Exposed output";
  if (node.kind === "input") return "External input";
  if (node.kind === "state") return "Stored state";
  if (node.kind === "constant") return "Constant";
  const builtin = node.op ? BUILTIN_BY_NAME.get(node.op) : undefined;
  return builtin?.description ?? `${node.op ?? "Operation"} component`;
}

function buildLayout(
  circuit: CircuitIR,
  snapshot: SimulationSnapshot | null,
): GraphLayout {
  const byId = new Map(circuit.nodes.map((node) => [node.id, node]));
  const needed = new Set<string>();

  const visit = (id: string) => {
    if (needed.has(id)) return;
    const node = byId.get(id);
    if (!node) return;
    needed.add(id);
    for (const operand of node.operands) visit(operand);
  };

  for (const output of circuit.outputs) visit(output.node);
  for (const event of circuit.events) {
    for (const update of event.updates) visit(update.value);
  }
  for (const node of circuit.nodes) {
    if (node.kind === "input" || node.kind === "state") needed.add(node.id);
  }

  const visible = [...needed]
    .map((id) => byId.get(id))
    .filter((node): node is CircuitNode => Boolean(node));

  const values = snapshot?.nodes;
  const baseNodes = new Map<string, GraphNode>();
  for (const node of visible) {
    const kind: VisualKind =
      node.kind === "operation"
        ? "operation"
        : node.kind === "constant"
          ? "constant"
          : node.kind === "state"
            ? "state"
            : "input";
    baseNodes.set(node.id, {
      id: node.id,
      sourceId: node.id,
      kind,
      label: node.label,
      op: node.op,
      width: node.width,
      scope: node.scope,
      line: node.line,
      column: node.column,
      x: 0,
      y: 0,
      w: kind === "constant" ? 82 : 166,
      h: kind === "constant" ? 34 : 58,
      rank: 0,
      value: values?.[node.id],
    });
  }

  // Virtual output terminals share the final column.
  const outputNodes: GraphNode[] = circuit.outputs.map((output, index) => ({
    id: `output:${index}`,
    sourceId: output.node,
    kind: "output",
    label: output.name,
    width: output.width,
    scope: [],
    line: output.line,
    column: output.column,
    x: 0,
    y: 0,
    w: 166,
    h: 52,
    rank: 0,
    value: snapshot?.outputs[output.name]?.binary,
    output,
  }));

  const all = [...baseNodes.values(), ...outputNodes];
  const dependencies = new Map<string, string[]>();
  const edges: GraphEdge[] = [];
  for (const node of baseNodes.values()) {
    const original = byId.get(node.id);
    if (!original) continue;
    const deps = original.operands.filter((operand) => baseNodes.has(operand));
    dependencies.set(node.id, deps);
    for (const dep of deps) {
      edges.push({
        id: `${dep}->${node.id}`,
        from: dep,
        to: node.id,
        width: baseNodes.get(dep)?.width ?? 1,
      });
    }
  }
  for (const outputNode of outputNodes) {
    if (outputNode.sourceId && baseNodes.has(outputNode.sourceId)) {
      dependencies.set(outputNode.id, [outputNode.sourceId]);
      edges.push({
        id: `${outputNode.sourceId}->${outputNode.id}`,
        from: outputNode.sourceId,
        to: outputNode.id,
        width: outputNode.width,
      });
    } else {
      dependencies.set(outputNode.id, []);
    }
  }

  // Longest-path ranks: sources on the left, exposed outputs on the right.
  const ranks = new Map<string, number>();
  const ranking = new Set<string>();
  const rankOf = (id: string): number => {
    const cached = ranks.get(id);
    if (cached !== undefined) return cached;
    if (ranking.has(id)) return 0;
    ranking.add(id);
    const deps = dependencies.get(id) ?? [];
    const rank = deps.length === 0 ? 0 : Math.max(...deps.map((dep) => rankOf(dep) + 1));
    ranking.delete(id);
    ranks.set(id, rank);
    return rank;
  };
  for (const node of all) rankOf(node.id);
  const maxBaseRank = Math.max(
    0,
    ...all.filter((node) => !node.id.startsWith("output:")).map((node) => ranks.get(node.id) ?? 0),
  );
  for (const output of outputNodes) {
    ranks.set(output.id, maxBaseRank + 1);
  }

  const rankCount = maxBaseRank + 2;
  const columns: GraphNode[][] = Array.from({ length: rankCount }, () => []);
  for (const node of all) {
    node.rank = ranks.get(node.id) ?? 0;
    columns[node.rank]!.push(node);
  }

  const positionInColumn = new Map<string, number>();
  for (const column of columns) {
    column.sort((a, b) => {
      const kindOrder: Record<VisualKind, number> = {
        input: 0,
        state: 1,
        constant: 2,
        operation: 3,
        output: 4,
      };
      return kindOrder[a.kind] - kindOrder[b.kind] || a.label.localeCompare(b.label);
    });
    column.forEach((node, index) => positionInColumn.set(node.id, index));
  }

  for (let pass = 0; pass < 4; pass++) {
    for (let rank = 1; rank < columns.length; rank++) {
      const column = columns[rank]!;
      column.sort((a, b) => {
        const barycenter = (node: GraphNode) => {
          const deps = dependencies.get(node.id) ?? [];
          if (deps.length === 0) return positionInColumn.get(node.id) ?? 0;
          return (
            deps.reduce((sum, dep) => sum + (positionInColumn.get(dep) ?? 0), 0) / deps.length
          );
        };
        return barycenter(a) - barycenter(b) || a.label.localeCompare(b.label);
      });
      column.forEach((node, index) => positionInColumn.set(node.id, index));
    }
  }

  const totalColumnWidth = rankCount * CELL_WIDTH + (rankCount - 1) * GAP_X;
  let tallest = 0;
  for (const column of columns) {
    const height = column.reduce((sum, node) => sum + node.h, 0) + Math.max(0, column.length - 1) * GAP_Y;
    tallest = Math.max(tallest, height);
  }
  const height = Math.max(340, tallest + PADDING * 2);
  const width = Math.max(520, totalColumnWidth + PADDING * 2);

  columns.forEach((column, rank) => {
    const columnHeight = column.reduce((sum, node) => sum + node.h, 0) + Math.max(0, column.length - 1) * GAP_Y;
    let y = (height - columnHeight) / 2;
    const columnLeft = PADDING + rank * (CELL_WIDTH + GAP_X);
    for (const node of column) {
      node.x = columnLeft + (CELL_WIDTH - node.w) / 2;
      node.y = y;
      y += node.h + GAP_Y;
    }
  });

  return { nodes: all, edges, width, height };
}

function useElementSize(ref: React.RefObject<HTMLDivElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

export function CircuitGraph({ circuit, snapshot }: CircuitGraphProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(stageRef);
  const layout = useMemo(() => buildLayout(circuit, snapshot), [circuit, snapshot]);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ x: number; y: number; viewX: number; viewY: number; moved: boolean } | null>(null);

  const fit = () => {
    if (!size.width || !size.height) return;
    const scale = Math.max(
      0.2,
      Math.min(1.05, (size.width - EDGE_PADDING * 2) / layout.width, (size.height - EDGE_PADDING * 2) / layout.height),
    );
    setView({
      scale,
      x: (size.width - layout.width * scale) / 2,
      y: (size.height - layout.height * scale) / 2,
    });
  };

  useEffect(() => {
    fit();
    // Refit when a new circuit or viewport arrives, not when signal values change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circuit, layout.width, layout.height, size.width, size.height]);

  useEffect(() => {
    setSelectedId(null);
    setHoveredId(null);
  }, [circuit]);

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      setView((current) => {
        const factor = Math.exp(-event.deltaY * 0.0012);
        const nextScale = Math.max(0.18, Math.min(2.6, current.scale * factor));
        const ratio = nextScale / current.scale;
        return {
          scale: nextScale,
          x: cx - (cx - current.x) * ratio,
          y: cy - (cy - current.y) * ratio,
        };
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    setView((current) => {
      const nextScale = Math.max(0.18, Math.min(2.6, current.scale * factor));
      const ratio = nextScale / current.scale;
      const cx = size.width / 2;
      const cy = size.height / 2;
      return {
        scale: nextScale,
        x: cx - (cx - current.x) * ratio,
        y: cy - (cy - current.y) * ratio,
      };
    });
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    if ((event.target as Element).closest("[data-graph-node]")) return;
    dragRef.current = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y, moved: false };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    setView((current) => ({ ...current, x: drag.viewX + dx, y: drag.viewY + dy }));
  };
  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragRef.current && !dragRef.current.moved) setSelectedId(null);
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const connectedEdges = useMemo(() => {
    const active = selectedId ?? hoveredId;
    if (!active) return new Set<string>();
    return new Set(
      layout.edges
        .filter((edge) => edge.from === active || edge.to === active)
        .map((edge) => edge.id),
    );
  }, [layout.edges, selectedId, hoveredId]);

  const nodeMap = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout.nodes]);
  const selected = selectedId ? nodeMap.get(selectedId) : undefined;
  const originalSelected = selected?.sourceId
    ? circuit.nodes.find((node) => node.id === selected.sourceId)
    : undefined;

  const edgePath = (edge: GraphEdge) => {
    const from = nodeMap.get(edge.from);
    const to = nodeMap.get(edge.to);
    if (!from || !to) return "";
    const x1 = from.x + from.w;
    const y1 = from.y + from.h / 2;
    const x2 = to.x;
    const y2 = to.y + to.h / 2;
    const bend = Math.max(34, Math.abs(x2 - x1) * 0.45);
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
  };

  const edgeValue = (edge: GraphEdge) => {
    const from = nodeMap.get(edge.from);
    if (!from?.value) return "unknown";
    return from.value.includes("1") ? "high" : "low";
  };

  const activeNode = selectedId ?? hoveredId;

  if (layout.nodes.length === 0) {
    return (
      <div className="graph-stage graph-empty" ref={stageRef}>
        <p>No graph nodes to display.</p>
      </div>
    );
  }

  return (
    <div className={`graph-stage ${dragging ? "is-dragging" : ""}`} ref={stageRef}>
      <div className="graph-overlay graph-legend">
        <span className="live-values">
          <span className="live-dot" /> LIVE VALUES
        </span>
        <span className="legend-item">
          <i className="legend-line high" /> HIGH
        </span>
        <span className="legend-item">
          <i className="legend-line low" /> LOW
        </span>
      </div>

      <div className="graph-overlay graph-layers">
        <span>{layout.nodes.length} nodes</span>
        <span>{Math.max(...layout.nodes.map((node) => node.rank)) + 1} layers</span>
      </div>

      <svg
        className="circuit-graph"
        width={size.width}
        height={size.height}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="img"
        aria-label={`Circuit graph for ${circuit.name}`}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          <g className="graph-edges">
            {layout.edges.map((edge) => {
              const active = connectedEdges.has(edge.id);
              const muted = Boolean(activeNode) && !active;
              return (
                <g
                  key={edge.id}
                  className={`graph-edge ${edgeValue(edge)} ${active ? "is-active" : ""} ${
                    muted ? "is-muted" : ""
                  }`}
                >
                  <path d={edgePath(edge)} vectorEffect="non-scaling-stroke" />
                  {edge.width > 1 ? (
                    (() => {
                      const from = nodeMap.get(edge.from);
                      const to = nodeMap.get(edge.to);
                      if (!from || !to) return null;
                      const x = (from.x + from.w + to.x) / 2;
                      const y = (from.y + from.h / 2 + to.y + to.h / 2) / 2 - 6;
                      return (
                        <g className="edge-width" transform={`translate(${x} ${y})`}>
                          <rect x={-10} y={-8} width={20} height={13} rx={4} />
                          <text x={0} y={2} textAnchor="middle">
                            {edge.width}b
                          </text>
                        </g>
                      );
                    })()
                  ) : null}
                </g>
              );
            })}
          </g>

          <g className="graph-nodes">
            {layout.nodes.map((node) => {
              const active = node.id === selectedId || node.id === hoveredId;
              const connected =
                activeNode &&
                (connectedEdges.has(`${node.id}->${activeNode}`) ||
                  connectedEdges.has(`${activeNode}->${node.id}`));
              const valueState = node.value === undefined ? "unknown" : node.value.includes("1") ? "high" : "low";
              return (
                <g
                  key={node.id}
                  data-graph-node
                  className={`graph-node kind-${node.kind} ${active ? "is-active" : ""} ${
                    connected ? "is-connected" : ""
                  } value-${valueState}`}
                  transform={`translate(${node.x} ${node.y})`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${node.label}, ${nodeTitle(node)}, value ${node.value ?? "unknown"}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedId(node.id);
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => setHoveredId((current) => (current === node.id ? null : current))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedId(node.id);
                    }
                  }}
                >
                  <rect className="node-card" x={0} y={0} width={node.w} height={node.h} rx={node.kind === "constant" ? 9 : 11} />
                  <rect className="node-accent" x={0} y={12} width={3} height={node.h - 24} rx={2} />
                  {node.kind === "operation" ? (
                    <text className="node-op-glyph" x={13} y={21}>
                      {BUILTIN_BY_NAME.get(node.op ?? "")?.symbol ?? node.op?.slice(0, 3) ?? "OP"}
                    </text>
                  ) : null}
                  <text className="node-label" x={node.kind === "operation" ? 45 : 13} y={22}>
                    {truncate(node.label, node.kind === "operation" ? 15 : 20)}
                  </text>
                  <text className="node-sub" x={13} y={node.h - 12}>
                    {node.kind === "operation"
                      ? `${node.op ?? "OP"}${node.scope.length ? ` · ${truncate(node.scope.join("."), 13)}` : ""}`
                      : node.kind === "input"
                        ? "INPUT"
                        : node.kind === "state"
                          ? "STATE"
                          : node.kind === "constant"
                            ? "CONST"
                            : "OUTPUT"}
                  </text>
                  <text className="node-value" x={node.w - 11} y={22} textAnchor="end">
                    {compactValue(node.value, node.width)}
                  </text>
                  {node.width > 1 ? (
                    <text className="node-width" x={node.w - 11} y={node.h - 12} textAnchor="end">
                      {node.width}b
                    </text>
                  ) : null}
                  <title>
                    {node.label} · {nodeTitle(node)} · {node.value ?? "unknown"}
                  </title>
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      {selected ? (
        <aside className="graph-inspector">
          <div className="graph-inspector-head">
            <div>
              <span className="eyebrow">{nodeTitle(selected)}</span>
              <h3>{selected.label}</h3>
            </div>
            <button className="icon-button tiny" onClick={() => setSelectedId(null)} aria-label="Close node details">
              <X size={13} />
            </button>
          </div>
          <div className="graph-inspector-value">
            <span className="mono">{compactValue(selected.value, selected.width)}</span>
            <span>
              {selected.width} bit{selected.width === 1 ? "" : "s"}
            </span>
          </div>
          <dl>
            <div>
              <dt>Decimal</dt>
              <dd className="mono">{decimalValue(selected.value)}</dd>
            </div>
            <div>
              <dt>{selected.kind === "output" ? "Source" : "Type"}</dt>
              <dd>
                {selected.kind === "output"
                  ? selected.sourceId?.split("/").pop()
                  : selected.kind === "operation"
                    ? selected.op
                    : selected.kind}
              </dd>
            </div>
            <div>
              <dt>Scope</dt>
              <dd>{selected.scope.length ? selected.scope.join(".") : "top level"}</dd>
            </div>
            <div>
              <dt>Defined</dt>
              <dd>line {selected.line}</dd>
            </div>
            {originalSelected && originalSelected.operands.length > 0 ? (
              <div>
                <dt>Depends on</dt>
                <dd>
                  {originalSelected.operands
                    .map((operand) => nodeMap.get(operand)?.label ?? operand.split("/").pop())
                    .join(", ")}
                </dd>
              </div>
            ) : null}
          </dl>
          <span className="inspector-check">
            <Check size={11} /> declared in circuit
          </span>
        </aside>
      ) : null}

      <div className="graph-controls">
        <button className="graph-control" onClick={() => zoomBy(1.18)} aria-label="Zoom in">
          <Plus size={15} />
        </button>
        <button className="graph-control" onClick={() => zoomBy(0.85)} aria-label="Zoom out">
          <Minus size={15} />
        </button>
        <button className="graph-control" onClick={fit} aria-label="Fit graph">
          <Maximize size={14} />
        </button>
      </div>

      {layout.nodes.length > 90 ? (
        <div className="graph-warning">Large graph · use zoom or inspect a subcircuit</div>
      ) : null}
    </div>
  );
}
