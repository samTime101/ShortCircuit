import type { CircuitIR, CircuitNode } from "@shortcircuit/engine";

const CELL_WIDTH = 174;
const GAP_X = 86;
const GAP_Y = 24;
const PADDING = 54;

export type VisualKind = "input" | "state" | "constant" | "operation" | "output";

export interface GraphNode {
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

export interface GraphEdge {
  id: string;
  key: string;
  from: string;
  to: string;
  width: number;
  path: string;
  straightPath: string;
  labelX: number;
  labelY: number;
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  depth: number;
  width: number;
  height: number;
}

const BUILTIN_GLYPHS: Record<string, string> = {
  NAND: "&̄",
  AND: "&",
  OR: "≥1",
  NOR: "≥̄1",
  XOR: "=1",
  XNOR: "=̄1",
  NOT: "1",
  BUF: "1",
  BUFFER: "1",
  CONCAT: "‖",
  BROADCAST: "⇉",
  SLICE: "✂",
  MUX: "⑂",
};

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function nodeTitle(kind: VisualKind, op?: string): string {
  if (kind === "output") return "Exposed output";
  if (kind === "input") return "External input";
  if (kind === "state") return "Stored state";
  if (kind === "constant") return "Constant";
  return `${op ?? "Operation"} component`;
}

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
          ? (BUILTIN_GLYPHS[node.op ?? ""] ?? node.op?.slice(0, 3) ?? "OP")
          : "",
    });
  }

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
  const edges: GraphEdge[] = [];
  let edgeSerial = 0;

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
      });
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
      });
    } else {
      dependencies.set(outputNode.id, []);
    }
  }

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
    const colH =
      column.reduce((sum, node) => sum + node.h, 0) + Math.max(0, column.length - 1) * GAP_Y;
    tallest = Math.max(tallest, colH);
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
  }

  return {
    nodes: all,
    edges,
    depth: rankCount,
    width,
    height,
  };
}
