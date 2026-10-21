import { describe, expect, it } from "vitest";
import {
  builtinCard,
  keywordCard,
  packageCircuitCard,
  packageMacroCard,
  snippetCard,
} from "../editor/cards";

function text(card: HTMLElement | null): string {
  expect(card).not.toBeNull();
  return (card as HTMLElement).textContent ?? "";
}

describe("editor info cards", () => {
  it("shows the description, arguments, results and example of a package circuit", () => {
    const card = text(packageCircuitCard("FULL_ADDER"));

    expect(card).toContain("FULL_ADDER");
    expect(card).toContain("One-bit full adder built from two half adders and an OR gate.");
    expect(card).toContain("Signature");
    expect(card).toContain("FULL_ADDER(a, b, carry_in)");
    expect(card).toContain("Arguments");
    expect(card).toContain("carry_in (1 bit)");
    expect(card).toContain("Returns");
    expect(card).toContain("sum (1 bit)");
    expect(card).toContain("carry_out (1 bit)");
    expect(card).toContain("Example");
    expect(card).toContain("inst = FULL_ADDER(1, 1, 1)");
    expect(card).toContain("inst.sum = 1");
    expect(card).toContain("inst.carry_out = 1");
  });

  it("shows a worked example for every package circuit", () => {
    for (const name of ["HALF_ADDER", "FULL_ADDER", "ADD4", "ADD8"]) {
      const card = text(packageCircuitCard(name));
      expect(card, name).toContain("Example");
      expect(card, name).toContain(`inst = ${name}(`);
    }
  });

  it("shows the arguments, the result and an example for a package macro", () => {
    const card = text(packageMacroCard("XOR"));

    expect(card).toContain("XOR");
    expect(card).toContain("Bitwise XOR. Folds XOR2 across the inputs.");
    expect(card).toContain("Signature");
    expect(card).toContain("XOR(a, b, ...)");
    expect(card).toContain("Arguments");
    expect(card).toContain("Returns");
    expect(card).toContain("Result width = common input width");
    expect(card).toContain("Example");
    expect(card).toMatch(/y = XOR\(1, 0\)\s+→\s+1/);
  });

  it("shows a worked example for every package macro", () => {
    for (const name of ["NOT", "AND", "OR", "NOR", "XOR", "XNOR", "BUFFER", "MUX"]) {
      const card = text(packageMacroCard(name));
      expect(card, name).toContain("Example");
    }
  });

  it("shows the arguments and the result of a kernel operation", () => {
    const card = text(builtinCard("NAND"));

    expect(card).toContain("Inverse of multi-input AND.");
    expect(card).toContain("NAND(a, b, ...)");
    expect(card).toContain("a — First input.");
    expect(card).toContain("Result width = common input width");
    expect(card).toContain("result = NAND(1, 1)");
    expect(card).toContain("→ 0 — AND of two high bits is 1");
  });

  it("keeps the keyword and snippet cards", () => {
    expect(text(keywordCard("CIRCUIT"))).toContain("Starts a circuit block");
    expect(text(snippetCard("Half adder"))).toContain("CIRCUIT HalfAdder");
  });

  it("has no card for an unknown name", () => {
    expect(packageCircuitCard("NOPE")).toBeNull();
    expect(packageMacroCard("NOPE")).toBeNull();
    expect(builtinCard("NOPE")).toBeNull();
    expect(keywordCard("NOPE")).toBeNull();
  });
});
