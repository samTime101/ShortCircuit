import { describe, expect, it } from "vitest";
import { packageWorkedExamples } from "../src/packageExamples";

const examples = packageWorkedExamples();

describe("package worked examples", () => {
  it("builds an example for every package circuit", () => {
    for (const name of ["HALF_ADDER", "FULL_ADDER", "ADD4", "ADD8"]) {
      const example = examples.get(`@shortcircuit/arithmetic:${name}`);
      expect(example, name).toBeDefined();
      expect(example?.call, name).toMatch(new RegExp(`^${name}\\(`));
      expect(example?.ports.length, name).toBeGreaterThan(0);
    }
  });

  it("reads the full adder example from the package test", () => {
    const example = examples.get("@shortcircuit/arithmetic:FULL_ADDER");
    expect(example?.call).toBe("FULL_ADDER(1, 1, 1)");
    expect(example?.label).toBe("1 + 1 + 1");
    expect(example?.ports).toEqual([
      { name: "sum", value: "1" },
      { name: "carry_out", value: "1" },
    ]);
  });

  it("reads a macro example from the package level test", () => {
    const example = examples.get("@shortcircuit/gates:NOT");
    expect(example?.call).toBe("NOT(0)");
    expect(example?.value).toBe("1");
  });

  it("keeps the mux result of a bus example", () => {
    const example = examples.get("@shortcircuit/selection:MUX");
    expect(example?.call).toBe("MUX(0011, 1100, 0)");
    expect(example?.value).toBe("0011");
  });

  it("skips internal macros", () => {
    expect(examples.has("@shortcircuit/gates:OR2")).toBe(false);
    expect(examples.has("@shortcircuit/gates:XOR2")).toBe(false);
  });
});
