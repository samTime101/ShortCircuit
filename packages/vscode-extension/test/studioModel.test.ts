import { compile as compileWithPackages, runTests } from "@shortcircuit/engine";
import { describe, it, expect } from "vitest";
import {
  buildIrSummary,
  buildTestsModel,
  buildTruthTable,
  buildWaveform,
  findTestAtPosition,
  inputBitAt,
  mapDiagnostics,
  normalizeInputValue,
  normalizeInputs,
} from "../src/studioModel";

const HALF_ADDER = `IMPORT "@shortcircuit/gates"
CIRCUIT HalfAdder
  INPUT a
  INPUT b
  sum = XOR(a, b)
  carry = AND(a, b)
  OUTPUT sum
  OUTPUT carry
END
TEST HalfAdder
  CASE "zero"
    INPUT a = 0
    INPUT b = 0
    EXPECT sum = 0
    EXPECT carry = 0
  END
  CASE "one plus one"
    INPUT a = 1
    INPUT b = 1
    EXPECT sum = 0
    EXPECT carry = 1
  END
END`;

const FAILING_TESTS = `IMPORT "@shortcircuit/gates"
CIRCUIT HalfAdder
  INPUT a
  INPUT b
  sum = XOR(a, b)
  carry = AND(a, b)
  OUTPUT sum
  OUTPUT carry
END
TEST HalfAdder
  CASE "ok"
    INPUT a = 0
    INPUT b = 0
    EXPECT sum = 0
    EXPECT carry = 0
  END
  CASE "wrong expectation"
    INPUT a = 1
    INPUT b = 1
    EXPECT sum = 1
  END
END`;

const SEQUENTIAL = `IMPORT "@shortcircuit/arithmetic"
IMPORT "@shortcircuit/selection"
CIRCUIT Counter4
  INPUT clock
  INPUT reset
  STATE count : BUS(4) = 0000
  incremented = ADD4(count, 0, 1)
  next = MUX(incremented.sum, 0, reset)
  ON RISING_EDGE(clock):
    count = next
  END
  OUTPUT count
END`;

describe("studioModel helpers", () => {
  it("normalizes simulation inputs to the circuit width", () => {
    expect(normalizeInputValue("1", 1)).toBe("1");
    expect(normalizeInputValue("0011", 4)).toBe("0011");
    expect(normalizeInputValue("0x2", 4)).toBe("0010");
    expect(normalizeInputValue(" 0b101 ", 4)).toBe("0101");
    expect(normalizeInputValue("not-a-number", 4)).toBe("0000");
  });

  it("normalizes every input of a circuit at its own width", () => {
    const result = compileWithPackages(HALF_ADDER);
    const circuit = result.circuits[0]!;
    const normalized = normalizeInputs(circuit, { a: "0x1" });
    expect(Object.keys(normalized).sort()).toEqual(["a", "b"]);
    expect(normalized.a).toBe("1");
    expect(normalized.b).toBe("0");
    expect(circuit.inputs[1]!.width).toBe(1);
  });

  it("generates the exhaustive half-adder truth table", () => {
    const result = compileWithPackages(HALF_ADDER);
    const circuit = result.circuits[0]!;
    const table = buildTruthTable(circuit);
    expect(table.rows).toHaveLength(4);
    expect(table.truncated).toBe(false);
    expect(table.rows[0]).toEqual({
      input: { a: "0", b: "0" },
      output: { sum: "0", carry: "0" },
    });
    expect(table.rows[3]).toEqual({
      input: { a: "1", b: "1" },
      output: { sum: "0", carry: "1" },
    });
  });

  it("reports a truncation reason for sequential circuits", () => {
    const result = compileWithPackages(SEQUENTIAL);
    const circuit = result.circuits[0]!;
    const table = buildTruthTable(circuit);
    expect(table.rows).toHaveLength(0);
    expect(table.truncated).toBe(true);
    expect(table.reason).toContain("combinational");
  });

  it("builds a small full-state waveform for a combinational circuit", () => {
    const result = compileWithPackages(HALF_ADDER);
    const circuit = result.circuits[0]!;
    const waveform = buildWaveform(circuit);
    expect(waveform.error).toBeUndefined();
    expect(waveform.timeSteps).toHaveLength(4);
    expect(waveform.inputNames).toEqual(["a", "b"]);
    expect(waveform.timeSteps[0]!.inputs.a).toBe("0");
    expect(waveform.timeSteps[0]!.outputs.sum).toBe("0");
    expect(waveform.timeSteps[1]!.inputs.a).toBe("1");
    expect(waveform.timeSteps[1]!.outputs.sum).toBe("1");
  });

  it("refuses full-state waveforms for sequential circuits", () => {
    const result = compileWithPackages(SEQUENTIAL);
    const circuit = result.circuits[0]!;
    const waveform = buildWaveform(circuit);
    expect(waveform.timeSteps).toHaveLength(0);
    expect(waveform.error).toContain("sequential");
  });

  it("caps the automatic waveform at six input bits", () => {
    const wide = `CIRCUIT Wide
  INPUT a : BUS(3)
  INPUT b : BUS(4)
  carry = AND(a, b)
  OUTPUT a
END`;
    const result = compileWithPackages(wide);
    const circuit = result.circuits[0]!;
    const waveform = buildWaveform(circuit);
    expect(waveform.timeSteps).toHaveLength(0);
    expect(waveform.error).toContain("Too many input bits");
  });

  it("executes compiled tests and maps real failures", () => {
    const passing = buildTestsModel(compileWithPackages(HALF_ADDER));
    expect(passing).not.toBeNull();
    expect(passing!.ok).toBe(true);
    expect(passing!.passed).toBe(2);
    expect(passing!.failed).toBe(0);
    expect(passing!.suites[0]!.cases).toHaveLength(2);
    expect(passing!.suites[0]!.cases[0]!.pass).toBe(true);
    // Each case has 2 INPUT rows and 2 EXPECT rows = 4 total
    expect(passing!.suites[0]!.cases[0]!.rows).toHaveLength(4);

    const failing = buildTestsModel(compileWithPackages(FAILING_TESTS));
    expect(failing).not.toBeNull();
    expect(failing!.ok).toBe(false);
    // runTests counts: if any case fails, the whole suite fails, and only failed cases increment 'failed'
    expect(failing!.passed).toBe(0);
    expect(failing!.failed).toBe(1);
    const failingSuite = failing!.suites.find((suite) => suite.name === "HalfAdder");
    expect(failingSuite).toBeDefined();
    const failingCase = failingSuite!.cases.find((c) => !c.pass);
    expect(failingCase).toBeDefined();
    expect(failingCase!.pass).toBe(false);
    expect(failingCase.error).toContain("EXPECT");
    const expectRow = failingCase.rows.find((row) => row.kind === "expect");
    expect(expectRow).toBeDefined();
    expect(expectRow!.pass).toBe(false);
    expect(expectRow!.actual).toBe("0");
    expect(expectRow!.expected).toBe("1");
  });

  it("returns no tests when the source has none", () => {
    const result = compileWithPackages(`CIRCUIT Idle\n  INPUT a\n  OUTPUT a\nEND`);
    expect(result.tests).toHaveLength(0);
    expect(buildTestsModel(result)).toBeNull();
  });

  it("resolves the clock input name for sequential summaries", () => {
    const result = compileWithPackages(SEQUENTIAL);
    const circuit = result.circuits[0]!;
    const summary = buildIrSummary(circuit);
    expect(summary.sequential).toBe(true);
    expect(summary.events.length).toBeGreaterThan(0);
    const clockEvent = summary.events[0]!;
    expect(clockEvent.clockName).toBe("clock");
    expect(clockEvent.clock).toBeDefined();
  });

  it("maps engine diagnostics to studio diagnostics", () => {
    const mapped = mapDiagnostics([{ message: "oops", severity: "error" }]);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toMatchObject({ message: "oops", severity: "error" });
    expect(mapped[0]!.line).toBe(1);
  });

  it("finds the test name on a line", () => {
    expect(findTestAtPosition("TEST Adder\nEND", 0)).toBe("Adder");
    expect(findTestAtPosition("  test lower\nEND", 0)).toBe("lower");
    expect(findTestAtPosition("CIRCUIT Top\nEND", 0)).toBeNull();
    expect(findTestAtPosition("END", 5)).toBeNull();
  });

  it("reads individual input bits", () => {
    expect(inputBitAt("1010", 4, 0)).toBe("0");
    expect(inputBitAt("1010", 4, 3)).toBe("1");
    expect(inputBitAt("0000", 4, 2)).toBe("0");
  });

  it("runs the compiled suite through the engine helper", () => {
    const result = compileWithPackages(HALF_ADDER);
    const run = runTests(result);
    expect(run.ok).toBe(true);
    expect(run.passed).toBe(2);
    expect(run.failed).toBe(0);
  });
});
