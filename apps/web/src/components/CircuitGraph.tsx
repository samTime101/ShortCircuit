import {
  BUILTIN_BY_NAME,
  BUILTINS,
  type CircuitIR,
  type CircuitNode,
  type SimulationSnapshot,
} from "@shortcircuit/engine";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { explainNode, gateTruthTable } from "./nodeExplain";
import { Check, Maximize, Minus, Plus, X } from "./Icons";

const CELL_WIDTH = 174;
const GAP_X = 86;
const GAP_Y = 24;
const PADDING = 54;
const EDGE_PADDING = 32;

/** Extra world space kept around the viewport so panning does not pop. */
const VIEW_OVERSCAN = 180;
/** Bus badges are useful, but only draw them when the view can afford them. */
const MAX_WIDTH_BADGES = 160;
const MIN_BADGE_SCALE = 0.7;
/** Below this zoom, text is unreadable, so nodes collapse to colored blocks. */
const MIN_DETAIL_SCALE = 0.5;
/** Above this zoom, draw the full curved wires; below it, straight lines. */
const MIN_CURVE_SCALE = 0.7;
/** Manual wheel and button zoom limits. The lower bound leaves room to see wide graphs. */
const MIN_ZOOM = 0.01;
const MAX_ZOOM = 2.6;
/** Below this zoom, individual node elements cost more than they can show. */
const MIN_NODE_BATCH_SCALE = 0.12;
/** The kind accent is sub-pixel below this zoom, so it is skipped. */
const MIN_ACCENT_SCALE = 0.2;

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
  title: string;
  displayLabel: string;
  subLabel: string;
  opGlyph: string;
}

interface GraphEdge {
  id: string;
  key: string;
  from: string;
  to: string;
  width: number;
  /** Precomputed curve, so panning and zooming never rebuild edge geometry. */
  path: string;
  /** Straight fallback used when wires are too small for curvature to read. */
  straightPath: string;
  labelX: number;
  labelY: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Undirected adjacency, used to highlight the selected node's neighbors. */
  neighbors: Map<string, Set<string>>;
  depth: number;
  width: number;
  height: number;
}

interface GraphView {
  scale: number;
  x: number;
  y: number;
}

interface Viewport extends GraphView {
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

function nodeTitle(kind: VisualKind, op?: string): string {
  if (kind === "output") return "Exposed output";
  if (kind === "input") return "External input";
  if (kind === "state") return "Stored state";
  if (kind === "constant") return "Constant";
  const builtin = op ? BUILTIN_BY_NAME.get(op) : undefined;
  return builtin?.description ?? `${op ?? "Operation"} component`;
}

/**
 * Builds the static geometry for a circuit. Signal values are deliberately
 * kept out of this pass: the layout only changes when the circuit does, while
 * values change on every simulation tick.
 */
export function buildLayout(circuit: CircuitIR): GraphLayout {
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
      title: nodeTitle(kind, node.op),
      displayLabel: truncate(node.label, kind === "operation" ? 15 : 20),
      subLabel:
        kind === "operation"
          ? `${node.op ?? "OP"}${
              node.scope.length ? ` · ${truncate(node.scope.join("."), 13)}` : ""
            }`
          : kind === "input"
            ? "INPUT"
            : kind === "state"
              ? "STATE"
              : "LITERAL",
      opGlyph:
        kind === "operation"
          ? (BUILTIN_BY_NAME.get(node.op ?? "")?.symbol ?? node.op?.slice(0, 3) ?? "OP")
          : "",
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
    title: nodeTitle("output"),
    displayLabel: truncate(output.name, 20),
    subLabel: "OUTPUT",
    opGlyph: "",
  }));

  const all = [...baseNodes.values(), ...outputNodes];
  const dependencies = new Map<string, string[]>();
  const neighbors = new Map<string, Set<string>>();
  const edges: GraphEdge[] = [];
  let edgeSerial = 0;

  const connect = (from: string, to: string) => {
    let set = neighbors.get(from);
    if (!set) {
      set = new Set();
      neighbors.set(from, set);
    }
    set.add(to);
  };

  for (const node of baseNodes.values()) {
    const original = byId.get(node.id);
    if (!original) continue;
    const deps = original.operands.filter((operand) => baseNodes.has(operand));
    dependencies.set(node.id, deps);
    for (const dep of deps) {
      edges.push({
        id: `${dep}->${node.id}`,
        key: `${dep}->${node.id}:${edgeSerial++}`,
        from: dep,
        to: node.id,
        width: baseNodes.get(dep)?.width ?? 1,
        path: "",
        straightPath: "",
        labelX: 0,
        labelY: 0,
        minX: 0,
        minY: 0,
        maxX: 0,
        maxY: 0,
      });
      connect(dep, node.id);
      connect(node.id, dep);
    }
  }

  for (const outputNode of outputNodes) {
    if (outputNode.sourceId && baseNodes.has(outputNode.sourceId)) {
      dependencies.set(outputNode.id, [outputNode.sourceId]);
      edges.push({
        id: `${outputNode.sourceId}->${outputNode.id}`,
        key: `${outputNode.sourceId}->${outputNode.id}:${edgeSerial++}`,
        from: outputNode.sourceId,
        to: outputNode.id,
        width: outputNode.width,
        path: "",
        straightPath: "",
        labelX: 0,
        labelY: 0,
        minX: 0,
        minY: 0,
        maxX: 0,
        maxY: 0,
      });
      connect(outputNode.sourceId, outputNode.id);
      connect(outputNode.id, outputNode.sourceId);
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
    let rank = 0;
    for (const dep of deps) {
      const candidate = rankOf(dep) + 1;
      if (candidate > rank) rank = candidate;
    }
    ranking.delete(id);
    ranks.set(id, rank);
    return rank;
  };
  for (const node of all) rankOf(node.id);

  let maxBaseRank = 0;
  for (const node of all) {
    if (node.id.startsWith("output:")) continue;
    const rank = ranks.get(node.id) ?? 0;
    if (rank > maxBaseRank) maxBaseRank = rank;
  }
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
    const height =
      column.reduce((sum, node) => sum + node.h, 0) + Math.max(0, column.length - 1) * GAP_Y;
    tallest = Math.max(tallest, height);
  }
  const height = Math.max(340, tallest + PADDING * 2);
  const width = Math.max(520, totalColumnWidth + PADDING * 2);

  columns.forEach((column, rank) => {
    const columnHeight =
      column.reduce((sum, node) => sum + node.h, 0) + Math.max(0, column.length - 1) * GAP_Y;
    let y = (height - columnHeight) / 2;
    const columnLeft = PADDING + rank * (CELL_WIDTH + GAP_X);
    for (const node of column) {
      node.x = columnLeft + (CELL_WIDTH - node.w) / 2;
      node.y = y;
      y += node.h + GAP_Y;
    }
  });

  const nodeById = new Map(all.map((node) => [node.id, node]));
  for (const edge of edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue;
    const x1 = from.x + from.w;
    const y1 = from.y + from.h / 2;
    const x2 = to.x;
    const y2 = to.y + to.h / 2;
    const bend = Math.max(34, Math.abs(x2 - x1) * 0.45);
    edge.path = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
    edge.straightPath = `M ${x1} ${y1} L ${x2} ${y2}`;
    edge.labelX = (x1 + x2) / 2;
    edge.labelY = (y1 + y2) / 2 - 6;
    const reach = bend + 24;
    edge.minX = Math.min(x1, x2) - reach;
    edge.maxX = Math.max(x1, x2) + reach;
    edge.minY = Math.min(y1, y2) - 40;
    edge.maxY = Math.max(y1, y2) + 40;
  }

  return {
    nodes: all,
    edges,
    neighbors,
    depth: rankCount,
    width,
    height,
  };
}

/**
 * Returns only the nodes and edges that can touch the visible area. A small
 * overscan margin keeps nodes from popping in while the user pans.
 */
export function cullLayout(
  layout: GraphLayout,
  viewport: Viewport,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (viewport.width <= 0 || viewport.height <= 0 || viewport.scale <= 0) {
    return { nodes: [], edges: [] };
  }
  const overscan = Math.min(VIEW_OVERSCAN / viewport.scale, 480);
  const minX = -viewport.x / viewport.scale - overscan;
  const maxX = (viewport.width - viewport.x) / viewport.scale + overscan;
  const minY = -viewport.y / viewport.scale - overscan;
  const maxY = (viewport.height - viewport.y) / viewport.scale + overscan;

  const nodes = layout.nodes.filter(
    (node) =>
      node.x + node.w >= minX &&
      node.x <= maxX &&
      node.y + node.h >= minY &&
      node.y <= maxY,
  );
  const edges = layout.edges.filter(
    (edge) =>
      edge.maxX >= minX &&
      edge.minX <= maxX &&
      edge.maxY >= minY &&
      edge.minY <= maxY,
  );
  return { nodes, edges };
}

function requestFrame(callback: FrameRequestCallback): number {
  if (typeof window.requestAnimationFrame === "function") {
    return window.requestAnimationFrame(callback);
  }
  return window.setTimeout(() => callback(performance.now()), 16);
}

function cancelFrame(id: number): void {
  if (typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(id);
    return;
  }
  window.clearTimeout(id);
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

interface GraphNodeViewProps {
  node: GraphNode;
  value: string | undefined;
  detailed: boolean;
  accent: boolean;
  active: boolean;
  connected: boolean;
  onSelect(id: string): void;
  onHover(id: string): void;
  onLeave(id: string): void;
}

const GraphNodeView = memo(function GraphNodeView({
  node,
  value,
  detailed,
  accent,
  active,
  connected,
  onSelect,
  onHover,
  onLeave,
}: GraphNodeViewProps) {
  const valueState =
    value === undefined ? "unknown" : value.includes("1") ? "high" : "low";
  return (
    <g
      data-graph-node
      className={`graph-node kind-${node.kind} ${active ? "is-active" : ""} ${
        connected ? "is-connected" : ""
      } value-${valueState}`}
      transform={`translate(${node.x} ${node.y})`}
      tabIndex={0}
      role="button"
      aria-label={`${node.label}, ${node.title}, value ${value ?? "unknown"}`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(node.id);
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onLeave(node.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(node.id);
        }
      }}
    >
      <rect
        className="node-card"
        x={0}
        y={0}
        width={node.w}
        height={node.h}
        rx={node.kind === "constant" ? 9 : 11}
      />
      {accent ? (
        <rect className="node-accent" x={0} y={12} width={3} height={node.h - 24} rx={2} />
      ) : null}
      {detailed ? (
        <>
          {node.kind === "operation" ? (
            <text className="node-op-glyph" x={13} y={21}>
              {node.opGlyph}
            </text>
          ) : null}
          <text className="node-label" x={node.kind === "operation" ? 45 : 13} y={22}>
            {node.displayLabel}
          </text>
          <text className="node-sub" x={13} y={node.h - 12}>
            {node.subLabel}
          </text>
          <text className="node-value" x={node.w - 11} y={22} textAnchor="end">
            {compactValue(value, node.width)}
          </text>
          {node.width > 1 ? (
            <text className="node-width" x={node.w - 11} y={node.h - 12} textAnchor="end">
              {node.width}b
            </text>
          ) : null}
        </>
      ) : null}
    </g>
  );
});

function CircuitGraphView({ circuit, snapshot }: CircuitGraphProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(stageRef);
  const layout = useMemo(() => buildLayout(circuit), [circuit]);
  const circuitKey = useMemo(() => JSON.stringify(circuit), [circuit]);
  const [view, setView] = useState<GraphView>({ scale: 1, x: 0, y: 0 });
  const viewRef = useRef<GraphView>(view);
  const frameRef = useRef(0);
  const queuedRef = useRef<GraphView | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ x: number; y: number; view: GraphView; moved: boolean } | null>(null);

  const applyView = useCallback((next: GraphView) => {
    if (frameRef.current) {
      cancelFrame(frameRef.current);
      frameRef.current = 0;
    }
    queuedRef.current = null;
    viewRef.current = next;
    setView(next);
  }, []);

  /**
   * Coalesces wheel and drag updates into one React render per animation
   * frame. The transform must follow the pointer immediately, so the latest
   * view is kept in a ref and only the final value reaches state.
   */
  const scheduleView = useCallback((next: GraphView) => {
    viewRef.current = next;
    queuedRef.current = next;
    if (frameRef.current) return;
    frameRef.current = requestFrame(() => {
      frameRef.current = 0;
      const pending = queuedRef.current;
      queuedRef.current = null;
      if (pending) setView(pending);
    });
  }, []);

  useEffect(
    () => () => {
      if (frameRef.current) cancelFrame(frameRef.current);
    },
    [],
  );

  const fit = useCallback(() => {
    if (!size.width || !size.height) return;
    // Never zoom out past the point where the labels stop being readable:
    // a wide design is panned, not shrunk into a wall of grey.
    const scale = Math.max(
      0.62,
      Math.min(
        1.05,
        (size.width - EDGE_PADDING * 2) / layout.width,
        (size.height - EDGE_PADDING * 2) / layout.height,
      ),
    );
    applyView({
      scale,
      x: (size.width - layout.width * scale) / 2,
      y: (size.height - layout.height * scale) / 2,
    });
  }, [applyView, layout.width, layout.height, size.width, size.height]);

  /* Fit once per circuit, and once when the stage is first measured. A window
     or dock resize must not throw away a pan or zoom the user chose, and a
     comment-only recompile must not either. */
  const fittedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!size.width || !size.height) return;
    if (fittedKeyRef.current === circuitKey) return;
    fittedKeyRef.current = circuitKey;
    fit();
  }, [circuitKey, fit, size.width, size.height]);

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
      const current = viewRef.current;
      const factor = Math.exp(-event.deltaY * 0.0012);
      const nextScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.scale * factor));
      if (nextScale === current.scale) return;
      const ratio = nextScale / current.scale;
      scheduleView({
        scale: nextScale,
        x: cx - (cx - current.x) * ratio,
        y: cy - (cy - current.y) * ratio,
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [scheduleView]);

  const zoomBy = (factor: number) => {
    const current = viewRef.current;
    const nextScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.scale * factor));
    if (nextScale === current.scale) return;
    const ratio = nextScale / current.scale;
    const cx = size.width / 2;
    const cy = size.height / 2;
    applyView({
      scale: nextScale,
      x: cx - (cx - current.x) * ratio,
      y: cy - (cy - current.y) * ratio,
    });
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    if ((event.target as Element).closest("[data-graph-node]")) return;
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      view: viewRef.current,
      moved: false,
    };
    setDragging(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is an enhancement; dragging still works without it.
    }
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    scheduleView({ ...drag.view, x: drag.view.x + dx, y: drag.view.y + dy });
  };

  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragRef.current && !dragRef.current.moved) setSelectedId(null);
    dragRef.current = null;
    setDragging(false);
    if (
      typeof event.currentTarget.hasPointerCapture === "function" &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const values = useMemo(() => {
    const map = new Map<string, string>();
    if (!snapshot) return map;
    for (const node of layout.nodes) {
      if (node.kind === "output") {
        const signal = snapshot.outputs[node.label];
        if (signal) map.set(node.id, signal.binary);
      } else {
        const value = snapshot.nodes[node.id];
        if (value !== undefined) map.set(node.id, value);
      }
    }
    return map;
  }, [layout, snapshot]);

  const circuitNodes = useMemo(
    () => new Map(circuit.nodes.map((node) => [node.id, node])),
    [circuit.nodes],
  );

  const nodeMap = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node])),
    [layout.nodes],
  );

  const visible = useMemo(() => {
    const culled = cullLayout(layout, {
      scale: view.scale,
      x: view.x,
      y: view.y,
      width: size.width,
      height: size.height,
    });
    // When the whole graph fits, reuse the layout arrays so panning does not
    // rebuild the batched edge and node paths on every frame.
    if (
      culled.nodes.length === layout.nodes.length &&
      culled.edges.length === layout.edges.length
    ) {
      return { nodes: layout.nodes, edges: layout.edges };
    }
    return culled;
  }, [layout, view.scale, view.x, view.y, size.width, size.height]);

  const detailed = view.scale >= MIN_DETAIL_SCALE;
  const curved = view.scale >= MIN_CURVE_SCALE;
  const showAccent = view.scale >= MIN_ACCENT_SCALE;
  const batchedNodes = view.scale < MIN_NODE_BATCH_SCALE;
  const activeNodeId = selectedId ?? hoveredId;
  const selected = selectedId ? nodeMap.get(selectedId) : undefined;
  const hovered = hoveredId ? nodeMap.get(hoveredId) : undefined;
  const selectedValue = selected ? values.get(selected.id) : undefined;
  const hoveredValue = hovered ? values.get(hovered.id) : undefined;

  const originalSelected = selected?.sourceId
    ? circuitNodes.get(selected.sourceId)
    : undefined;

  const builtinSpec = selected?.op
    ? BUILTINS.find((entry) => entry.name === selected.op)
    : undefined;
  const explanation = selected
    ? explainNode({
        kind: selected.kind,
        op: selected.op,
        description: builtinSpec?.description,
        tip: builtinSpec?.tip,
        widthRule: builtinSpec?.widthRule,
      })
    : undefined;
  const truthTable = selected?.kind === "operation" ? gateTruthTable(selected.op) : undefined;
  const liveInputs = selected
    ? (originalSelected?.operands ?? [])
        .map((id) => nodeMap.get(id))
        .filter((node): node is GraphNode => Boolean(node))
        .map((node) => ({
          name: node.label,
          value: compactValue(values.get(node.id), node.width),
        }))
    : [];

  const edgeBatches = useMemo(() => {
    const buckets = new Map<string, string>();
    for (const edge of visible.edges) {
      const source = values.get(edge.from);
      const tone =
        source === undefined ? "unknown" : source.includes("1") ? "high" : "low";
      const path = curved ? edge.path : edge.straightPath;
      const existing = buckets.get(tone);
      buckets.set(tone, existing ? `${existing} ${path}` : path);
    }
    return [...buckets].map(([className, d]) => ({ className, d }));
  }, [visible.edges, values, curved]);

  /**
   * At extreme zoom individual nodes are only a few pixels wide. One path per
   * node kind keeps the whole graph to a handful of SVG elements.
   */
  const nodeBatches = useMemo(() => {
    if (!batchedNodes) return [];
    const buckets = new Map<VisualKind, string[]>();
    for (const node of visible.nodes) {
      const rect = `M${node.x} ${node.y}h${node.w}v${node.h}h${-node.w}Z`;
      const bucket = buckets.get(node.kind);
      if (bucket) bucket.push(rect);
      else buckets.set(node.kind, [rect]);
    }
    return [...buckets].map(([kind, rects]) => ({ kind, d: rects.join(" ") }));
  }, [batchedNodes, visible.nodes]);

  /**
   * Only the active node's wires are redrawn on hover. The bulk edge batches
   * stay untouched, so moving the pointer never re-parses thousands of paths.
   */
  const activeEdgePath = useMemo(() => {
    if (!activeNodeId) return "";
    let path = "";
    for (const edge of visible.edges) {
      if (edge.from !== activeNodeId && edge.to !== activeNodeId) continue;
      const segment = curved ? edge.path : edge.straightPath;
      path = path ? `${path} ${segment}` : segment;
    }
    return path;
  }, [visible.edges, activeNodeId, curved]);

  const widthBadges = useMemo(() => {
    if (view.scale < MIN_BADGE_SCALE) return [];
    const badges = visible.edges.filter((edge) => edge.width > 1);
    return badges.length <= MAX_WIDTH_BADGES ? badges : [];
  }, [visible.edges, view.scale]);

  const selectNode = useCallback((id: string) => setSelectedId(id), []);
  const hoverNode = useCallback((id: string) => setHoveredId(id), []);
  const leaveNode = useCallback((id: string) => {
    setHoveredId((current) => (current === id ? null : current));
  }, []);

  if (layout.nodes.length === 0) {
    return (
      <div className="graph-stage graph-empty" ref={stageRef}>
        <p>No graph nodes to display.</p>
      </div>
    );
  }

  return (
    <div className={`graph-stage ${dragging ? "is-dragging" : ""}`} ref={stageRef}>
      {hovered ? (
        <div className="graph-hover-card">
          <div className="graph-hover-head">
            <strong>{hovered.label}</strong>
            <span>{hovered.kind === "operation" ? hovered.op : hovered.kind}</span>
          </div>
          <p>{hovered.title}</p>
          <div className="graph-hover-meta">
            <span>
              {hovered.width} bit{hovered.width === 1 ? "" : "s"}
            </span>
            <span className="mono">{hoveredValue ?? "—"}</span>
          </div>
        </div>
      ) : null}

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
        <span>{layout.depth} layers</span>
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
            {edgeBatches.map((batch) => (
              <g key={batch.className} className={`graph-edge ${batch.className}`}>
                <path
                  d={batch.d}
                  vectorEffect="non-scaling-stroke"
                  shapeRendering={batchedNodes ? "optimizeSpeed" : undefined}
                />
              </g>
            ))}
            {activeEdgePath ? (
              <g className="graph-edge is-active">
                <path
                  d={activeEdgePath}
                  vectorEffect="non-scaling-stroke"
                  shapeRendering={batchedNodes ? "optimizeSpeed" : undefined}
                />
              </g>
            ) : null}
          </g>

          <g className="graph-widths">
            {widthBadges.map((edge) => {
              const active = activeNodeId === edge.from || activeNodeId === edge.to;
              const muted = activeNodeId !== null && !active;
              return (
                <g
                  key={edge.key}
                  className={`edge-width ${active ? "is-active" : ""} ${
                    muted ? "is-muted" : ""
                  }`}
                  transform={`translate(${edge.labelX} ${edge.labelY})`}
                >
                  <rect x={-10} y={-8} width={20} height={13} rx={4} />
                  <text x={0} y={2} textAnchor="middle">
                    {edge.width}b
                  </text>
                </g>
              );
            })}
          </g>

          <g className="graph-nodes">
            {batchedNodes
              ? nodeBatches.map((batch) => (
                  <g key={batch.kind} className={`graph-node-batch kind-${batch.kind}`}>
                    <path d={batch.d} shapeRendering="crispEdges" />
                  </g>
                ))
              : visible.nodes.map((node) => (
                  <GraphNodeView
                    key={node.id}
                    node={node}
                    value={values.get(node.id)}
                    detailed={detailed}
                    accent={showAccent}
                    active={node.id === activeNodeId}
                    connected={
                      activeNodeId !== null &&
                      (layout.neighbors.get(activeNodeId)?.has(node.id) ?? false)
                    }
                    onSelect={selectNode}
                    onHover={hoverNode}
                    onLeave={leaveNode}
                  />
                ))}
          </g>
        </g>
      </svg>

      {selected ? (
        <aside className="graph-inspector">
          <div className="graph-inspector-head">
            <div>
              <span className="eyebrow">{selected.title}</span>
              <h3>{selected.label}</h3>
            </div>
            <button className="icon-button tiny" onClick={() => setSelectedId(null)} aria-label="Close node details">
              <X size={13} />
            </button>
          </div>
          <div className="graph-inspector-value">
            <span className="mono">{compactValue(selectedValue, selected.width)}</span>
            <span>
              {selected.width} bit{selected.width === 1 ? "" : "s"}
            </span>
          </div>
          <p className="graph-inspector-explain">{explanation?.sentence}</p>
          {explanation?.detail ? (
            <p className="graph-inspector-explain is-detail">{explanation.detail}</p>
          ) : null}
          {selected.kind === "operation" && builtinSpec ? (
            <p className="graph-inspector-explain is-detail">{builtinSpec.widthRule}</p>
          ) : null}
          {liveInputs.length > 0 ? (
            <p className="graph-inspector-explain is-detail">
              Right now:{" "}
              {liveInputs.map((input) => `${input.name} = ${input.value}`).join(", ")} →{" "}
              {compactValue(selectedValue, selected.width)}
            </p>
          ) : null}
          {truthTable ? (
            <table className="graph-inspector-table">
              <thead>
                <tr>
                  {truthTable[0]!.inputs.map((_, index) => (
                    <th key={index}>in{index + 1}</th>
                  ))}
                  <th>out</th>
                </tr>
              </thead>
              <tbody>
                {truthTable.map((row) => (
                  <tr key={row.inputs.join("")}>
                    {row.inputs.map((bit, index) => (
                      <td key={index}>{bit}</td>
                    ))}
                    <td className="is-output">{row.output}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <dl>
            <div>
              <dt>Decimal</dt>
              <dd className="mono">{decimalValue(selectedValue)}</dd>
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

export const CircuitGraph = memo(CircuitGraphView);
