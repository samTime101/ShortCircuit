import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadLocalPackages } from "../src/packages";
import { normalizePackageFile } from "../src/registry";
import {
  cleanupTempDirs,
  tempDir,
  writeCircuitPackage,
  writeDoublePackage,
  writeText,
} from "./helpers";

afterEach(cleanupTempDirs);

describe("local package loading", () => {
  it("inlines macro source, docs, and package tests", () => {
    const root = tempDir();
    writeDoublePackage(root, { docs: true, tests: true });

    const loaded = loadLocalPackages([root]);
    const manifest = loaded.bundle.packages[0]!;
    const exported = manifest.exports[0]!;

    expect(loaded.bundle.schema).toBe("shortcircuit.packages/v1");
    expect(manifest.name).toBe("@test/double");
    expect(manifest.testText).toContain("DOUBLE_TEST");
    expect(exported.kind).toBe("macro");
    if (exported.kind !== "macro") throw new Error("expected a macro export");
    expect(exported.sourceText).toContain("MACRO TWICE");
    expect(exported.docsText).toContain("# TWICE");
    expect(loaded.origins.get("@test/double")).toBe(root);
  });

  it("inlines circuit source, docs, and per-circuit tests", () => {
    const root = tempDir();
    writeCircuitPackage(root);

    const manifest = loadLocalPackages([root]).bundle.packages[0]!;
    const exported = manifest.exports[0]!;

    expect(manifest.name).toBe("@test/local-buffer");
    expect(exported.kind).toBe("circuit");
    if (exported.kind !== "circuit") throw new Error("expected a circuit export");
    expect(exported.sourceText).toContain("CIRCUIT LOCAL_BUFFER");
    expect(exported.docsText).toContain("# LOCAL_BUFFER");
    expect(exported.testText).toContain("LOCAL_BUFFER_TEST");
  });

  it("accepts a path to manifest.json", () => {
    const root = tempDir();
    writeDoublePackage(root);

    const loaded = loadLocalPackages([join(root, "manifest.json")]);

    expect(loaded.bundle.packages[0]!.name).toBe("@test/double");
    expect(loaded.origins.get("@test/double")).toBe(root);
  });

  it("does not require package.json", () => {
    const root = tempDir();
    writeDoublePackage(root, { writePackageJson: false });

    const loaded = loadLocalPackages([root]);

    expect(loaded.bundle.packages[0]!.name).toBe("@test/double");
  });

  it("allows a local package named like a formerly bundled package", () => {
    const root = tempDir();
    writeDoublePackage(root, {
      name: "@shortcircuit/gates",
      packageName: "@shortcircuit/gates",
    });

    const loaded = loadLocalPackages([root]);

    expect(loaded.bundle.packages[0]!.name).toBe("@shortcircuit/gates");
  });

  it("rejects a package.json name mismatch", () => {
    const root = tempDir();
    writeDoublePackage(root, { packageName: "@test/other" });

    expect(() => loadLocalPackages([root])).toThrow(/does not match package.json name/);
  });

  it("rejects a package.json version mismatch", () => {
    const root = tempDir();
    writeDoublePackage(root, { packageVersion: "9.9.9" });

    expect(() => loadLocalPackages([root])).toThrow(/does not match package.json version/);
  });

  it("rejects an invalid package name and version", () => {
    const invalidName = tempDir();
    writeDoublePackage(invalidName, { name: "double", packageName: "double" });
    expect(() => loadLocalPackages([invalidName])).toThrow(/Invalid package name/);

    const invalidVersion = tempDir();
    writeDoublePackage(invalidVersion, { version: "one" });
    expect(() => loadLocalPackages([invalidVersion])).toThrow(/Invalid package version/);
  });

  it("rejects source paths that leave the package directory", () => {
    const root = tempDir();
    const outside = tempDir();
    writeText(outside, "outside.lf", "MACRO TWICE(x)\n  BODY NAND(x, x)\nEND\n");
    writeText(
      root,
      "manifest.json",
      `${JSON.stringify(
        {
          schema: "shortcircuit.package/v1",
          name: "@test/double",
          version: "0.1.0",
          exports: [{ kind: "macro", name: "TWICE", source: "../outside.lf" }],
        },
        null,
        2,
      )}\n`,
    );

    expect(() => loadLocalPackages([root])).toThrow(/must stay inside/);
  });

  it("rejects a missing export source", () => {
    const root = tempDir();
    writeDoublePackage(root);
    rmSync(join(root, "macros/twice/macro.lf"));

    expect(() => loadLocalPackages([root])).toThrow(/Could not read @test\/double source/);
  });

  it("rejects an export that is not declared in its source", () => {
    const root = tempDir();
    writeDoublePackage(root);
    writeText(root, "macros/twice/macro.lf", "MACRO OTHER(x)\n  BODY NAND(x, x)\nEND\n");

    expect(() => loadLocalPackages([root])).toThrow(/is not declared/);
  });

  it("rejects duplicate package names", () => {
    const first = tempDir();
    const second = tempDir();
    writeDoublePackage(first);
    writeDoublePackage(second);

    expect(() => loadLocalPackages([first, second])).toThrow(/defined by both/);
  });

  it("reports a missing package path and a directory without a manifest", () => {
    expect(() => loadLocalPackages([join(tempDir(), "missing")])).toThrow(/Could not find package/);
    expect(() => loadLocalPackages([tempDir()])).toThrow(/No manifest.json/);
  });
});

describe("registry package paths", () => {
  it("normalizes relative paths and rejects escapes or URLs", () => {
    expect(normalizePackageFile("./macros/twice/macro.lf")).toBe("macros/twice/macro.lf");
    expect(normalizePackageFile("macros\\twice\\macro.lf")).toBe("macros/twice/macro.lf");

    expect(() => normalizePackageFile("../outside.lf")).toThrow(/inside/);
    expect(() => normalizePackageFile("https://example.com/package.lf")).toThrow(/relative/);
    expect(() => normalizePackageFile("C:\\package.lf")).toThrow(/relative/);
    expect(() => normalizePackageFile("macros/twice.lf?raw")).toThrow(/relative/);
  });
});
