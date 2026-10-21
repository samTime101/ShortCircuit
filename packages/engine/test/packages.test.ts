import { describe, expect, it } from "vitest";
import {
  DEFAULT_PACKAGE_BUNDLE,
  Simulator,
  compile,
  createPackageCatalog,
  parsePackageMacroSource,
  runPackageTests,
  type PackageBundle,
  type PackageManifest,
} from "../src/index";

function customBundle(manifest: PackageManifest): PackageBundle {
  return {
    schema: "shortcircuit.packages/v1",
    packages: [manifest],
  };
}

describe("package macro sources", () => {
  it("parses a body macro from a real .lf source", () => {
    const parsed = parsePackageMacroSource(`// Package source, not user source.
MACRO AND(a, b, ...)
  BODY NOT(NAND(a, b, ...))
END
`);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.declarations).toHaveLength(1);
    expect(parsed.declarations[0]).toMatchObject({
      name: "AND",
      args: ["a", "b"],
      variadic: true,
      body: "NOT(NAND(a, b, ...))",
      fold: null,
    });
  });

  it("parses a fold macro and allows multiple declarations in one file", () => {
    const parsed = parsePackageMacroSource(`MACRO XOR2(a, b)
  BODY NAND(NAND(a, NAND(a, b)), NAND(b, NAND(a, b)))
END

MACRO XOR(a, b, ...)
  FOLD XOR2
END
`);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.declarations).toHaveLength(2);
    expect(parsed.declarations[1]).toMatchObject({
      name: "XOR",
      args: ["a", "b"],
      variadic: true,
      body: null,
      fold: "XOR2",
    });
  });

  it("reports a missing END instead of accepting a partial macro", () => {
    const parsed = parsePackageMacroSource(`MACRO BROKEN(x)
  BODY NAND(x, x)
`);
    expect(parsed.diagnostics.some((entry) => entry.code === "E601")).toBe(true);
    expect(parsed.declarations).toEqual([]);
  });
});

describe("package catalog", () => {
  it("resolves macro signatures and arity from the source file", () => {
    const catalog = createPackageCatalog([DEFAULT_PACKAGE_BUNDLE]);
    const and = catalog.macros.get("AND");
    expect(and).toMatchObject({
      name: "AND",
      args: ["a", "b"],
      minArgs: 2,
      maxArgs: null,
      variadic: true,
      signature: "AND(a, b, ...)",
    });
    expect(and?.source).toBe("macros/and/macro.lf");
    expect(and?.sourceText).toContain("MACRO AND(a, b, ...)");
  });

  it("does not store macro bodies in the manifest", () => {
    const and = DEFAULT_PACKAGE_BUNDLE.packages[0]?.exports.find(
      (entry) => entry.kind === "macro" && entry.name === "AND",
    );
    expect(and).toBeDefined();
    expect("body" in and!).toBe(false);
    expect("fold" in and!).toBe(false);
    expect("args" in and!).toBe(false);
  });

  it("expands a host-provided macro loaded from package source", () => {
    const manifest: PackageManifest = {
      schema: "shortcircuit.package/v1",
      name: "@test/double-not",
      version: "0.1.0",
      exports: [
        {
          kind: "macro",
          name: "TWICE",
          source: "macros/twice/macro.lf",
          sourceText: "MACRO TWICE(x)\n  BODY NAND(NAND(x, x), NAND(x, x))\nEND\n",
          group: "Test",
          summary: "Double inversion.",
        },
      ],
    };
    const result = compile(
      `CIRCUIT Wire
INPUT a
y = TWICE(a)
OUTPUT y
END`,
      { disableDefaultPackages: true, packages: customBundle(manifest) },
    );
    expect(result.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
    const circuit = result.circuits[0]!;
    expect(circuit.nodes.every((node) => node.kind !== "operation" || node.op === "NAND")).toBe(true);
    expect(new Simulator(circuit).setInputs({ a: "0" }).outputs.y?.binary).toBe("0");
    expect(new Simulator(circuit).setInputs({ a: "1" }).outputs.y?.binary).toBe("1");
  });

  it("reserves package macro names as signal names", () => {
    const result = compile(`CIRCUIT Reserved
INPUT AND
OUTPUT AND
END`);
    expect(result.diagnostics.some((entry) => entry.code === "E200")).toBe(true);
  });

  it("reserves enabled package circuit names", () => {
    const result = compile(`CIRCUIT ADD4
INPUT a
OUTPUT a
END`);
    expect(result.diagnostics.some((entry) => entry.code === "E200")).toBe(true);

    const disabled = compile(
      `CIRCUIT ADD4
INPUT a
OUTPUT a
END`,
      { disabledPackages: ["@shortcircuit/arithmetic"] },
    );
    expect(disabled.diagnostics.some((entry) => entry.code === "E200")).toBe(false);
  });

  it("does not fall back to gate builtins when packages are disabled", () => {
    const result = compile(
      `CIRCUIT NoPackages
INPUT a
INPUT b
y = AND(a, b)
OUTPUT y
END`,
      { disableDefaultPackages: true },
    );
    expect(result.diagnostics.some((entry) => entry.code === "E210")).toBe(true);
  });

  it("keeps package circuits internal to the result", () => {
    const result = compile(`CIRCUIT Use
INPUT a
INPUT b
h = HALF_ADDER(a, b)
OUTPUT h.sum
OUTPUT h.carry
END`);
    expect(result.circuits.map((entry) => entry.name)).toEqual(["Use"]);
  });

  it("supports qualified imports for macros and circuits", () => {
    const result = compile(`IMPORT "@shortcircuit/gates" AS Gates
IMPORT "@shortcircuit/arithmetic" AS Arith

CIRCUIT Main
INPUT a
INPUT b
OUTPUT y

y = Gates.AND(a, b)
h = Arith.HALF_ADDER(a, b)
OUTPUT h.sum
END`);
    expect(result.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
    expect(result.circuits[0]?.outputs.map((entry) => entry.name)).toEqual(["y", "h.sum"]);
    const circuit = result.circuits[0]!;
    const simulator = new Simulator(circuit).setInputs({ a: "1", b: "1" });
    expect(simulator.outputs.y?.binary).toBe("1");
    expect(simulator.outputs["h.sum"]?.binary).toBe("0");
  });

  it("reports a missing or disabled import", () => {
    const missing = compile(`IMPORT "@missing/package"
CIRCUIT Empty
END`);
    expect(missing.diagnostics.some((entry) => entry.code === "E602")).toBe(true);

    const disabled = compile(
      `IMPORT "@shortcircuit/gates"
CIRCUIT Empty
END`,
      { disabledPackages: ["@shortcircuit/gates"] },
    );
    expect(disabled.diagnostics.some((entry) => entry.code === "E602")).toBe(true);
  });

  it("removes disabled package exports from compilation", () => {
    const result = compile(
      `CIRCUIT NoGates
INPUT a
INPUT b
y = AND(a, b)
OUTPUT y
END`,
      { disabledPackages: ["@shortcircuit/gates"] },
    );
    expect(result.diagnostics.some((entry) => entry.code === "E210")).toBe(true);
  });

  it("restricts the catalog to enabledPackages", () => {
    const result = compile(
      `CIRCUIT NoGates
INPUT a
INPUT b
y = AND(a, b)
OUTPUT y
END`,
      { enabledPackages: ["@shortcircuit/selection"] },
    );
    expect(result.diagnostics.some((entry) => entry.code === "E210")).toBe(true);

    const selectionOnly = compile(
      `CIRCUIT Choose
INPUT low
INPUT high
INPUT select
y = MUX(low, high, select)
OUTPUT y
END`,
      { enabledPackages: ["@shortcircuit/selection"] },
    );
    expect(selectionOnly.diagnostics.some((entry) => entry.code === "E210")).toBe(true);
  });

  it("expands the package MUX and broadcasts its select bit", () => {
    const result = compile(`CIRCUIT Choose
INPUT low : BUS(4)
INPUT high : BUS(4)
INPUT select
y = MUX(low, high, select)
OUTPUT y
END`);
    expect(result.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
    const circuit = result.circuits[0]!;
    expect(circuit.nodes.some((node) => node.op === "BROADCAST")).toBe(true);
    expect(circuit.nodes.every((node) => node.kind !== "operation" || node.op === "NAND" || node.op === "BROADCAST")).toBe(true);
    const simulator = new Simulator(circuit).setInputs({
      low: "0011",
      high: "1100",
      select: "1",
    });
    expect(simulator.outputs.y?.binary).toBe("1100");
  });

  it("runs every package test in the bundled snapshot", () => {
    const report = runPackageTests();
    expect(report.files.length).toBeGreaterThan(0);
    if (!report.ok) {
      const details = report.files
        .filter((file) => !file.ok)
        .map((file) => {
          const errors = file.diagnostics
            .filter((entry) => entry.severity === "error")
            .map((entry) => `${entry.code} ${entry.message}`)
            .join("; ");
          const failedCases = file.run?.suites
            .flatMap((suite) => suite.cases)
            .filter((testCase) => !testCase.pass)
            .map((testCase) => testCase.error ?? testCase.label)
            .join("; ");
          return `${file.packageName}${file.exportName ? `/${file.exportName}` : ""}: ${errors || failedCases || "unknown failure"}`;
        })
        .join("\n");
      throw new Error(details);
    }
    expect(report.passed).toBeGreaterThan(0);
  });
});
