import { describe, expect, it } from "vitest";
import { scanDocument } from "../editor/documentModel";

describe("document model", () => {
  it("finds signals that follow a line comment", () => {
    const model = scanDocument(`CIRCUIT Demo
// a note
INPUT a
INPUT b
END`);
    expect([...model.signals.keys()]).toEqual(["a", "b"]);
    expect(model.circuits).toEqual(["Demo"]);
  });

  it("ignores a trailing line comment", () => {
    const model = scanDocument(`CIRCUIT Demo
INPUT a // a trailing note
END`);
    expect([...model.signals.keys()]).toEqual(["a"]);
  });

  it("ignores signals that only appear inside a block comment", () => {
    const model = scanDocument(`CIRCUIT Demo
/* INPUT ghost
   OUTPUT ghost */
INPUT real
END`);
    expect([...model.signals.keys()]).toEqual(["real"]);
  });

  it("keeps a signal that follows a closed block comment", () => {
    const model = scanDocument(`CIRCUIT Demo
/* a note */ INPUT a
END`);
    expect([...model.signals.keys()]).toEqual(["a"]);
  });

  it("keeps comment markers inside strings as plain text", () => {
    const model = scanDocument(`CIRCUIT Demo
INPUT a
END
TEST Demo
CASE "a // b"
  INPUT a = 1
END`);
    expect([...model.signals.keys()]).toEqual(["a"]);
  });

  it("tracks unqualified imports and aliases", () => {
    const model = scanDocument(`IMPORT "@shortcircuit/gates"
IMPORT "@shortcircuit/selection" AS selection

CIRCUIT Demo
END`);

    expect([...model.unqualifiedPackages]).toEqual(["@shortcircuit/gates"]);
    expect([...model.aliases]).toEqual([["selection", "@shortcircuit/selection"]]);
    expect(model.imports.map((entry) => entry.packageName)).toEqual([
      "@shortcircuit/gates",
      "@shortcircuit/selection",
    ]);
  });
});
