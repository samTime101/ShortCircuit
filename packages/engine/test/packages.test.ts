import { describe, expect, it } from "vitest";
import {
  DEFAULT_PACKAGE_BUNDLE,
  Simulator,
  compile,
  createPackageCatalog,
  parsePackageMacroSource,
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
});
