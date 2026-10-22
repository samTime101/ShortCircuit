import { describe, expect, it } from "vitest";
import type { CircuitIR, CircuitNode, CircuitOutput, NodeKind } from "@shortcircuit/engine";
import { buildLayout, cullLayout } from "../components/CircuitGraph";

let nextLine = 1;

function makeNode(
  id: string,
  kind: NodeKind,
  label: string,
  operands: string[] = [],
  width = 1,
): CircuitNode {
  return {
    id,
    kind,
    op: kind === "operation" ? "NAND" : undefined,
    width,
    label,
    scope: [],
    operands,
    line: nextLine++,
    column: 1,
  };
}

function makeCircuit(nodes: CircuitNode[], outputs: CircuitOutput[]): CircuitIR {
  return {
    name: "Test",
    line: 1,
    inputs: [],
    outputs,
    states: [],
    nodes,
    events: [],
    sequential: false,
    stats: {
      nodes: nodes.length,
      states: 0,
      events: 0,
      maxDepth: 0,
      maxWidth: 0,
    },
  };
}

function output(name: string, node: string, width = 1): CircuitOutput {
  return { name, portName: name, node, width, line: 1, column: 1 };
}

/** 40 independent chains of 50 gates, for a 2,042 node and 4,040 edge graph. */
function bigCircuit(): CircuitIR {
  const a = makeNode("a", "input", "a");
  const b = makeNode("b", "input", "b");
  const nodes: CircuitNode[] = [a, b];
  const outputs: CircuitOutput[] = [];

  for (let chain = 0; chain < 40; chain += 1) {
    for (let depth = 0; depth < 50; depth += 1) {
      const id = `c${chain}_${depth}`;
      const operands = depth === 0 ? ["a", "b"] : [`c${chain}_${depth - 1}`, "a"];
      nodes.push(makeNode(id, "operation", id, operands));
    }
    outputs.push(output(`out${chain}`, `c${chain}_49`));
  }

  return makeCircuit(nodes, outputs);
}

describe("buildLayout", () => {
  it("lays out ranks, outputs, edges, and adjacency once", () => {
    nextLine = 1;
    const a = makeNode("a", "input", "a");
    const b = makeNode("b", "input", "b");
    const n1 = makeNode("n1", "operation", "n1", ["a", "b"]);
    const n2 = makeNode("n2", "operation", "n2", ["n1", "a"]);
    const circuit = makeCircuit([a, b, n1, n2], [output("out", "n2")]);

    const layout = buildLayout(circuit);
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));

    expect(layout.nodes.map((node) => node.id).sort()).toEqual(
      ["a", "b", "n1", "n2", "output:0"].sort(),
    );
    expect(layout.edges).toHaveLength(5);
    expect(layout.depth).toBe(4);

    expect(byId.get("a")!.rank).toBe(0);
    expect(byId.get("n1")!.rank).toBe(1);
    expect(byId.get("n2")!.rank).toBe(2);
    expect(byId.get("output:0")!.rank).toBe(3);
    expect(byId.get("output:0")!.sourceId).toBe("n2");

    expect([...layout.neighbors.get("a")!].sort()).toEqual(["n1", "n2"]);
    expect([...layout.neighbors.get("n1")!].sort()).toEqual(["a", "b", "n2"]);
    expect([...layout.neighbors.get("output:0")!]).toEqual(["n2"]);

    for (const edge of layout.edges) {
      expect(edge.path).toMatch(/^M .+ C .+/);
      expect(edge.straightPath).toMatch(/^M .+ L .+/);
      expect(edge.maxX).toBeGreaterThan(edge.minX);
      expect(edge.maxY).toBeGreaterThan(edge.minY);
    }

    expect(byId.get("a")!.subLabel).toBe("INPUT");
    expect(byId.get("n1")!.subLabel).toContain("NAND");
    expect(byId.get("output:0")!.subLabel).toBe("OUTPUT");
    expect(byId.get("n1")!.title.length).toBeGreaterThan(0);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThanOrEqual(340);
  });

  it("keeps signal values out of the static layout", () => {
    nextLine = 1;
    const a = makeNode("a", "input", "a");
    const n1 = makeNode("n1", "operation", "n1", ["a"]);
    const layout = buildLayout(makeCircuit([a, n1], [output("out", "n1")]));

    for (const node of layout.nodes) {
      expect("value" in node).toBe(false);
    }
  });

  it("builds a large graph deterministically without blowing the stack", () => {
    const circuit = bigCircuit();
    const started = performance.now();
    const layout = buildLayout(circuit);
    const elapsed = performance.now() - started;

    expect(layout.nodes).toHaveLength(2042);
    expect(layout.edges).toHaveLength(4040);
    expect(layout.depth).toBe(52);
    expect(elapsed).toBeLessThan(3000);

    const again = buildLayout(bigCircuit());
    expect(again.nodes.map((node) => [node.id, node.x, node.y])).toEqual(
      layout.nodes.map((node) => [node.id, node.x, node.y]),
    );
  });
});

describe("cullLayout", () => {
  it("returns nothing for an unmeasured viewport", () => {
    const layout = buildLayout(bigCircuit());
    expect(cullLayout(layout, { scale: 1, x: 0, y: 0, width: 0, height: 0 })).toEqual({
      nodes: [],
      edges: [],
    });
  });

  it("drops the overwhelming majority of a large graph", () => {
    const layout = buildLayout(bigCircuit());
    const target = layout.nodes.find((node) => node.id === "c20_25")!;
    const width = 800;
    const height = 600;
    const view = {
      scale: 1,
      x: width / 2 - (target.x + target.w / 2),
      y: height / 2 - (target.y + target.h / 2),
      width,
      height,
    };

    const visible = cullLayout(layout, view);
    expect(visible.nodes.some((node) => node.id === target.id)).toBe(true);
    expect(visible.nodes.length).toBeGreaterThan(0);
    expect(visible.nodes.length).toBeLessThan(layout.nodes.length / 4);
    expect(visible.edges.length).toBeGreaterThan(0);
    expect(visible.edges.length).toBeLessThan(layout.edges.length);

    const overscan = 180;
    const minX = -view.x - overscan;
    const maxX = width - view.x + overscan;
    const minY = -view.y - overscan;
    const maxY = height - view.y + overscan;
    for (const node of visible.nodes) {
      expect(node.x + node.w).toBeGreaterThanOrEqual(minX);
      expect(node.x).toBeLessThanOrEqual(maxX);
      expect(node.y + node.h).toBeGreaterThanOrEqual(minY);
      expect(node.y).toBeLessThanOrEqual(maxY);
    }

    const farAway = layout.nodes.find((node) => node.id === "c0_0")!;
    expect(visible.nodes.some((node) => node.id === farAway.id)).toBe(false);
  });

  it("shows more of the graph when zoomed out around the same point", () => {
    const layout = buildLayout(bigCircuit());
    const target = layout.nodes.find((node) => node.id === "c20_25")!;
    const centered = (scale: number) => ({
      scale,
      x: 400 - (target.x + target.w / 2) * scale,
      y: 300 - (target.y + target.h / 2) * scale,
      width: 800,
      height: 600,
    });

    const close = cullLayout(layout, centered(1));
    const far = cullLayout(layout, centered(0.5));
    expect(far.nodes.length).toBeGreaterThan(close.nodes.length);
  });
});
