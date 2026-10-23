import { EditorState } from "@codemirror/state";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { describe, expect, it } from "vitest";
import { logicFlowCompletions } from "../editor/completions";

function complete(doc: string): CompletionResult | null {
  const state = EditorState.create({ doc });
  const context = {
    state,
    pos: doc.length,
    explicit: false,
    matchBefore: () => null,
  } as unknown as CompletionContext;
  return logicFlowCompletions(context);
}

function labels(result: CompletionResult | null): string[] {
  return (result?.options ?? []).map((option) => option.label);
}

describe("package aware completions", () => {
  it("hides package exports until their package is imported", () => {
    const result = complete("CIRCUIT Demo\n  INPUT a\n  INPUT b\n  y = ");
    const names = labels(result);

    expect(names).toContain("NAND");
    expect(names).not.toContain("XOR");
    expect(names).not.toContain("MUX");
  });

  it("shows unqualified exports from imported packages only", () => {
    const result = complete(
      'IMPORT "@shortcircuit/gates"\n\nCIRCUIT Demo\n  INPUT a\n  INPUT b\n  y = ',
    );
    const names = labels(result);

    expect(names).toContain("XOR");
    expect(names).not.toContain("MUX");
  });

  it("offers aliases and their qualified exports", () => {
    const normal = labels(
      complete(
        'IMPORT "@shortcircuit/selection" AS selection\n\nCIRCUIT Demo\n  y = ',
      ),
    );
    expect(normal).toContain("selection");
    expect(normal).not.toContain("MUX");

    const qualified = labels(
      complete(
        'IMPORT "@shortcircuit/selection" AS selection\n\nCIRCUIT Demo\n  y = selection.',
      ),
    );
    expect(qualified).toContain("MUX");
    expect(qualified).not.toContain("XOR");
  });
});
