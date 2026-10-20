import { describe, expect, it } from "vitest";
import {
  BUILTINS,
  INTRINSIC_CIRCUITS,
  LANGUAGE_SNIPPETS,
  Simulator,
  compile,
  formatSource,
  generateTruthTable,
  runTests,
} from "../src/index";

function combinational(source: string, circuitName?: string) {
  const result = compile(source);
  expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  const circuit = circuitName
    ? result.circuits.find((entry) => entry.name === circuitName)
    : result.circuits[0];
  expect(circuit).toBeDefined();
  return { result, circuit: circuit! };
}

const HALF_ADDER = `# A one-bit half adder
CIRCUIT HalfAdder

INPUT a
INPUT b

sum = XOR(a, b)
carry = AND(a, b)

OUTPUT sum
OUTPUT carry

END

TEST HalfAdder
CASE "0 + 0"
  INPUT a = 0
  INPUT b = 0
  EXPECT sum = 0
  EXPECT carry = 0
END
CASE "1 + 1"
  INPUT a = 1
  INPUT b = 1
  EXPECT sum = 0
  EXPECT carry = 1
END
END
`;

describe("combinational core", () => {
  it("compiles and simulates a half adder", () => {
    const { circuit } = combinational(HALF_ADDER);
    const simulator = new Simulator(circuit);
    const outputs = simulator.setInputs({ a: "1", b: "0" }).outputs;
    expect(outputs.sum?.binary).toBe("1");
    expect(outputs.carry?.binary).toBe("0");
  });

  it("validates every field before applying a multi-input update", () => {
    const { circuit } = combinational(HALF_ADDER);
    const simulator = new Simulator(circuit);
    simulator.setInput("a", "1");
    expect(() => simulator.setInputs({ a: "0", b: "2" })).toThrow();
    expect(simulator.getInputValues()).toEqual({ a: "1", b: "0" });
  });

  it("runs built-in test suites", () => {
    const result = compile(HALF_ADDER);
    const testResult = runTests(result);
    expect(testResult.ok).toBe(true);
    expect(testResult.passed).toBe(2);
    expect(testResult.failed).toBe(0);
  });

  it("supports variadic gates and nested expressions", () => {
    const { circuit } = combinational(`CIRCUIT Gates
INPUT a
INPUT b
INPUT c
INPUT d
all = AND(a, b, c, d)
any = OR(a, b, c, d)
odd = XOR(a, b, c, d)
left = AND(a, b)
right = AND(c, d)
paired = OR(left, right)
OUTPUT all
OUTPUT any
OUTPUT odd
OUTPUT paired
END`);
    const simulator = new Simulator(circuit);
    let outputs = simulator.setInputs({ a: "1", b: "1", c: "1", d: "0" }).outputs;
    expect(outputs.all?.binary).toBe("0");
    expect(outputs.any?.binary).toBe("1");
    expect(outputs.odd?.binary).toBe("1");
    expect(outputs.paired?.binary).toBe("1");
    outputs = simulator.setInputs({ a: "1", b: "1", c: "1", d: "1" }).outputs;
    expect(outputs.all?.binary).toBe("1");
    expect(outputs.odd?.binary).toBe("0");
  });

  it("supports nested circuit instances", () => {
    const { result, circuit } = combinational(
      `${HALF_ADDER.split("TEST")[0]}
CIRCUIT FullAdder
INPUT a
INPUT b
INPUT carry_in
first = HalfAdder(a, b)
second = HalfAdder(first.sum, carry_in)
sum = second.sum
carry_out = OR(first.carry, second.carry)
OUTPUT sum
OUTPUT carry_out
END`,
      "FullAdder",
    );
    expect(circuit.nodes.some((node) => node.scope[0] === "first")).toBe(true);
    const simulator = new Simulator(circuit);
    const cases: Array<[string, string, string, string, string]> = [
      ["0", "0", "0", "0", "0"],
      ["1", "0", "0", "1", "0"],
      ["1", "1", "0", "0", "1"],
      ["1", "1", "1", "1", "1"],
    ];
    for (const [a, b, carryIn, sum, carry] of cases) {
      const outputs = simulator.setInputs({ a, b, carry_in: carryIn }).outputs;
      expect(outputs.sum?.binary).toBe(sum);
      expect(outputs.carry_out?.binary).toBe(carry);
    }
    expect(result.circuits.find((entry) => entry.name === "HalfAdder")).toBeDefined();
  });

  it("supports named circuit arguments", () => {
    const { circuit } = combinational(
      `${HALF_ADDER.split("TEST")[0]}
CIRCUIT Wrapper
INPUT x
INPUT y
result = HalfAdder(b = y, a = x)
OUTPUT result.sum
OUTPUT result.carry
END`,
      "Wrapper",
    );
    const simulator = new Simulator(circuit);
    const outputs = simulator.setInputs({ x: "1", y: "1" }).outputs;
    expect(outputs["result.sum"]?.binary).toBe("0");
    expect(outputs["result.carry"]?.binary).toBe("1");
  });

  it("elaborates intrinsic circuit-shaped components", () => {
    const { circuit } = combinational(`CIRCUIT Intrinsic
INPUT a
INPUT b
INPUT c
full = FULL_ADDER(a, b, c)
OUTPUT full.sum
OUTPUT full.carry_out
END`);
    expect(circuit.nodes.some((node) => node.op === "XOR")).toBe(true);
    const simulator = new Simulator(circuit);
    const outputs = simulator.setInputs({ a: "1", b: "1", c: "1" }).outputs;
    expect(outputs["full.sum"]?.binary).toBe("1");
    expect(outputs["full.carry_out"]?.binary).toBe("1");
  });
});

describe("buses and arithmetic", () => {
  const ADDER8 = `CIRCUIT Adder8
INPUT a : BUS(8)
INPUT b : BUS(8)
sum = ADD(a, b)
OUTPUT sum
END
TEST Adder8
CASE "small"
  INPUT a = 00000001
  INPUT b = 00000010
  EXPECT sum = 00000011
END
CASE "overflow wraps"
  INPUT a = 11111111
  INPUT b = 00000001
  EXPECT sum = 00000000
END
END`;

  it("performs documented modular 8-bit addition", () => {
    const { result, circuit } = combinational(ADDER8);
    expect(circuit.inputs[0]?.width).toBe(8);
    expect(circuit.outputs[0]?.width).toBe(8);
    const simulator = new Simulator(circuit);
    const outputs = simulator.setInputs({ a: "11111111", b: "00000001" }).outputs;
    expect(outputs.sum?.binary).toBe("00000000");
    expect(runTests(result).ok).toBe(true);
  });

  it("supports slicing, concatenation, shifts, mux and comparisons", () => {
    const { circuit } = combinational(`CIRCUIT BusOps
INPUT data : BUS(8)
INPUT pick
upper = data[7:4]
lower = data[3:0]
low_bit = data[0]
joined = CONCAT(upper, lower)
moved = SHIFT_LEFT(data, 2)
right = SHIFT_RIGHT(data, 1)
chosen = MUX(lower, upper, pick)
is_zero = EQUAL(data, 0)
is_less = LESS(data, 8)
slice_fn = SLICE(data, 5, 2)
decoded = DECODER(data[2:0])
encoded = ENCODER(data)
OUTPUT upper
OUTPUT low_bit
OUTPUT joined
OUTPUT moved
OUTPUT right
OUTPUT chosen
OUTPUT is_zero
OUTPUT is_less
OUTPUT slice_fn
OUTPUT decoded
OUTPUT encoded
END`);
    const simulator = new Simulator(circuit);
    let outputs = simulator.setInputs({ data: "10101100", pick: "0" }).outputs;
    expect(outputs.upper?.binary).toBe("1010");
    expect(outputs.low_bit?.binary).toBe("0");
    expect(outputs.joined?.binary).toBe("10101100");
    expect(outputs.moved?.binary).toBe("10110000");
    expect(outputs.right?.binary).toBe("01010110");
    expect(outputs.chosen?.binary).toBe("1100");
    expect(outputs.is_zero?.binary).toBe("0");
    expect(outputs.is_less?.binary).toBe("0");
    expect(outputs.slice_fn?.binary).toBe("1011");
    expect(outputs.decoded?.binary).toBe("00010000");
    expect(outputs.encoded?.binary).toBe("111");
    outputs = simulator.setInputs({ pick: "1" }).outputs;
    expect(outputs.chosen?.binary).toBe("1010");
  });

  it("wraps subtraction and raises on division by zero", () => {
    const { circuit } = combinational(`CIRCUIT Arithmetic
INPUT a : BUS(4)
INPUT b : BUS(4)
difference = SUBTRACT(a, b)
quotient = DIVIDE(a, b)
OUTPUT difference
OUTPUT quotient
END`);
    const simulator = new Simulator(circuit);
    expect(simulator.runtimeError?.code).toBe("R500");
    expect(simulator.snapshot().runtimeError?.code).toBe("R500");
    let snapshot = simulator.setInputs({ a: "0000", b: "0001" });
    expect(simulator.runtimeError).toBeNull();
    expect(snapshot.outputs.difference?.binary).toBe("1111");
    expect(snapshot.outputs.quotient?.binary).toBe("0000");
    snapshot = simulator.setInputs({ a: "1111", b: "0010" });
    expect(snapshot.outputs.quotient?.binary).toBe("0111");
    expect(() => simulator.setInput("b", "0000")).toThrowError(/divide by zero/i);
    expect(() => simulator.setInput("b", "0000")).toThrowError(
      expect.objectContaining({ code: "R500" }),
    );
  });

  it("rejects division by a constant zero at compile time", () => {
    const result = compile(`CIRCUIT ZeroDivide
INPUT a : BUS(4)
quotient = DIVIDE(a, 0)
OUTPUT quotient
END`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((entry) => entry.code === "E309")).toBe(true);
  });

  it("supports the bus helper operations", () => {
    const { circuit } = combinational(`CIRCUIT Helpers
INPUT x : BUS(8)
INPUT small : BUS(4)
wide = ZEXT(small, 8)
signed = SEXT(small, 8)
count = POPCOUNT(x)
all = REDUCE_AND(x)
any = REDUCE_OR(x)
parity = REDUCE_XOR(x)
twice = REPEAT(small, 2)
flipped = REVERSE(x)
OUTPUT wide
OUTPUT signed
OUTPUT count
OUTPUT all
OUTPUT any
OUTPUT parity
OUTPUT twice
OUTPUT flipped
END`);
    const simulator = new Simulator(circuit);
    const outputs = simulator.setInputs({ x: "00001111", small: "1010" }).outputs;
    expect(outputs.wide?.binary).toBe("00001010");
    expect(outputs.signed?.binary).toBe("11111010");
    expect(outputs.count?.binary).toBe("0100");
    expect(outputs.all?.binary).toBe("0");
    expect(outputs.any?.binary).toBe("1");
    expect(outputs.parity?.binary).toBe("0");
    expect(outputs.twice?.binary).toBe("10101010");
    expect(outputs.flipped?.binary).toBe("11110000");
  });

  it("rejects a narrowing extension", () => {
    const result = compile(`CIRCUIT Narrow
INPUT x : BUS(8)
small = ZEXT(x, 4)
OUTPUT small
END`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((entry) => entry.code === "E332")).toBe(true);
  });

  it("expands multiplication width instead of truncating", () => {
    const { circuit } = combinational(`CIRCUIT Mul
INPUT a : BUS(8)
INPUT b : BUS(8)
product = MULTIPLY(a, b)
OUTPUT product
END`);
    expect(circuit.outputs[0]?.width).toBe(16);
    const simulator = new Simulator(circuit);
    const outputs = simulator.setInputs({ a: "00001111", b: "00010000" }).outputs;
    expect(outputs.product?.binary).toBe("0000000011110000");
  });

  it("generates exhaustive truth tables", () => {
    const { circuit } = combinational(HALF_ADDER);
    const table = generateTruthTable(circuit);
    expect(table.rows).toHaveLength(4);
    expect(table.inputs.map((input) => input.name)).toEqual(["a", "b"]);
    expect(table.rows.map((row) => [row.input.a, row.input.b])).toEqual([
      ["0", "0"],
      ["0", "1"],
      ["1", "0"],
      ["1", "1"],
    ]);
    expect(table.rows.some((row) => row.output.sum === "1" && row.output.carry === "0")).toBe(true);
    expect(table.rows.some((row) => row.output.sum === "0" && row.output.carry === "1")).toBe(true);
  });
});

describe("sequential simulation", () => {
  it("captures data on a rising edge and holds it", () => {
    const { circuit } = combinational(`CIRCUIT Register8
INPUT data : BUS(8)
INPUT clock
INPUT enable
STATE stored : BUS(8) = 0
ON RISING_EDGE(clock):
  IF enable:
    stored = data
  END
END
OUTPUT stored
END`);
    expect(circuit.sequential).toBe(true);
    const simulator = new Simulator(circuit);
    simulator.setInputs({ data: "10101010", enable: "1" });
    let snapshot = simulator.setInput("clock", "1");
    expect(snapshot.outputs.stored?.binary).toBe("10101010");
    expect(snapshot.firedEvents.length).toBe(1);

    simulator.setInputs({ data: "01010101", enable: "0" });
    simulator.setInput("clock", "0");
    snapshot = simulator.setInput("clock", "1");
    expect(snapshot.outputs.stored?.binary).toBe("10101010");

    simulator.setInput("enable", "1");
    snapshot = simulator.setInput("clock", "0");
    expect(snapshot.outputs.stored?.binary).toBe("10101010");
    snapshot = simulator.setInput("clock", "1");
    expect(snapshot.outputs.stored?.binary).toBe("01010101");
  });

  it("updates state on a falling edge", () => {
    const { circuit } = combinational(`CIRCUIT Falling
INPUT clock
INPUT d
STATE q = 0
ON FALLING_EDGE(clock):
  q = d
END
OUTPUT q
END`);
    const simulator = new Simulator(circuit);
    simulator.setInput("d", "1");
    let snapshot = simulator.setInput("clock", "1");
    expect(snapshot.outputs.q?.binary).toBe("0");
    expect(snapshot.firedEvents).toEqual([]);
    snapshot = simulator.setInput("clock", "0");
    expect(snapshot.outputs.q?.binary).toBe("1");
    expect(snapshot.firedEvents[0]?.edge).toBe("falling");
  });

  it("updates a counter from its previous state", () => {
    const { circuit } = combinational(`CIRCUIT Counter4
INPUT clock
STATE count : BUS(4) = 0000
next = ADD(count, 1)
ON RISING_EDGE(clock):
  count = next
END
OUTPUT count
END`);
    const simulator = new Simulator(circuit);
    for (let i = 0; i < 3; i++) {
      simulator.setInput("clock", "1");
      simulator.setInput("clock", "0");
    }
    const snapshot = simulator.setInput("clock", "1");
    expect(snapshot.outputs.count?.binary).toBe("0100");
    simulator.reset();
    expect(simulator.snapshot().outputs.count?.binary).toBe("0000");
  });

  it("runs clocked suites with CYCLE", () => {
    const result = compile(`CIRCUIT Counter4
INPUT clock
INPUT reset
STATE count : BUS(4) = 0000
next = ADD(count, 1)
ON RISING_EDGE(clock):
  IF reset:
    count = 0
  ELSE:
    count = next
  END
END
OUTPUT count
END
TEST Counter4
CASE "counts three ticks"
  INPUT reset = 0
  INPUT clock = 0
  EXPECT count = 0000
  CYCLE clock 3
  EXPECT count = 0011
END
CASE "reset clears the count"
  INPUT reset = 0
  CYCLE clock 5
  EXPECT count = 0101
  INPUT reset = 1
  CYCLE clock 1
  EXPECT count = 0000
END
END`);
    expect(result.ok).toBe(true);
    const testResult = runTests(result);
    expect(testResult.unsupported).toBe(0);
    expect(testResult.failed, JSON.stringify(testResult, null, 2)).toBe(0);
    expect(testResult.passed).toBe(2);
    expect(testResult.suites[0]?.cases[0]?.pass).toBe(true);
  });

  it("groups input changes with STEP", () => {
    const result = compile(`CIRCUIT Register8
INPUT data : BUS(8)
INPUT clock
INPUT enable
STATE stored : BUS(8) = 0
ON RISING_EDGE(clock):
  IF enable:
    stored = data
  END
END
OUTPUT stored
END
TEST Register8
CASE "holds when enable is low"
  INPUT enable = 0
  INPUT data = 11110000
  STEP
    INPUT clock = 1
  END
  EXPECT stored = 00000000
END
CASE "captures when enable is high"
  INPUT enable = 1
  INPUT data = 10101010
  STEP
    INPUT clock = 1
  END
  EXPECT stored = 10101010
END
END`);
    const testResult = runTests(result);
    expect(testResult.failed, JSON.stringify(testResult, null, 2)).toBe(0);
    expect(testResult.passed).toBe(2);
  });

  it("loads a state at the start of a case", () => {
    const result = compile(`CIRCUIT Shift
INPUT clock
STATE q : BUS(4) = 0000
next = ADD(q, 1)
ON RISING_EDGE(clock):
  q = next
END
OUTPUT q
END
TEST Shift
CASE "starts from a loaded value"
  LOAD q = 0011
  CYCLE clock 1
  EXPECT q = 0100
END
END`);
    const testResult = runTests(result);
    expect(testResult.failed, JSON.stringify(testResult, null, 2)).toBe(0);
    expect(testResult.passed).toBe(1);
  });

  it("reports the failing step of a clocked case", () => {
    const result = compile(`CIRCUIT Shift
INPUT clock
STATE q : BUS(4) = 0000
next = ADD(q, 1)
ON RISING_EDGE(clock):
  q = next
END
OUTPUT q
END
TEST Shift
CASE "wrong expectation"
  CYCLE clock 1
  EXPECT q = 1111
END
END`);
    const testResult = runTests(result);
    expect(testResult.failed).toBe(1);
    const failure = testResult.suites[0]?.cases[0];
    expect(failure?.pass).toBe(false);
    expect(failure?.error).toContain("expected 1111, got 0001");
    expect(failure?.step).toBe(1);
  });

  it("rejects a LOAD on a signal that is not state", () => {
    const result = compile(`CIRCUIT Reg
INPUT clock
STATE q = 0
ON RISING_EDGE(clock):
  q = NOT(q)
END
OUTPUT q
END
TEST Reg
CASE "bad load"
  LOAD clock = 1
  EXPECT q = 0
END
END`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((entry) => entry.code === "E230")).toBe(true);
  });

  it("rejects a CYCLE on a bus", () => {
    const result = compile(`CIRCUIT Wide
INPUT bus : BUS(4)
STATE q = 0
ON RISING_EDGE(bus):
  q = NOT(q)
END
OUTPUT q
END
TEST Wide
CASE "bad cycle"
  CYCLE bus 2
  EXPECT q = 0
END
END`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((entry) => entry.code === "E303")).toBe(true);
  });

  it("forces a state value from the simulator", () => {
    const { circuit } = combinational(`CIRCUIT Reg
INPUT clock
STATE q : BUS(4) = 0000
ON RISING_EDGE(clock):
  q = ADD(q, 1)
END
OUTPUT q
END`);
    const simulator = new Simulator(circuit);
    expect(simulator.snapshot().states.q?.binary).toBe("0000");
    const snapshot = simulator.setState("q", "1010");
    expect(snapshot.states.q?.binary).toBe("1010");
    expect(() => simulator.setState("q", "11111")).toThrowError(
      expect.objectContaining({ code: "R411" }),
    );
  });
});

describe("diagnostics", () => {
  it("suggests a signal typo", () => {
    const result = compile(`CIRCUIT Typo
INPUT a
INPUT b
sum = XOR(a, b)
OUTPUT sum
END`);
    expect(result.ok).toBe(true);
    const bad = compile(`CIRCUIT Typo
INPUT a
INPUT b
sum = XOR(a, b)
carry = AND(a, b)
OUTPUT sum
OUTPUT cary
END`);
    expect(bad.ok).toBe(false);
    const diagnostic = bad.diagnostics.find((entry) => entry.code === "E201");
    expect(diagnostic?.message).toContain("cary");
    expect(diagnostic?.hint).toContain("carry");
  });

  it("detects width mismatches with useful context", () => {
    const result = compile(`CIRCUIT Widths
INPUT a : BUS(8)
INPUT b
bad = AND(a, b)
OUTPUT bad
END`);
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((entry) => entry.code === "E301");
    expect(diagnostic?.message).toContain("8 bits");
    expect(diagnostic?.message).toContain("1 bit");
  });

  it("rejects multiplication wider than the configured maximum", () => {
    const result = compile(`CIRCUIT WideMultiply
INPUT a : BUS(2049)
INPUT b : BUS(2049)
product = MULTIPLY(a, b)
OUTPUT product
END`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((entry) => entry.code === "E320")).toBe(true);
    expect(result.ir).toBeNull();
  });

  it("detects combinational feedback", () => {
    const result = compile(`CIRCUIT Loop
a = b
b = a
OUTPUT a
END`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((entry) => entry.code === "E310")).toBe(true);
  });

  it("rejects empty gate calls", () => {
    const result = compile(`CIRCUIT Empty
INPUT a
x = AND()
OUTPUT x
END`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((entry) => entry.code === "E302")).toBe(true);
  });

  it("suggests a gate name typo", () => {
    const result = compile(`CIRCUIT Typos
INPUT a
INPUT b
x = XORR(a, b)
OUTPUT x
END`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.find((entry) => entry.code === "E210")?.hint).toContain("XOR");
  });

  it("keeps the source and never returns an IR after fatal errors", () => {
    const source = "CIRCUIT Broken\nINPUT a\n";
    const result = compile(source);
    expect(result.ok).toBe(false);
    expect(result.ir).toBeNull();
    expect(result.source).toBe(source);
  });
});

describe("language metadata", () => {
  it("documents every built-in with a signature, width rule, and tip", () => {
    for (const spec of BUILTINS) {
      expect(spec.signature, spec.name).toContain(spec.name);
      expect(spec.widthRule.length, spec.name).toBeGreaterThan(4);
      expect(spec.tip.length, spec.name).toBeGreaterThan(10);
    }
    for (const spec of INTRINSIC_CIRCUITS) {
      expect(spec.signature, spec.name).toContain(spec.name);
      expect(spec.tip.length, spec.name).toBeGreaterThan(10);
    }
  });

  it("keeps the snippet library consistent", () => {
    expect(LANGUAGE_SNIPPETS.length).toBeGreaterThan(10);
    const ids = new Set<string>();
    for (const snippet of LANGUAGE_SNIPPETS) {
      expect(ids.has(snippet.id), snippet.id).toBe(false);
      ids.add(snippet.id);
      expect(snippet.title.length, snippet.id).toBeGreaterThan(2);
      expect(snippet.template.length, snippet.id).toBeGreaterThan(4);
      expect(snippet.preview.length, snippet.id).toBeGreaterThan(4);
      // Placeholders must be closed, or editors would insert broken text.
      const opens = (snippet.template.match(/\$\{/g) ?? []).length;
      const closes = (snippet.template.match(/\}/g) ?? []).length;
      expect(opens, snippet.id).toBe(closes);
    }
  });
});

describe("formatting", () => {
  it("normalizes indentation and keyword case", () => {
    const source = `circuit HalfAdder
input a
input b
sum = XOR(a, b)
output sum
end`;
    const formatted = formatSource(source);
    expect(formatted).toContain("CIRCUIT HalfAdder");
    expect(formatted).toContain("  INPUT a");
    expect(formatted).toContain("  sum = XOR(a, b)");
    expect(formatted.trimEnd().endsWith("END")).toBe(true);
  });
});
