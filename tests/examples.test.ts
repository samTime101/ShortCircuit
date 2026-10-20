import { describe, expect, it } from "vitest";
import { Simulator, compile, formatSource, generateTruthTable, runTests } from "@shortcircuit/engine";
import { EXAMPLES } from "../apps/web/src/lib/examples";

describe("web example library", () => {
  for (const example of EXAMPLES) {
    it(`${example.id} compiles, formats and tests cleanly`, () => {
      const result = compile(example.source);
      const errors = result.diagnostics.filter((item) => item.severity === "error");
      expect(errors, JSON.stringify(errors, null, 2)).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.circuits.some((circuit) => circuit.name === example.focusCircuit)).toBe(true);

      const tests = runTests(result);
      expect(tests.failed, JSON.stringify(tests, null, 2)).toBe(0);
      expect(tests.unsupported, JSON.stringify(tests, null, 2)).toBe(0);
      for (const suite of tests.suites) expect(suite.pass).toBe(true);

      const formatted = formatSource(example.source);
      const second = compile(formatted);
      expect(second.ok, JSON.stringify(second.diagnostics, null, 2)).toBe(true);

      for (const circuit of result.circuits) {
        const table = generateTruthTable(circuit);
        expect(table.inputs.length).toBe(circuit.inputs.length);
      }
    });
  }

  it("register commits on a rising edge only", () => {
    const example = EXAMPLES.find((entry) => entry.id === "register-8")!;
    const result = compile(example.source);
    const circuit = result.circuits.find((entry) => entry.name === "Register8")!;
    const sim = new Simulator(circuit);
    expect(sim.snapshot().states.stored?.binary).toBe("00000000");
    sim.setInputs({ data: "00101010", enable: "1" });
    expect(sim.snapshot().states.stored?.binary).toBe("00000000");
    let snap = sim.setInput("clock", "1");
    expect(snap.states.stored?.binary).toBe("00101010");
    sim.setInputs({ data: "00000101", clock: "0" });
    snap = sim.setInput("clock", "1");
    expect(snap.states.stored?.binary).toBe("00000101");
    sim.setInputs({ enable: "0", data: "11111111", clock: "0" });
    snap = sim.setInput("clock", "1");
    expect(snap.states.stored?.binary).toBe("00000101");
  });

  it("counter wraps and resets", () => {
    const example = EXAMPLES.find((entry) => entry.id === "counter-4")!;
    const result = compile(example.source);
    const circuit = result.circuits.find((entry) => entry.name === "Counter4")!;
    const sim = new Simulator(circuit);
    sim.setInput("reset", "0");
    let snap = sim.snapshot();
    for (let index = 0; index < 3; index++) {
      sim.setInput("clock", "1");
      snap = sim.setInput("clock", "0");
    }
    expect(snap.states.count?.binary).toBe("0011");
    sim.setInputs({ reset: "1", clock: "1" });
    snap = sim.setInput("clock", "0");
    expect(snap.states.count?.binary).toBe("0000");
  });
});
