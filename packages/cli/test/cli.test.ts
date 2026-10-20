import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args";
import { run } from "../src/cli";

const SOURCE = `CIRCUIT HalfAdder
INPUT a
INPUT b

sum = XOR(a, b)
carry = AND(a, b)

OUTPUT sum
OUTPUT carry
END

TEST HalfAdder
CASE "both high"
  INPUT a = 1
  INPUT b = 1
  EXPECT sum = 0
  EXPECT carry = 1
END
END`;

const BROKEN = `CIRCUIT Broken
INPUT a
x = AND(a, missing)
OUTPUT x
END`;

function withFile(contents: string) {
  const writes = new Map<string, string>();
  const read = (file: string) => {
    if (file === "circuit.lf") return contents;
    throw new Error("missing file");
  };
  const write = (file: string, data: string) => {
    writes.set(file, data);
  };
  return { read, write, writes };
}

describe("command line", () => {
  it("parses commands, positionals, and flags", () => {
    const parsed = parseArgs(["truth-table", "a.lf", "--circuit", "Adder", "--json"]);
    expect(parsed.command).toBe("truth-table");
    expect(parsed.positionals).toEqual(["a.lf"]);
    expect(parsed.flags.circuit).toBe("Adder");
    expect(parsed.flags.json).toBe(true);
  });

  it("compiles a file and reports a clean result", () => {
    const { read, write } = withFile(SOURCE);
    const result = run(["compile", "circuit.lf"], read, write);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("fails with a non-zero exit code on a diagnostic error", () => {
    const { read, write } = withFile(BROKEN);
    const result = run(["compile", "circuit.lf"], read, write);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("E201");
  });

  it("runs the test blocks", () => {
    const { read, write } = withFile(SOURCE);
    const result = run(["test", "circuit.lf"], read, write);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("PASS");
    expect(result.stdout).toContain("1 passed");
  });

  it("prints a truth table", () => {
    const { read, write } = withFile(SOURCE);
    const result = run(["truth-table", "circuit.lf"], read, write);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("a | b | sum | carry");
    expect(result.stdout).toContain("1 | 1 | 0 | 1");
  });

  it("formats a file in place with --write", () => {
    const { read, write, writes } = withFile("  circuit x = 1\n");
    const result = run(["format", "circuit.lf", "--write"], read, write);
    expect(result.code).toBe(0);
    expect(writes.get("circuit.lf")).toBe("CIRCUIT x = 1\n");
  });

  it("exports the IR and Verilog", () => {
    const { read, write } = withFile(SOURCE);
    const ir = run(["export-ir", "circuit.lf"], read, write);
    expect(ir.code).toBe(0);
    expect(JSON.parse(ir.stdout).schema).toBe("shortcircuit.ir/v1");

    const verilog = run(["export-verilog", "circuit.lf"], read, write);
    expect(verilog.code).toBe(0);
    expect(verilog.stdout).toContain("module HalfAdder");
  });

  it("prints machine-readable output with --json", () => {
    const { read, write } = withFile(SOURCE);
    const result = run(["test", "circuit.lf", "--json"], read, write);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.passed).toBe(1);
  });

  it("shows the help for an unknown command", () => {
    const { read, write } = withFile(SOURCE);
    const result = run(["nonsense", "circuit.lf"], read, write);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("Usage:");
  });
});
