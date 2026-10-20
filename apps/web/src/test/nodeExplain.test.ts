import { describe, expect, it } from "vitest";
import { explainNode, gateTruthTable } from "../components/nodeExplain";

describe("node explanations", () => {
  it("builds a truth table for the common gates", () => {
    expect(gateTruthTable("AND")).toEqual([
      { inputs: ["0", "0"], output: "0" },
      { inputs: ["0", "1"], output: "0" },
      { inputs: ["1", "0"], output: "0" },
      { inputs: ["1", "1"], output: "1" },
    ]);
    expect(gateTruthTable("XOR")?.[3]).toEqual({ inputs: ["1", "1"], output: "0" });
    expect(gateTruthTable("NOT")).toHaveLength(2);
  });

  it("has no table for operations without one", () => {
    expect(gateTruthTable("ADD")).toBeUndefined();
    expect(gateTruthTable("MUX")).toBeUndefined();
    expect(gateTruthTable(undefined)).toBeUndefined();
  });

  it("explains every kind of node", () => {
    expect(explainNode({ kind: "input" }).sentence).toMatch(/outside world/i);
    expect(explainNode({ kind: "state" }).sentence).toMatch(/remembers/i);
    expect(explainNode({ kind: "constant" }).sentence).toMatch(/same value/i);
    expect(explainNode({ kind: "output" }).sentence).toMatch(/publishes/i);
    expect(
      explainNode({ kind: "operation", description: "Bitwise XOR." }).sentence,
    ).toBe("Bitwise XOR.");
  });
});
