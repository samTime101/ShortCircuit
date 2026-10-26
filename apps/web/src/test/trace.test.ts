import { describe, expect, it } from "vitest";
import { compile } from "@shortcircuit/engine";
import {
  appendSample,
  appendSamples,
  sampleFromSnapshot,
  traceToJson,
  traceToVcd,
  TRACE_LIMIT,
} from "../lib/trace";
import { Simulator } from "@shortcircuit/engine";

const SOURCE = `IMPORT "@shortcircuit/arithmetic"

CIRCUIT Counter4
INPUT clock
STATE count : BUS(4) = 0000
incremented = ADD4(count, 0, 1)
ON RISING_EDGE(clock):
  count = incremented.sum
END
OUTPUT count
END`;

describe("trace", () => {
  it("records samples as the circuit runs", () => {
    const circuit = compile(SOURCE).circuits[0]!;
    const simulator = new Simulator(circuit);
    let trace = appendSample([], sampleFromSnapshot(simulator.snapshot(), "start"));
    const snapshot = simulator.setInput("clock", "1");
    trace = appendSample(trace, sampleFromSnapshot(snapshot, "clock"));
    expect(trace).toHaveLength(2);
    expect(trace[1]?.states.count).toBe("0001");
    expect(trace[1]?.events[0]?.edge).toBe("rising");
  });

  it("caps the history", () => {
    const sample = { label: "x", inputs: {}, outputs: {}, states: {}, events: [] };
    let trace = [] as ReturnType<typeof appendSample>;
    for (let index = 0; index < TRACE_LIMIT + 5; index += 1) trace = appendSample(trace, sample);
    expect(trace).toHaveLength(TRACE_LIMIT);
  });

  it("appends a clock pulse as one batch without exceeding the cap", () => {
    const sample = { label: "x", inputs: {}, outputs: {}, states: {}, events: [] };
    let trace = [] as ReturnType<typeof appendSamples>;
    for (let index = 0; index < TRACE_LIMIT - 1; index += 1) trace = appendSample(trace, sample);
    trace = appendSamples(trace, [sample, sample]);
    expect(trace).toHaveLength(TRACE_LIMIT);
  });

  it("writes a VCD that names every signal", () => {
    const circuit = compile(SOURCE).circuits[0]!;
    const simulator = new Simulator(circuit);
    const trace = [sampleFromSnapshot(simulator.snapshot(), "start")];
    const vcd = traceToVcd(circuit, trace);
    expect(vcd).toContain("$var wire 1");
    expect(vcd).toContain("clock");
    expect(vcd).toContain("$var wire 4");
    expect(vcd).toContain("count [3:0]");
    expect(vcd).toContain("#0");
  });

  it("writes the trace as JSON", () => {
    const json = JSON.parse(
      traceToJson([
        { label: "start", inputs: { clock: "0" }, outputs: { count: "0000" }, states: {}, events: [] },
      ]),
    );
    expect(json.schema).toBe("shortcircuit.trace/v1");
    expect(json.samples[0].inputs.clock).toBe("0");
  });
});
