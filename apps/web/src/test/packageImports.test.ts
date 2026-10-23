import { describe, expect, it } from "vitest";
import {
  addPackageImport,
  hasPackageImport,
  readPackageImports,
  removePackageImport,
} from "../lib/packageImports";

describe("package imports", () => {
  it("reads unaliased and aliased imports", () => {
    const source = `// IMPORT "@ignored/line"
/* IMPORT "@ignored/block" */
IMPORT "@shortcircuit/gates"
IMPORT "@shortcircuit/selection" AS selection

CIRCUIT Demo
END`;

    expect(readPackageImports(source)).toEqual([
      { packageName: "@shortcircuit/gates", alias: null, line: 3 },
      { packageName: "@shortcircuit/selection", alias: "selection", line: 4 },
    ]);
    expect(hasPackageImport(source, "@shortcircuit/gates")).toBe(true);
    expect(hasPackageImport(source, "@shortcircuit/comparison")).toBe(false);
  });

  it("adds an import after leading comments and existing imports", () => {
    const source = `// A circuit note
IMPORT "@shortcircuit/gates"

CIRCUIT Demo
END`;

    expect(addPackageImport(source, "@shortcircuit/selection")).toBe(
      `// A circuit note
IMPORT "@shortcircuit/gates"
IMPORT "@shortcircuit/selection"

CIRCUIT Demo
END`,
    );
  });

  it("does not duplicate an existing aliased import", () => {
    const source = `IMPORT "@shortcircuit/gates" AS gates

CIRCUIT Demo
END`;

    expect(addPackageImport(source, "@shortcircuit/gates")).toBe(source);
  });

  it("adds an import to an empty source", () => {
    expect(addPackageImport("", "@shortcircuit/gates")).toBe(
      'IMPORT "@shortcircuit/gates"\n',
    );
  });

  it("removes every import for a package and keeps other lines", () => {
    const source = `// Keep this note
IMPORT "@shortcircuit/gates"
IMPORT "@shortcircuit/selection" AS selection

CIRCUIT Demo
END`;

    expect(removePackageImport(source, "@shortcircuit/gates")).toBe(
      `// Keep this note
IMPORT "@shortcircuit/selection" AS selection

CIRCUIT Demo
END`,
    );
    expect(removePackageImport(source, "@shortcircuit/comparison")).toBe(source);
  });
});
