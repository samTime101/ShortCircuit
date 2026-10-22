import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listFlag, parseArgs } from "../src/args";
import { run } from "../src/cli";
import { cleanupTempDirs, tempDir, writeDoublePackage } from "./helpers";

afterEach(cleanupTempDirs);

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

const NAND_SOURCE = `CIRCUIT NandOnly
INPUT a
INPUT b
y = NAND(a, b)
OUTPUT y
END`;

const LOCAL_SOURCE = `CIRCUIT LocalDouble
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
      "--disable-package",
      "@shortcircuit/arithmetic",
      "--disable-package=@shortcircuit/selection",
      "--only-packages",
      "@shortcircuit/gates,@shortcircuit/arithmetic",
      "--package",
      "pkg-a",
      "--package=pkg-b",
      "--no-default-packages",
    ]);

    expect(parsed.flags["disable-package"]).toEqual([
      "@shortcircuit/arithmetic",
      "@shortcircuit/selection",
    ]);
    expect(parsed.flags["only-packages"]).toEqual([
      "@shortcircuit/gates,@shortcircuit/arithmetic",
    ]);
    expect(parsed.flags.package).toEqual(["pkg-a", "pkg-b"]);
    expect(parsed.flags["no-default-packages"]).toBe(true);
    expect(listFlag(parsed.flags, "only-packages", true)).toEqual([
      "@shortcircuit/gates",
      "@shortcircuit/arithmetic",
    ]);
    expect(listFlag(parsed.flags, "package")).toEqual(["pkg-a", "pkg-b"]);
  });

  it("rejects a package flag without a value", () => {
    const parsed = parseArgs(["compile", "a.lf", "--package"]);
    expect(() => listFlag(parsed.flags, "package")).toThrow("needs a value");
  });

  it("rejects an empty package name in a list", () => {
    const parsed = parseArgs(["compile", "a.lf", "--only-packages", "@shortcircuit/gates,"]);
    expect(() => listFlag(parsed.flags, "only-packages", true)).toThrow("needs a value");
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
    expect(result.stdout).toContain("--package <dir>");
    expect(result.stdout).toContain("--disable-package <name>");
    expect(result.stdout).toContain("--only-packages <names>");
    expect(result.stdout).toContain("--no-default-packages");
  });

  it("disables a bundled package", () => {
    const { read, write } = withFile(SOURCE);
    const result = run(
      ["compile", "circuit.lf", "--disable-package", "@shortcircuit/gates"],
      read,
      write,
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("E210");
    expect(result.stderr).toContain("XOR");
  });

  it("honors an only-packages allowlist", () => {
    const allowed = withFile(SOURCE);
    const enabled = run(
      ["compile", "circuit.lf", "--only-packages", "@shortcircuit/gates"],
      allowed.read,
      allowed.write,
    );
    expect(enabled.code).toBe(0);

    const excluded = withFile(SOURCE);
    const blocked = run(
      ["compile", "circuit.lf", "--only-packages", "@shortcircuit/arithmetic"],
      excluded.read,
      excluded.write,
    );
    expect(blocked.code).toBe(1);
    expect(blocked.stderr).toContain("XOR");
  });

  it("removes bundled packages with --no-default-packages", () => {
    const core = withFile(NAND_SOURCE);
    const ok = run(["compile", "circuit.lf", "--no-default-packages"], core.read, core.write);
    expect(ok.code).toBe(0);

    const gates = withFile(SOURCE);
    const blocked = run(
      ["compile", "circuit.lf", "--no-default-packages"],
      gates.read,
      gates.write,
    );
    expect(blocked.code).toBe(1);
  });

  it("loads a local package directory", () => {
    const root = tempDir();
    writeDoublePackage(root, { docs: true, tests: true });
    const { read, write } = withFile(LOCAL_SOURCE);
    const result = run(["compile", "circuit.lf", "--package", root], read, write);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Compiled 1 circuit");
  });

  it("combines a local package with only-packages and no-default-packages", () => {
    const root = tempDir();
    writeDoublePackage(root);
    const { read, write } = withFile(LOCAL_SOURCE);
    const result = run(
      [
        "compile",
        "circuit.lf",
        "--package",
        root,
        "--only-packages",
        "@test/double",
        "--no-default-packages",
      ],
      read,
      write,
    );
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
    expect(result.stdout).toContain("enabled");
    expect(result.stdout).toContain("bundled");
  });

  it("shows disabled and enabled packages", () => {
    const result = run([
      "package",
      "list",
      "--disable-package",
      "@shortcircuit/arithmetic",
    ]);
    expect(result.code).toBe(0);
    expect(packageRow(result.stdout, "@shortcircuit/gates")).toContain("enabled");
    expect(packageRow(result.stdout, "@shortcircuit/arithmetic")).toContain("disabled");
  });

  it("shows only-packages exclusions", () => {
    const result = run(["package", "list", "--only-packages", "@shortcircuit/gates"]);
    expect(result.code).toBe(0);
    expect(packageRow(result.stdout, "@shortcircuit/gates")).toContain("enabled");
    expect(packageRow(result.stdout, "@shortcircuit/arithmetic")).toContain("disabled");
  });

  it("shows bundled packages as disabled with --no-default-packages", () => {
    const result = run(["package", "list", "--no-default-packages"]);
    expect(result.code).toBe(0);
    expect(packageRow(result.stdout, "@shortcircuit/gates")).toContain("disabled");
    expect(result.stdout).toContain("0 enabled");
  });

  it("lists a local package with its origin", () => {
    const root = tempDir();
    writeDoublePackage(root);
    const result = run(["package", "list", "--package", root]);
    expect(result.code).toBe(0);
    const row = packageRow(result.stdout, "@test/double");
    expect(row).toContain("enabled");
    expect(row).toContain(root);
  });

  it("can disable a local package", () => {
    const root = tempDir();
    writeDoublePackage(root);
    const result = run([
      "package",
      "list",
      "--package",
      root,
      "--disable-package",
      "@test/double",
    ]);
    expect(result.code).toBe(0);
    expect(packageRow(result.stdout, "@test/double")).toContain("disabled");
  });

  it("prints package list JSON", () => {
    const root = tempDir();
    writeDoublePackage(root);
    const result = run([
      "package",
      "list",
      "--json",
      "--package",
      root,
      "--disable-package",
      "@shortcircuit/arithmetic",
    ]);
    expect(result.code).toBe(0);
    const data = JSON.parse(result.stdout) as {
      includeDefaultPackages: boolean;
      packages: Array<{ name: string; enabled: boolean; origin: string }>;
    };
    expect(data.includeDefaultPackages).toBe(true);
    expect(
      data.packages.find((pkg) => pkg.name === "@shortcircuit/arithmetic")?.enabled,
    ).toBe(false);
    expect(data.packages.find((pkg) => pkg.name === "@test/double")).toMatchObject({
      enabled: true,
      origin: root,
    });
  });

  it("warns about unknown only-packages names", () => {
    const result = run(["package", "list", "--only-packages", "@missing/pkg"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("warning");
    expect(result.stderr).toContain("@missing/pkg");
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
