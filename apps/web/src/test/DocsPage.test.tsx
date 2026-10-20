import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { BUILTINS, INTRINSIC_CIRCUITS } from "@shortcircuit/engine";
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

  it("documents the circuit-shaped components", () => {
    render(<DocsPage onBack={() => {}} />);
    for (const spec of INTRINSIC_CIRCUITS) {
      const entry = document.getElementById(`fn-${spec.name.toLowerCase()}`);
      expect(entry, spec.name).not.toBeNull();
      expect(entry?.textContent ?? "").toContain(spec.example.call);
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
