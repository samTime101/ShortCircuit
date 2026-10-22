import { describe, expect, it } from "vitest";
import {
  BUILTINS,
  LANGUAGE_SNIPPETS,
  Simulator,
  binaryToDecimal,
  compile,
  exportVerilog,
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

const HALF_ADDER = `// A one-bit half adder made from package gates.
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

  it("supports variadic package gates and nested expressions", () => {
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

  it("elaborates package circuit-shaped components into the NAND kernel", () => {
    const { circuit } = combinational(`CIRCUIT Intrinsic
INPUT a
INPUT b
INPUT c
full = FULL_ADDER(a, b, c)
OUTPUT full.sum
OUTPUT full.carry_out
END`);
    expect(circuit.nodes.some((node) => node.op === "NAND")).toBe(true);
    expect(
      circuit.nodes.every(
        (node) =>
          node.kind !== "operation" ||
          node.op === "NAND" ||
          [
            "CONCAT",
            "SLICE",
            "BROADCAST",
            "ZEXT",
            "SEXT",
            "REPEAT",
            "REVERSE",
          ].includes(node.op ?? ""),
      ),
    ).toBe(true);
    const simulator = new Simulator(circuit);
    const outputs = simulator.setInputs({ a: "1", b: "1", c: "1" }).outputs;
    expect(outputs["full.sum"]?.binary).toBe("1");
    expect(outputs["full.carry_out"]?.binary).toBe("1");
  });
});

describe("buses, structural wiring, and package selection", () => {
  const ADDER8 = `CIRCUIT Adder8
INPUT a : BUS(8)
INPUT b : BUS(8)
added = ADD8(a, b, 0)
sum = added.sum
carry_out = added.carry_out
OUTPUT sum
OUTPUT carry_out
END
TEST Adder8
CASE "small"
  INPUT a = 00000001
  INPUT b = 00000010
  EXPECT sum = 00000011
  EXPECT carry_out = 0
END
CASE "overflow wraps"
  INPUT a = 11111111
  INPUT b = 00000001
  EXPECT sum = 00000000
  EXPECT carry_out = 1
END
END`;

  it("uses fixed-width package adders", () => {
    const { result, circuit } = combinational(ADDER8);
    expect(circuit.inputs[0]?.width).toBe(8);
    expect(circuit.outputs[0]?.width).toBe(8);
    const simulator = new Simulator(circuit);
    const outputs = simulator.setInputs({ a: "11111111", b: "00000001" }).outputs;
    expect(outputs.sum?.binary).toBe("00000000");
    expect(outputs.carry_out?.binary).toBe("1");
    expect(runTests(result).ok).toBe(true);
  });

  it("supports structural wiring and package MUX", () => {
    const { circuit } = combinational(`CIRCUIT BusOps
INPUT data : BUS(8)
INPUT small : BUS(4)
INPUT pick
upper = data[7:4]
lower = data[3:0]
low_bit = data[0]
joined = CONCAT(upper, lower)
chosen = MUX(lower, upper, pick)
slice_fn = SLICE(data, 5, 2)
wide = ZEXT(small, 8)
signed = SEXT(small, 8)
twice = REPEAT(small, 2)
flipped = REVERSE(data)
spread = BROADCAST(pick, data)
OUTPUT upper
OUTPUT low_bit
OUTPUT joined
OUTPUT chosen
OUTPUT slice_fn
OUTPUT wide
OUTPUT signed
OUTPUT twice
OUTPUT flipped
OUTPUT spread
END`);
    const simulator = new Simulator(circuit);
    let outputs = simulator.setInputs({
      data: "10101100",
      small: "1010",
      pick: "0",
    }).outputs;
    expect(outputs.upper?.binary).toBe("1010");
    expect(outputs.low_bit?.binary).toBe("0");
    expect(outputs.joined?.binary).toBe("10101100");
    expect(outputs.chosen?.binary).toBe("1100");
    expect(outputs.slice_fn?.binary).toBe("1011");
    expect(outputs.wide?.binary).toBe("00001010");
    expect(outputs.signed?.binary).toBe("11111010");
    expect(outputs.twice?.binary).toBe("10101010");
    expect(outputs.flipped?.binary).toBe("00110101");
    expect(outputs.spread?.binary).toBe("00000000");
    outputs = simulator.setInputs({ pick: "1" }).outputs;
    expect(outputs.chosen?.binary).toBe("1010");
    expect(outputs.spread?.binary).toBe("11111111");
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
next = MUX(stored, data, enable)
ON RISING_EDGE(clock):
  stored = next
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
incremented = ADD4(count, 0, 1)
ON RISING_EDGE(clock):
  count = incremented.sum
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

  it("runs clocked suites with CYCLE and MUX reset logic", () => {
    const result = compile(`CIRCUIT Counter4
INPUT clock
INPUT reset
STATE count : BUS(4) = 0000
incremented = ADD4(count, 0, 1)
next = MUX(incremented.sum, 0, reset)
ON RISING_EDGE(clock):
  count = next
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
next = MUX(stored, data, enable)
ON RISING_EDGE(clock):
  stored = next
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
incremented = ADD4(q, 0, 1)
ON RISING_EDGE(clock):
  q = incremented.sum
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
incremented = ADD4(q, 0, 1)
ON RISING_EDGE(clock):
  q = incremented.sum
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
incremented = ADD4(q, 0, 1)
ON RISING_EDGE(clock):
  q = incremented.sum
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

  it("explains diagnostics in plain language and offers a fix", () => {
    const result = compile(`CIRCUIT Typo
INPUT a
INPUT b
sum = XOR(a, b)
carry = AND(a, b)
OUTPUT sum
OUTPUT cary
END`);
    const diagnostic = result.diagnostics.find((entry) => entry.code === "E201");
    expect(diagnostic?.plain).toBeDefined();
    expect(diagnostic?.plain?.headline).toMatch(/no signal/i);
    expect(diagnostic?.plain?.detail.length).toBeGreaterThan(10);
    expect(diagnostic?.plain?.fix?.text).toBe("carry");
    expect(diagnostic?.plain?.fix?.label).toContain("carry");
  });

  it("explains width mismatches without offering a blind fix", () => {
    const result = compile(`CIRCUIT Widths
INPUT a : BUS(8)
INPUT b
bad = AND(a, b)
OUTPUT bad
END`);
    const diagnostic = result.diagnostics.find((entry) => entry.code === "E301");
    expect(diagnostic?.plain?.headline).toMatch(/different sizes/i);
    expect(diagnostic?.plain?.fix).toBeUndefined();
  });

  it("keeps the source and never returns an IR after fatal errors", () => {
    const source = "CIRCUIT Broken\nINPUT a\n";
    const result = compile(source);
    expect(result.ok).toBe(false);
    expect(result.ir).toBeNull();
    expect(result.source).toBe(source);
  });

  it("reports an error in a circuit once even when another circuit instantiates it", () => {
    const result = compile(`CIRCUIT Inner
INPUT a : BUS(4)
compared = COMPARE4(a, 1000)
OUTPUT compared.eq
END

CIRCUIT Top
INPUT a : BUS(4)
inner = Inner(a)
OUTPUT inner.compared.eq
END`);
    const errors = result.diagnostics.filter((entry) => entry.code === "E305");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.line).toBe(3);
  });
});

describe("removed language features", () => {
  it("reports CONST with a migration hint", () => {
    const result = compile(`CONST W = 4
CIRCUIT Width
INPUT a : BUS(4)
OUTPUT a
END`);
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((entry) => entry.code === "E100");
    expect(diagnostic?.message).toContain("CONST");
    expect(diagnostic?.hint).toContain("numeric literal");
  });

  it("reports FOR with a migration hint", () => {
    const result = compile(`CIRCUIT Loop
INPUT a
FOR i IN 0..3
  x = a
END
OUTPUT a
END`);
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((entry) => entry.code === "E102");
    expect(diagnostic?.message).toContain("FOR");
  });

  it("reports IF in a clocked block", () => {
    const result = compile(`CIRCUIT Conditional
INPUT clock
INPUT enable
STATE q = 0
ON RISING_EDGE(clock):
  IF enable:
    q = 1
  END
END
OUTPUT q
END`);
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((entry) => entry.code === "E106");
    expect(diagnostic?.message).toContain("IF");
    expect(diagnostic?.hint).toContain("MUX");
  });

  it("reports circuit parameters", () => {
    const result = compile(`CIRCUIT Register(N = 8)
INPUT data : BUS(8)
OUTPUT data
END`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((entry) => entry.code === "E121")).toBe(true);
  });

  it("does not keep word-level operations in the kernel", () => {
    const result = compile(`CIRCUIT Old
INPUT a : BUS(4)
INPUT b : BUS(4)
sum = ADD(a, b)
OUTPUT sum
END`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((entry) => entry.code === "E210")).toBe(true);
  });
});

describe("literal clarity", () => {
  it("warns when a bare number could be read two ways", () => {
    const result = compile(`CIRCUIT Ambiguous
INPUT a : BUS(4)
value = AND(a, 10)
OUTPUT value
END`);
    const warning = result.diagnostics.find((entry) => entry.code === "W402");
    expect(warning).toBeDefined();
    expect(warning?.message).toContain("decimal");
    expect(result.ok).toBe(true);
  });

  it("stays quiet for a bit pattern in a test", () => {
    const result = compile(`CIRCUIT Wide
INPUT a : BUS(8)
OUTPUT value
value = a
END

TEST Wide
CASE "all ones"
  INPUT a = 11111111
  EXPECT value = 11111111
END
END`);
    expect(result.diagnostics.some((entry) => entry.code === "W402")).toBe(false);
  });

  it("does not warn when both readings agree", () => {
    const result = compile(`CIRCUIT Clear
INPUT a : BUS(4)
value = AND(a, 0010)
OUTPUT value
END`);
    expect(result.diagnostics.some((entry) => entry.code === "W402")).toBe(false);
  });
});

describe("verilog export", () => {
  it("writes a module with continuous assignments", () => {
    const result = compile(`CIRCUIT HalfAdder
INPUT a
INPUT b
sum = XOR(a, b)
carry = AND(a, b)
OUTPUT sum
OUTPUT carry
END`);
    const { verilog } = exportVerilog(result.ir!);
    expect(verilog).toContain("module HalfAdder (");
    expect(verilog).toContain("input  a");
    expect(verilog).toContain("output sum");
    expect(verilog).toMatch(/assign sum = ~\(/);
    expect(verilog).toMatch(/assign carry = ~\(/);
    expect(verilog).toContain("endmodule");
  });

  it("gives each literal constant a unique Verilog localparam", () => {
    const result = compile(`CIRCUIT Masks
INPUT a : BUS(4)
high = AND(a, 0b1100)
low = AND(a, 0b0011)
OUTPUT high
OUTPUT low
END`);
    const { verilog } = exportVerilog(result.ir!);
    expect(verilog).toContain("= 4'b1100;");
    expect(verilog).toContain("= 4'b0011;");
    expect(verilog.match(/localparam/g)).toHaveLength(2);
    expect(verilog).not.toContain("unused");
  });

  it("writes clocked state as an edge block with non-blocking assignments", () => {
    const result = compile(`CIRCUIT Register8
INPUT data : BUS(8)
INPUT clock
STATE stored : BUS(8) = 0
ON RISING_EDGE(clock):
  stored = data
END
OUTPUT stored
END`);
    const { verilog } = exportVerilog(result.ir!);
    expect(verilog).toContain("reg  [7:0] stored_reg;");
    expect(verilog).toContain("always @(posedge clock) begin");
    expect(verilog).toContain("stored_reg <= data;");
    expect(verilog).toContain("initial begin");
  });

  it("can generate a testbench", () => {
    const result = compile(`CIRCUIT HalfAdder
INPUT a
INPUT b
sum = XOR(a, b)
OUTPUT sum
END
TEST HalfAdder
CASE "both"
  INPUT a = 1
  INPUT b = 1
  EXPECT sum = 0
END
END`);
    const { verilog } = exportVerilog(result.ir!, { includeTestbenches: true });
    expect(verilog).toContain("module HalfAdder_tb;");
    expect(verilog).toContain("HalfAdder dut (");
    expect(verilog).toContain("if (sum !== 1'b0)");
  });
});

describe("language metadata", () => {
  it("keeps only structural operations in the kernel", () => {
    expect(BUILTINS.map((spec) => spec.name).sort()).toEqual(
      [
        "BROADCAST",
        "CONCAT",
        "NAND",
        "REPEAT",
        "REVERSE",
        "SEXT",
        "SLICE",
        "ZEXT",
      ].sort(),
    );
    for (const spec of BUILTINS) {
      expect(spec.signature, spec.name).toContain(spec.name);
      expect(spec.widthRule.length, spec.name).toBeGreaterThan(4);
      expect(spec.tip.length, spec.name).toBeGreaterThan(10);
    }
  });

  it("keeps the snippet library consistent and free of removed syntax", () => {
    expect(LANGUAGE_SNIPPETS.length).toBeGreaterThan(8);
    const ids = new Set<string>();
    for (const snippet of LANGUAGE_SNIPPETS) {
      expect(ids.has(snippet.id), snippet.id).toBe(false);
      ids.add(snippet.id);
      expect(snippet.title.length, snippet.id).toBeGreaterThan(2);
      expect(snippet.template.length, snippet.id).toBeGreaterThan(4);
      expect(snippet.preview.length, snippet.id).toBeGreaterThan(4);
      expect(snippet.template, snippet.id).not.toMatch(/\b(IF|ELSE|FOR|CONST)\b/);
      expect(snippet.preview, snippet.id).not.toMatch(/\b(IF|ELSE|FOR|CONST)\b/);
      // Placeholders must be closed, or editors would insert broken text.
      const opens = (snippet.template.match(/\$\{/g) ?? []).length;
      const closes = (snippet.template.match(/\}/g) ?? []).length;
      expect(opens, snippet.id).toBe(closes);
    }
  });
});

describe("value formatting", () => {
  it("reads a binary string as a decimal number", () => {
    expect(binaryToDecimal("1010")).toBe("10");
    expect(binaryToDecimal("0101")).toBe("5");
    expect(binaryToDecimal("0000")).toBe("0");
    expect(binaryToDecimal("11111111")).toBe("255");
  });

  it("treats a non-binary string as zero", () => {
    expect(binaryToDecimal("")).toBe("0");
    expect(binaryToDecimal("2")).toBe("0");
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

describe("comments", () => {
  const CIRCUIT_BODY = `CIRCUIT Comments
INPUT a
OUTPUT a
END`;

  it("ignores line comments on their own and after a statement", () => {
    const result = compile(`// a leading note
${CIRCUIT_BODY}   // a trailing note`);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.circuits[0]?.inputs.map((input) => input.name)).toEqual(["a"]);
  });

  it("ignores a block comment that spans several lines", () => {
    const result = compile(`CIRCUIT Comments
/* this comment
   covers three
   lines */
INPUT a
OUTPUT a
END`);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("ignores a block comment on a single line", () => {
    const result = compile(`CIRCUIT Comments
INPUT a /* inline */ 
OUTPUT a
END`);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("keeps code that follows a closed block comment", () => {
    const result = compile(`CIRCUIT Comments
/* note */ INPUT a
OUTPUT a
END`);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.circuits[0]?.inputs.map((input) => input.name)).toEqual(["a"]);
  });

  it("no longer treats # as a comment", () => {
    const result = compile(`CIRCUIT Comments
# old style comment
INPUT a
OUTPUT a
END`);
    expect(result.ok).toBe(false);
    const error = result.diagnostics.find((item) => item.code === "E002");
    expect(error?.message).toContain("#");
    expect(error?.hint).toContain("//");
  });

  it("reports an unterminated block comment", () => {
    const result = compile(`CIRCUIT Comments
/* never closed
INPUT a
OUTPUT a
END`);
    expect(result.ok).toBe(false);
    const error = result.diagnostics.find((item) => item.code === "E003");
    expect(error?.message).toBe("Unterminated block comment.");
    expect(error?.hint).toContain("*/");
  });

  it("keeps comment markers inside strings as plain characters", () => {
    const result = compile(`CIRCUIT Comments
INPUT a
OUTPUT a
END
TEST Comments
CASE "a // b"
  INPUT a = 1
  EXPECT a = 1
END
END`);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  });

  it("keeps comments out of the formatted source", () => {
    const source = `circuit Comments
// a note
input a
output a
end`;
    const formatted = formatSource(source);
    expect(formatted).toContain("// a note");
    expect(formatted).toContain("  INPUT a");
  });

  it("keeps a block comment intact while formatting", () => {
    const source = `circuit Comments
/* a block
   comment */
input a
output a
end`;
    const formatted = formatSource(source);
    expect(formatted).toContain("/* a block");
    expect(formatted).toContain("comment */");
    expect(formatted).toContain("  INPUT a");
  });

  it("does not re-case words inside a comment", () => {
    const source = `circuit Comments
// end is not a keyword here
input a
end`;
    const formatted = formatSource(source);
    expect(formatted).toContain("// end is not a keyword here");
  });
});
