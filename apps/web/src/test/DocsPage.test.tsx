import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  BUILTINS,
  DEFAULT_PACKAGE_CIRCUITS,
  DEFAULT_PACKAGE_MACROS,
} from "@shortcircuit/engine";
import { DocsPage } from "../pages/DocsPage";

describe("documentation page", () => {
  it("documents every built-in with arguments and an example", () => {
    render(<DocsPage onBack={() => {}} />);

    for (const spec of BUILTINS) {
      const entry = document.getElementById(`fn-${spec.name.toLowerCase()}`);
      expect(entry, spec.name).not.toBeNull();
      const text = entry?.textContent ?? "";
      expect(text, spec.name).toContain(spec.signature);
      expect(text, spec.name).toContain(spec.example.call);
      expect(text, spec.name).toContain(spec.example.result);
      for (const arg of spec.args) {
        expect(text, `${spec.name}.${arg.name}`).toContain(arg.name);
      }
    }
  });

  it("documents the bundled gates and circuits", () => {
    const { container } = render(<DocsPage onBack={() => {}} />);
    const defaults = container.querySelector(".docs-defaults");
    const text = defaults?.textContent ?? "";
    for (const group of [
      "Basic Logic Gates",
      "Universal Logic Gates",
      "Exclusive Gates",
      "Arithmetic Circuits",
      "Comparison Circuits",
    ]) {
      expect(text, group).toContain(group);
    }
    for (const name of [
      "AND",
      "OR",
      "NOT",
      "BUFFER",
      "NAND",
      "NOR",
      "XOR",
      "XNOR",
      "HALF_ADDER",
      "FULL_ADDER",
      "COMPARE1",
      "COMPARE2",
      "COMPARE4",
      "COMPARE8",
    ]) {
      expect(text, name).toContain(name);
    }
  });

  it("documents every default package macro", () => {
    render(<DocsPage onBack={() => {}} />);
    for (const macro of DEFAULT_PACKAGE_MACROS) {
      const entry = document.getElementById(`fn-${macro.name.toLowerCase()}`);
      expect(entry, macro.name).not.toBeNull();
      const text = entry?.textContent ?? "";
      expect(text, macro.name).toContain(macro.signature);
      expect(text, macro.name).toContain(macro.summary ?? "");
      for (const arg of macro.args) {
        expect(text, `${macro.name}.${arg}`).toContain(arg);
      }
    }
  });

  it("documents the circuit-shaped components", () => {
    render(<DocsPage onBack={() => {}} />);
    for (const { circuit } of DEFAULT_PACKAGE_CIRCUITS) {
      const entry = document.getElementById(`fn-${circuit.name.toLowerCase()}`);
      expect(entry, circuit.name).not.toBeNull();
      const text = entry?.textContent ?? "";
      expect(text, circuit.name).toContain(circuit.name);
      for (const port of circuit.ports?.inputs ?? []) {
        expect(text, `${circuit.name}.${port.name}`).toContain(port.name);
      }
    }
  });

  it("highlights the code samples", () => {
    const { container } = render(<DocsPage onBack={() => {}} />);
    expect(container.querySelectorAll(".tok-keyword").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".tok-function").length).toBeGreaterThan(0);
  });

  it("returns to the studio when the back button is used", () => {
    const onBack = vi.fn();
    render(<DocsPage onBack={onBack} />);
    const button = screen.getAllByRole("button", { name: /back to studio/i })[0]!;
    button.click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("explains the clocked test statements", () => {
    render(<DocsPage onBack={() => {}} />);
    const section = document.getElementById("testing");
    const text = section?.textContent ?? "";
    expect(text).toContain("STEP");
    expect(text).toContain("CYCLE");
    expect(text).toContain("LOAD");
  });

  it("lists the snippet library", () => {
    render(<DocsPage onBack={() => {}} />);
    const section = document.getElementById("snippets");
    const snippets = within(section as HTMLElement).getAllByRole("article");
    expect(snippets.length).toBeGreaterThan(10);
  });
});
