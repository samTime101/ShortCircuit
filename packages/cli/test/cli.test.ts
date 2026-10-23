import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listFlag, parseArgs } from "../src/args";
import { run } from "../src/cli";
import { cleanupTempDirs, tempDir, writeDoublePackage } from "./helpers";

afterEach(cleanupTempDirs);

const SOURCE = `IMPORT "@shortcircuit/gates"

CIRCUIT HalfAdder
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

const BROKEN = `IMPORT "@shortcircuit/gates"

CIRCUIT Broken
INPUT a
x = AND(a, missing)
OUTPUT x
END`;

const NAND_SOURCE = `CIRCUIT NandOnly
INPUT a
INPUT b
y = NAND(a, b)
OUTPUT y
END`;

const LOCAL_SOURCE = `IMPORT "@test/double"

CIRCUIT LocalDouble
INPUT a
y = TWICE(a)
OUTPUT y
END`;

const LOCAL_TEST_SOURCE = `${LOCAL_SOURCE}

TEST LocalDouble
CASE "high"
  INPUT a = 1
  EXPECT y = 1
END
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

function packageRow(stdout: string, name: string): string {
  return stdout.split("\n").find((line) => line.startsWith(name)) ?? "";
}

describe("command line", () => {
  it("parses commands, positionals, and flags", () => {
    const parsed = parseArgs(["truth-table", "a.lf", "--circuit", "Adder", "--json"]);
    expect(parsed.command).toBe("truth-table");
    expect(parsed.positionals).toEqual(["a.lf"]);
    expect(parsed.flags.circuit).toBe("Adder");
    expect(parsed.flags.json).toBe(true);
  });

  it("parses repeatable package flags", () => {
    const parsed = parseArgs([
      "compile",
      "a.lf",
      "--package",
      "pkg-a",
      "--package=pkg-b",
    ]);

    expect(parsed.flags.package).toEqual(["pkg-a", "pkg-b"]);
    expect(listFlag(parsed.flags, "package")).toEqual(["pkg-a", "pkg-b"]);
  });

  it("rejects a package flag without a value", () => {
    const parsed = parseArgs(["compile", "a.lf", "--package"]);
    expect(() => listFlag(parsed.flags, "package")).toThrow("needs a value");
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

  it("documents package commands and flags", () => {
    const result = run(["help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("shortcircuit package list");
    expect(result.stdout).toContain("shortcircuit package registry");
    expect(result.stdout).toContain("shortcircuit package init");
    expect(result.stdout).toContain("shortcircuit package build");
    expect(result.stdout).toContain("shortcircuit package test");
    expect(result.stdout).toContain("shortcircuit package check");
    expect(result.stdout).toContain("--package <dir>");
    expect(result.stdout).toContain("--root <dir>");
    expect(result.stdout).toContain("--main <dir>");
    expect(result.stdout).not.toContain("--disable-package");
    expect(result.stdout).not.toContain("--only-packages");
    expect(result.stdout).not.toContain("--no-default-packages");
  });

  it("requires an explicit import before using package exports", () => {
    const core = withFile(NAND_SOURCE);
    const coreResult = run(["compile", "circuit.lf"], core.read, core.write);
    expect(coreResult.code).toBe(0);

    const unimported = withFile(`CIRCUIT HalfAdder
INPUT a
INPUT b
sum = XOR(a, b)
OUTPUT sum
END`);
    const blocked = run(["compile", "circuit.lf"], unimported.read, unimported.write);
    expect(blocked.code).toBe(1);
    expect(blocked.stderr).toContain("E210");
    expect(blocked.stderr).toContain("XOR");

    const imported = withFile(SOURCE);
    const ok = run(["compile", "circuit.lf"], imported.read, imported.write);
    expect(ok.code).toBe(0);
  });

  it("reports an import for a package that is not loaded", () => {
    const missing = withFile(`IMPORT "@missing/package"
CIRCUIT Empty
END`);
    const result = run(["compile", "circuit.lf"], missing.read, missing.write);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("E602");
  });

  it("loads a local package directory", () => {
    const root = tempDir();
    writeDoublePackage(root, { docs: true, tests: true });
    const { read, write } = withFile(LOCAL_SOURCE);
    const result = run(["compile", "circuit.lf", "--package", root], read, write);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Compiled 1 circuit");
  });

  it("keeps bundled packages available while loading a local package", () => {
    const root = tempDir();
    writeDoublePackage(root);
    const { read, write } = withFile(LOCAL_SOURCE);
    const result = run(["compile", "circuit.lf", "--package", root], read, write);
    expect(result.code).toBe(0);
  });

  it("runs tests with a local package", () => {
    const root = tempDir();
    writeDoublePackage(root);
    const { read, write } = withFile(LOCAL_TEST_SOURCE);
    const result = run(["test", "circuit.lf", "--package", root], read, write);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("PASS  LocalDouble");
    expect(result.stdout).toContain("1 passed");
  });

  it("reports an invalid local package path", () => {
    const { read, write } = withFile(SOURCE);
    const result = run(
      ["compile", "circuit.lf", "--package", join(tempDir(), "missing")],
      read,
      write,
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Could not find package");
  });

  it("reports a package flag without a value at run time", () => {
    const { read, write } = withFile(SOURCE);
    const result = run(["compile", "circuit.lf", "--package"], read, write);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("needs a value");
  });

  it("lists packages without reading a source file", () => {
    const result = run(["package", "list"], () => {
      throw new Error("package list should not read a source file");
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("NAME");
    expect(result.stdout).toContain("@shortcircuit/gates");
    expect(result.stdout).toContain("bundled");
    expect(result.stdout).toContain("Import a package in source");
    expect(result.stdout).not.toContain("enabled");
  });

  it("lists a local package with its origin", () => {
    const root = tempDir();
    writeDoublePackage(root);
    const result = run(["package", "list", "--package", root]);
    expect(result.code).toBe(0);
    const row = packageRow(result.stdout, "@test/double");
    expect(row).toContain(root);
    expect(result.stdout).toContain("4 bundled, 1 local");
  });

  it("prints package list JSON", () => {
    const root = tempDir();
    writeDoublePackage(root);
    const result = run(["package", "list", "--json", "--package", root]);
    expect(result.code).toBe(0);
    const data = JSON.parse(result.stdout) as {
      packages: Array<{ name: string; origin: string; exports: number }>;
    };
    expect(
      data.packages.find((pkg) => pkg.name === "@shortcircuit/arithmetic")?.origin,
    ).toBe("bundled");
    expect(data.packages.find((pkg) => pkg.name === "@test/double")).toMatchObject({
      origin: root,
    });
  });

  it("rejects a file argument for package list", () => {
    const result = run(["package", "list", "circuit.lf"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("does not take a file");
  });

  it("rejects an unknown package subcommand", () => {
    const result = run(["package", "install"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unknown package command");
  });
});
