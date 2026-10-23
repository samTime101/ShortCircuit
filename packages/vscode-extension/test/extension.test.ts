import { compileCore as compile } from "@shortcircuit/engine/core";
import { describe, it, expect } from "vitest";

describe("Short Circuit Engine Integration", () => {
  it("compiles a simple circuit", () => {
    const source = `CIRCUIT Test
  INPUT a
  OUTPUT a
END`;
    const result = compile(source, { disableDefaultPackages: true });
    expect(result.circuits).toHaveLength(1);
  });

  it("detects syntax errors", () => {
    const badSource = `CIRCUIT Bad
  INPUT a
  OUTPUT
END`;
    const result = compile(badSource, { disableDefaultPackages: true });
    expect(result.diagnostics.some(d => d.severity === "error")).toBe(true);
  });

  it("detects undefined identifiers", () => {
    const badSource = `CIRCUIT Bad
  INPUT a
  y = UNDEFINED(a)
  OUTPUT y
END`;
    const result = compile(badSource, { disableDefaultPackages: true });
    expect(result.diagnostics.some(d => d.severity === "error")).toBe(true);
  });
});

describe("Language Server Diagnostics Mapping", () => {
  it("converts engine diagnostics to LSP diagnostics correctly", () => {
    const source = `CIRCUIT TestCircuit
  INPUT a
  y = UNKNOWN(a)
  OUTPUT y
END`;
    const result = compile(source, { disableDefaultPackages: true });
    const errorDiag = result.diagnostics.find(d => d.severity === "error");
    expect(errorDiag).toBeDefined();
    if (errorDiag) {
      expect(errorDiag.line).toBeGreaterThan(0);
      expect(errorDiag.column).toBeGreaterThan(0);
      expect(errorDiag.message).toContain("UNKNOWN");
    }
  });
});