import { describe, expect, it } from "vitest";
import { compileStudioSource } from "../src/studioCompute";

const SLICER = `
CIRCUIT SLICER
  INPUT data : BUS(8)
  sliced = SLICE(data, 7, 4)
  OUTPUT sliced
END
`;

describe("studio compile data", () => {
  it("changes the derived key when behavior changes without changing the graph", () => {
    const before = compileStudioSource("/tmp/slicer.lf", SLICER);
    const after = compileStudioSource(
      "/tmp/slicer.lf",
      SLICER.replace("SLICE(data, 7, 4)", "SLICE(data, 3, 0)"),
    );

    expect(before.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(after.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // The graph still has the same nodes, edges, inputs, and outputs.
    expect(after.structureKey).toBe(before.structureKey);
    // But truth tables, waveforms, and lowered IR must be recomputed.
    expect(after.derivedKey).not.toBe(before.derivedKey);
  });
});
