import { describe, expect, it } from "vitest";
import { createCompilerClient } from "../lib/compilerClient";

const SOURCE = `CIRCUIT Wire
  INPUT a
  OUTPUT b
  b = a
END`;

describe("compiler client", () => {
  it("compiles a source, falling back to the main thread when there is no worker", async () => {
    const client = createCompilerClient();
    try {
      const result = await client.compile(SOURCE);
      expect(result.ok).toBe(true);
      expect(result.circuits[0]?.name).toBe("Wire");
    } finally {
      client.dispose();
    }
  });

  it("reports diagnostics from a broken source", async () => {
    const client = createCompilerClient();
    try {
      const result = await client.compile("CIRCUIT Broken\nINPUT a\nx = AND(a, missing)\nEND");
      expect(result.ok).toBe(false);
      expect(result.diagnostics.some((item) => item.code === "E201")).toBe(true);
    } finally {
      client.dispose();
    }
  });
});
