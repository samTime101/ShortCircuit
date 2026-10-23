import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { logicFlowHover } from "../editor/hover";

function hoverText(source: string, word: string): string | null {
  const view = new EditorView({ state: EditorState.create({ doc: source }) });
  const pos = source.indexOf(word);
  try {
    const tooltip = logicFlowHover(view, pos + 1);
    return tooltip ? tooltip.create(view).dom.textContent : null;
  } finally {
    view.destroy();
  }
}

describe("package aware hover cards", () => {
  it("does not describe an unimported package export", () => {
    const source = `CIRCUIT Demo
  INPUT a
  INPUT b
  y = XOR(a, b)
  OUTPUT y
END`;

    expect(hoverText(source, "XOR")).toBeNull();
  });

  it("describes an export from an unqualified import", () => {
    const source = `IMPORT "@shortcircuit/gates"

CIRCUIT Demo
  INPUT a
  INPUT b
  y = XOR(a, b)
  OUTPUT y
END`;

    expect(hoverText(source, "XOR")).toContain("Bitwise XOR");
  });

  it("describes an export through an alias", () => {
    const source = `IMPORT "@shortcircuit/selection" AS selection

CIRCUIT Demo
  INPUT a
  INPUT b
  INPUT pick
  y = selection.MUX(a, b, pick)
  OUTPUT y
END`;

    expect(hoverText(source, "MUX")).toContain("Select");
    expect(hoverText(source, "selection")).toContain("@shortcircuit/selection");
  });
});
