import { describe, expect, it } from "vitest";
import { highlightLogicFlow } from "../editor/logicFlowHighlight";

function kinds(code: string): string[] {
  return highlightLogicFlow(code).map((token) => token.kind);
}

describe("logic flow highlighting", () => {
  it("keeps every character of the source", () => {
    const code = `CIRCUIT HalfAdder\n  INPUT a\n  sum = XOR(a, b)  // add them\nEND`;
    const tokens = highlightLogicFlow(code);
    expect(tokens.map((token) => token.text).join("")).toBe(code);
  });

  it("classifies keywords, functions, numbers, and comments", () => {
    const code = "CIRCUIT X\n  sum = XOR(a, 0b1010) // note";
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

  it("marks a block comment as one comment token", () => {
    const code = "CIRCUIT X\n/* a block\n   comment */\nINPUT a";
    const tokens = highlightLogicFlow(code);
    expect(tokens.map((token) => token.text).join("")).toBe(code);
    const comments = tokens.filter((token) => token.kind === "comment");
    expect(comments).toHaveLength(1);
    expect(comments[0]?.text).toBe("/* a block\n   comment */");
  });

  it("keeps comment markers inside strings as strings", () => {
    const found = kinds('CASE "a // b"');
    expect(found).toContain("string");
    expect(found).not.toContain("comment");
  });

  it("no longer marks # as a comment", () => {
    const found = kinds("# not a comment");
    expect(found).not.toContain("comment");
  });
});
