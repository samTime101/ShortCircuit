import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  BUILTINS,
  DEFAULT_PACKAGE_CATALOG,
  DEFAULT_PACKAGE_CIRCUITS,
  DEFAULT_PACKAGE_MACROS,
} from "@shortcircuit/engine";
import { DocsPage } from "../pages/DocsPage";
import { packageAnchor } from "../pages/docsSearch";

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

  it("searches sections and package functions from the top bar", async () => {
    const user = userEvent.setup();
    render(<DocsPage onBack={() => {}} />);
    const search = screen.getByRole("combobox", { name: /search documentation/i });

    await user.type(search, "compare4");
    const list = await screen.findByRole("listbox", { name: /search results/i });
    expect(within(list).getByText("COMPARE4")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "syntax");
    const syntaxList = await screen.findByRole("listbox", { name: /search results/i });
    expect(within(syntaxList).getByText("Syntax")).toBeInTheDocument();
  });

  it("jumps to a search result with Enter", async () => {
    const user = userEvent.setup();
    render(<DocsPage onBack={() => {}} />);
    const search = screen.getByRole("combobox", { name: /search documentation/i });

    await user.type(search, "compare4");
    const list = await screen.findByRole("listbox", { name: /search results/i });
    expect(within(list).getByText("COMPARE4")).toBeInTheDocument();

    await user.keyboard("{Enter}");
    expect(screen.queryByRole("listbox", { name: /search results/i })).not.toBeInTheDocument();
    expect(search).toHaveValue("");
  });

  it("documents every package with its import and public functions", () => {
    render(<DocsPage onBack={() => {}} />);
    for (const manifest of DEFAULT_PACKAGE_CATALOG.packages) {
      const section = document.getElementById(packageAnchor(manifest.name));
      expect(section, manifest.name).not.toBeNull();
      const text = section?.textContent ?? "";
      expect(text, manifest.name).toContain(manifest.name);
      expect(text, manifest.name).toContain(`IMPORT "${manifest.name}"`);
      for (const entry of manifest.exports) {
        if (entry.kind === "macro" && entry.internal) continue;
        expect(text, `${manifest.name}.${entry.name}`).toContain(entry.name);
      }
    }
  });

  it("renders the package docs notes for a function", () => {
    render(<DocsPage onBack={() => {}} />);
    const halfAdder = document.getElementById("fn-half_adder");
    expect(halfAdder?.textContent).toContain("Adds two one-bit values.");
    expect(halfAdder?.querySelector(".docs-notes-table")).not.toBeNull();
  });
});
