import { describe, expect, it } from "vitest";
import { highlightLogicFlow } from "../editor/logicFlowHighlight";

function kinds(code: string): string[] {
  return highlightLogicFlow(code).map((token) => token.kind);
}

describe("logic flow highlighting", () => {
  it("keeps every character of the source", () => {
    const code = `CIRCUIT HalfAdder\n  INPUT a\n  sum = XOR(a, b)  # add them\nEND`;
    const tokens = highlightLogicFlow(code);
    expect(tokens.map((token) => token.text).join("")).toBe(code);
  });

  it("classifies keywords, functions, numbers, and comments", () => {
    const code = "CIRCUIT X\n  sum = XOR(a, 0b1010) # note";
    const found = kinds(code);
    expect(found).toContain("keyword");
    expect(found).toContain("function");
    expect(found).toContain("number");
    expect(found).toContain("comment");
  });

  it("marks BUS as a type and strings as strings", () => {
    const found = kinds('INPUT data : BUS(8)\nCASE "one"');
    expect(found).toContain("type");
    expect(found).toContain("string");
  });

  it("keeps the new test keywords", () => {
    const found = kinds("STEP\n  INPUT clock = 1\nEND\nCYCLE clock 3\nLOAD q = 0");
    expect(found.filter((kind) => kind === "keyword").length).toBeGreaterThanOrEqual(3);
  });
});
