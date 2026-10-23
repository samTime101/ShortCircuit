import { describe, expect, it } from "vitest";
import {
  BUILTINS,
  DEFAULT_PACKAGE_CATALOG,
  DEFAULT_PACKAGE_CIRCUITS,
  DEFAULT_PACKAGE_MACROS,
  GLOSSARY,
  LANGUAGE_SNIPPETS,
} from "@shortcircuit/engine";
import {
  buildDocsSearchIndex,
  functionAnchor,
  packageAnchor,
  searchDocs,
  termAnchor,
} from "../pages/docsSearch";

const SECTIONS = [
  { id: "syntax", label: "Syntax", group: "Language", keywords: ["comments", "circuit"] },
  { id: "packages", label: "Imports and packages", group: "Packages", keywords: ["import"] },
  {
    id: packageAnchor(DEFAULT_PACKAGE_CATALOG.packages[0]!.name),
    label: DEFAULT_PACKAGE_CATALOG.packages[0]!.name,
    group: "Packages",
  },
];

const ENTRIES = buildDocsSearchIndex({
  sections: SECTIONS,
  packages: DEFAULT_PACKAGE_CATALOG.packages,
  macros: DEFAULT_PACKAGE_MACROS,
  circuits: DEFAULT_PACKAGE_CIRCUITS,
  glossary: GLOSSARY,
  snippets: LANGUAGE_SNIPPETS,
  builtins: BUILTINS,
});

describe("documentation search", () => {
  it("indexes sections, packages, functions, terms, and snippets", () => {
    const kinds = new Set(ENTRIES.map((entry) => entry.kind));
    expect(kinds).toContain("section");
    expect(kinds).toContain("package");
    expect(kinds).toContain("macro");
    expect(kinds).toContain("circuit");
    expect(kinds).toContain("built-in");
    expect(kinds).toContain("glossary");
    expect(kinds).toContain("snippet");

    expect(ENTRIES.some((entry) => entry.id === functionAnchor("HALF_ADDER"))).toBe(true);
    expect(ENTRIES.some((entry) => entry.id === functionAnchor("NAND"))).toBe(true);
    expect(ENTRIES.some((entry) => entry.id === termAnchor("Bus"))).toBe(true);
    expect(ENTRIES.some((entry) => entry.id === packageAnchor("@shortcircuit/gates"))).toBe(true);
  });

  it("returns no results for an empty query", () => {
    expect(searchDocs(ENTRIES, "   ")).toEqual([]);
  });

  it("ranks an exact function name first", () => {
    const results = searchDocs(ENTRIES, "HALF_ADDER");
    expect(results[0]?.id).toBe(functionAnchor("HALF_ADDER"));
  });

  it("matches words across underscores", () => {
    const results = searchDocs(ENTRIES, "half adder");
    expect(results[0]?.id).toBe(functionAnchor("HALF_ADDER"));
  });

  it("finds package functions by package name", () => {
    const results = searchDocs(ENTRIES, "arithmetic");
    expect(results.some((entry) => entry.id === packageAnchor("@shortcircuit/arithmetic"))).toBe(
      true,
    );
    expect(results.some((entry) => entry.id === functionAnchor("ADD8"))).toBe(true);
  });

  it("finds sections and glossary terms", () => {
    expect(searchDocs(ENTRIES, "comments")[0]?.id).toBe("syntax");
    expect(searchDocs(ENTRIES, "bus")[0]?.id).toBe(termAnchor("Bus"));
  });

  it("respects the result limit", () => {
    expect(searchDocs(ENTRIES, "a", 3)).toHaveLength(3);
  });
});
