import { describe, expect, it } from "vitest";
import { compile, exportVerilog, runTests, Simulator } from "../src/index";
import { DiagnosticBag } from "../src/diagnostics";

const TOGGLE = `CIRCUIT Toggle
  INPUT clk
  STATE q = 0
  ON RISING_EDGE(clk):
    q = NAND(q, q)
  END
  OUTPUT q
END
`;

describe("test runner regressions", () => {
  it("pulses a clock nested inside STEP", () => {
    const result = compile(`${TOGGLE}
TEST Toggle
  CASE "cycle inside step"
    STEP
      CYCLE clk 1
      EXPECT q = 1
    END
  END
END`);
    expect(result.ok).toBe(true);
    const run = runTests(result);
    expect(run.failed).toBe(0);
    expect(run.passed).toBe(1);
  });

  it("runs a STEP nested inside a STEP", () => {
    const result = compile(`${TOGGLE}
TEST Toggle
  CASE "nested step"
    STEP
      STEP
        CYCLE clk 2
      END
      EXPECT q = 0
    END
  END
END`);
    expect(result.ok).toBe(true);
    const run = runTests(result);
    expect(run.failed).toBe(0);
    expect(run.passed).toBe(1);
  });

  it("counts passing and failing cases in the same suite", () => {
    const result = compile(`CIRCUIT Inv
  INPUT a
  y = NAND(a, a)
  OUTPUT y
END

TEST Inv
  CASE "passes"
    INPUT a = 0
    EXPECT y = 1
  END
  CASE "fails"
    INPUT a = 0
    EXPECT y = 0
  END
END`);
    expect(result.ok).toBe(true);
    const run = runTests(result);
    expect(run.passed).toBe(1);
    expect(run.failed).toBe(1);
  });
});

describe("simulator regressions", () => {
  it("captures construction failures on the snapshot instead of throwing", () => {
    const result = compile(TOGGLE);
    expect(result.ok).toBe(true);
    const circuit = result.circuits[0]!;
    const simulator = new Simulator({
      ...circuit,
      nodes: [
        ...circuit.nodes,
        {
          id: "dangling",
          kind: "operation",
          op: "NAND",
          width: 1,
          label: "dangling",
          scope: [],
          operands: ["missing"],
          line: 1,
          column: 1,
        },
      ],
    });
    expect(simulator.runtimeError?.code).toBe("R408");
    expect(simulator.snapshot().runtimeError).toEqual({
      code: "R408",
      message: expect.stringContaining("missing"),
    });
  });
});

describe("verilog export regressions", () => {
  it("does not emit zero-width replication for equal-width extensions", () => {
    const result = compile(`CIRCUIT Same
  INPUT a : BUS(4)
  y = ZEXT(a, 4)
  s = SEXT(a, 4)
  OUTPUT y
  OUTPUT s
END`);
    expect(result.ok).toBe(true);
    const { verilog } = exportVerilog(result.ir!);
    expect(verilog).not.toContain("{{0{");
    expect(verilog).toContain("assign y = a;");
  });

  it("uses the reserved port names in generated testbenches", () => {
    const result = compile(`CIRCUIT Child
  INPUT a
  y = NAND(a, a)
  OUTPUT y
END

CIRCUIT Top
  INPUT a
  c = Child(a)
  c_y = NAND(a, a)
  OUTPUT c.y
  OUTPUT c_y
END

TEST Top
  CASE "collision"
    INPUT a = 1
    EXPECT c.y = 0
    EXPECT c_y = 0
  END
END`);
    expect(result.ok).toBe(true);
    const { verilog } = exportVerilog(result.ir!, { includeTestbenches: true });
    // "c.y" and "c_y" sanitize to the same base, so the second port is
    // reserved as c_y_2. The testbench must connect the wire with that name.
    expect(verilog).toContain(".c_y(c_y)");
    expect(verilog).toContain(".c_y_2(c_y_2)");
  });
});

describe("analyzer regressions", () => {
  it("does not materialise compile-time slice and width arguments as nodes", () => {
    const result = compile(`CIRCUIT Trim
  INPUT a : BUS(4)
  y = SLICE(a, 3, 0)
  z = ZEXT(a, 8)
  r = REPEAT(a, 2)
  s = SEXT(a, 4)
  OUTPUT y
  OUTPUT z
  OUTPUT r
  OUTPUT s
END`);
    expect(result.ok).toBe(true);
    const circuit = result.circuits[0]!;
    // a + SLICE + ZEXT + REPEAT + SEXT. The bounds 3, 0, 8, 2 are not nodes.
    expect(circuit.stats.nodes).toBe(5);
    expect(circuit.nodes.filter((node) => node.kind === "constant")).toEqual([]);
  });

  it("suppresses cascading test diagnostics after a syntax error", () => {
    const result = compile(`CIRCUIT BrokenTest
  INPUT a
  y = NAND(a, a)
  OUTPUT y
END

TEST BrokenTest
  CASE "unfinished"
    INPUT a = 1
    EXPECT y = 0
`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((item) => item.code === "E221")).toBe(false);
    expect(result.diagnostics.some((item) => item.code === "E211")).toBe(false);
  });

  it("says when the diagnostics list was truncated", () => {
    const bag = new DiagnosticBag(2);
    bag.error("E100", "first", 1, 1);
    bag.error("E101", "second", 2, 1);
    bag.error("E102", "third", 3, 1);
    bag.error("E103", "fourth", 4, 1);
    const sorted = bag.sorted();
    expect(sorted).toHaveLength(3);
    expect(sorted.at(-1)).toMatchObject({
      code: "W900",
      severity: "warning",
      message: "Showing 2 of 4 diagnostics.",
    });
  });
});
