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
      `IMPORT "@test/double-not"
CIRCUIT Wire
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

  it("reserves an imported package macro name but not an unimported one", () => {
    const allowed = compile(`CIRCUIT AND
INPUT a
OUTPUT a
END`);
    expect(allowed.diagnostics.some((entry) => entry.code === "E200")).toBe(false);

    const reserved = compile(`IMPORT "@shortcircuit/gates"
CIRCUIT AND
INPUT a
OUTPUT a
END`);
    expect(reserved.diagnostics.some((entry) => entry.code === "E200")).toBe(true);
  });

  it("reserves an imported package circuit name but not an unimported one", () => {
    const allowed = compile(`CIRCUIT ADD4
INPUT a
OUTPUT a
END`);
    expect(allowed.diagnostics.some((entry) => entry.code === "E200")).toBe(false);

    const reserved = compile(`IMPORT "@shortcircuit/arithmetic"
CIRCUIT ADD4
INPUT a
OUTPUT a
END`);
    expect(reserved.diagnostics.some((entry) => entry.code === "E200")).toBe(true);
  });

  it("does not expose package gates without an import", () => {
    const result = compile(
      `CIRCUIT NoPackages
INPUT a
INPUT b
y = AND(a, b)
OUTPUT y
END`,
    );
    expect(result.diagnostics.some((entry) => entry.code === "E210")).toBe(true);
  });

  it("keeps package circuits internal to the result", () => {
    const result = compile(`IMPORT "@shortcircuit/arithmetic"
CIRCUIT Use
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

  it("keeps macros with the same name in separate package namespaces", () => {
    const manifest = (name: string, body: string): PackageManifest => ({
      schema: "shortcircuit.package/v1",
      name,
      version: "0.1.0",
      exports: [
        {
          kind: "macro",
          name: "AND",
          source: "macros/and/macro.lf",
          sourceText: `MACRO AND(a, b)\n  BODY ${body}\nEND\n`,
        },
      ],
    });
    const bundle: PackageBundle = {
      schema: "shortcircuit.packages/v1",
      packages: [
        manifest("@test/and-one", "NAND(a, b)"),
        manifest("@test/and-two", "NAND(NAND(a, b), NAND(a, b))"),
      ],
    };
    const result = compile(
      `IMPORT "@test/and-one" AS One
IMPORT "@test/and-two" AS Two
CIRCUIT Both
INPUT a
INPUT b
y = One.AND(a, b)
z = Two.AND(a, b)
OUTPUT y
OUTPUT z
END`,
      { disableDefaultPackages: true, packages: bundle },
    );
    expect(result.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
    const circuit = result.circuits[0]!;
    const allOnes = new Simulator(circuit).setInputs({ a: "1", b: "1" });
    expect(allOnes.outputs.y?.binary).toBe("0");
    expect(allOnes.outputs.z?.binary).toBe("1");
  });

  it("resolves a package's own helper before another package's macro with the same name", () => {
    const bundle: PackageBundle = {
      schema: "shortcircuit.packages/v1",
      packages: [
        {
          schema: "shortcircuit.package/v1",
          name: "@test/other",
          version: "0.1.0",
          exports: [
            {
              kind: "macro",
              name: "AND",
              source: "macros/and/macro.lf",
              sourceText: "MACRO AND(a, b)\n  BODY NAND(NAND(a, b), NAND(a, b))\nEND\n",
            },
          ],
        },
        {
          schema: "shortcircuit.package/v1",
          name: "@test/outer",
          version: "0.1.0",
          exports: [
            {
              kind: "macro",
              name: "OUTER",
              source: "macros/outer/macro.lf",
              sourceText:
                "MACRO AND(a, b)\n  BODY NAND(a, b)\nEND\n" +
                "MACRO OUTER(a, b)\n  BODY AND(a, b)\nEND\n",
            },
          ],
        },
      ],
    };
    const result = compile(
      `IMPORT "@test/other"
IMPORT "@test/outer" AS Outer
CIRCUIT Local
INPUT a
INPUT b
y = Outer.OUTER(a, b)
OUTPUT y
END`,
      { disableDefaultPackages: true, packages: bundle },
    );
    expect(result.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
    const output = new Simulator(result.circuits[0]!).setInputs({ a: "1", b: "1" });
    expect(output.outputs.y?.binary).toBe("0");
  });

  it("reports an ambiguous unqualified macro instead of picking a package", () => {
    const manifest = (name: string): PackageManifest => ({
      schema: "shortcircuit.package/v1",
      name,
      version: "0.1.0",
      exports: [
        {
          kind: "macro",
          name: "AND",
          source: "macros/and/macro.lf",
          sourceText: "MACRO AND(a, b)\n  BODY NAND(a, b)\nEND\n",
        },
      ],
    });
    const result = compile(
      `IMPORT "@test/and-one"
IMPORT "@test/and-two"
CIRCUIT Both
INPUT a
INPUT b
y = AND(a, b)
OUTPUT y
END`,
      {
        disableDefaultPackages: true,
        packages: {
          schema: "shortcircuit.packages/v1",
          packages: [manifest("@test/and-one"), manifest("@test/and-two")],
        },
      },
    );
    const ambiguous = result.diagnostics.find((entry) => entry.code === "E210");
    expect(ambiguous?.message).toContain("more than one imported package");
    expect(ambiguous?.message).toContain("@test/and-one");
    expect(ambiguous?.message).toContain("@test/and-two");
    expect(ambiguous?.hint).toContain("Alias.AND(...)");
  });

  it("reports an import for a package that is not loaded", () => {
    const missing = compile(`IMPORT "@missing/package"
CIRCUIT Empty
END`);
    expect(missing.diagnostics.some((entry) => entry.code === "E602")).toBe(true);

    const notLoaded = compile(
      `IMPORT "@shortcircuit/gates"
CIRCUIT Empty
END`,
      { disableDefaultPackages: true },
    );
    expect(notLoaded.diagnostics.some((entry) => entry.code === "E602")).toBe(true);
  });

  it("only makes imported package exports available", () => {
    const unimported = compile(
      `CIRCUIT NoGates
INPUT a
INPUT b
y = AND(a, b)
OUTPUT y
END`,
    );
    expect(unimported.diagnostics.some((entry) => entry.code === "E210")).toBe(true);

    const imported = compile(
      `IMPORT "@shortcircuit/gates"
CIRCUIT WithGates
INPUT a
INPUT b
y = AND(a, b)
OUTPUT y
END`,
    );
    expect(imported.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
  });

  it("requires an alias to be used when the import has one", () => {
    const result = compile(
      `IMPORT "@shortcircuit/gates" AS Gates
CIRCUIT AliasOnly
INPUT a
INPUT b
y = AND(a, b)
OUTPUT y
END`,
    );
    expect(result.diagnostics.some((entry) => entry.code === "E210")).toBe(true);
  });

  it("does not load exports from an unimported package", () => {
    const result = compile(
      `IMPORT "@shortcircuit/selection"
CIRCUIT Choose
INPUT low
INPUT high
INPUT select
y = MUX(low, high, select)
OUTPUT y
END`,
    );
    expect(result.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);

    const arithmetic = compile(
      `IMPORT "@shortcircuit/selection"
CIRCUIT Add
INPUT a : BUS(4)
INPUT b : BUS(4)
sum = ADD4(a, b, 0)
OUTPUT sum.sum
END`,
    );
    expect(arithmetic.diagnostics.some((entry) => entry.code === "E210")).toBe(true);
  });

  it("expands the package MUX and broadcasts its select bit", () => {
    const result = compile(`IMPORT "@shortcircuit/selection"
CIRCUIT Choose
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

  it("compares every pair of values with the comparison package", () => {
    for (const [exportName, width] of [
      ["COMPARE1", 1],
      ["COMPARE2", 2],
      ["COMPARE4", 4],
      ["COMPARE8", 8],
    ] as const) {
      const result = compile(`IMPORT "@shortcircuit/comparison"
CIRCUIT Check
INPUT a : BUS(${width})
INPUT b : BUS(${width})
compared = ${exportName}(a, b)
OUTPUT compared.eq
OUTPUT compared.lt
OUTPUT compared.gt
END`);
      expect(result.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
      const simulator = new Simulator(result.circuits[0]!);
      const limit = 1 << width;
      const failures: string[] = [];
      for (let x = 0; x < limit; x++) {
        for (let y = 0; y < limit; y++) {
          const snapshot = simulator.setInputs({
            a: x.toString(2).padStart(width, "0"),
            b: y.toString(2).padStart(width, "0"),
          });
          const flags = ["eq", "lt", "gt"].map(
            (name) => snapshot.outputs[`compared.${name}`]?.binary === "1",
          );
          const wanted = [x === y, x < y, x > y];
          if (flags.some((flag, index) => flag !== wanted[index])) {
            failures.push(`${exportName}: a=${x} b=${y}`);
          }
          // Exactly one of eq, lt and gt must be high.
          if (flags.filter(Boolean).length !== 1) {
            failures.push(`${exportName}: a=${x} b=${y} set ${flags.join(",")}`);
          }
        }
      }
      expect(failures).toEqual([]);
    }
  }, 120000);

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
