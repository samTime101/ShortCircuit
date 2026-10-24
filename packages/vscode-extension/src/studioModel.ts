import {
  formatBinary,
  generateTruthTable,
  parseSimulationInput,
  runTests,
  Simulator,
  type CircuitIR,
  type CompileResult,
  type Diagnostic as EngineDiagnostic,
  type SimulationSnapshot,
} from "@shortcircuit/engine";
import type { GraphLayout } from "./graphLayout";

/** A circuit summary shown in the studio picker and graph toolbar. */
export interface StudioCircuitData {
  name: string;
  stats: {
    nodes: number;
    states: number;
    events: number;
    maxDepth: number;
    maxWidth: number;
  };
  sequential: boolean;
  inputs: Array<{ name: string; width: number }>;
  outputs: Array<{ name: string; width: number }>;
}

export interface StudioSignal {
  width: number;
  binary: string;
  decimal?: string;
}

export interface StudioSnapshot {
  inputs: Record<string, StudioSignal>;
  outputs: Record<string, StudioSignal>;
  nodes: Record<string, string>;
  states?: Record<string, StudioSignal>;
  clockValues?: Record<string, string>;
  runtimeError?: { code: string; message: string };
}

export interface StudioTruthRow {
  input: Record<string, string>;
  output: Record<string, string>;
}

export interface StudioTruthTable {
  circuit: string;
  inputBits?: number;
  inputs: Array<{ name: string; width: number }>;
  outputs: Array<{ name: string; width: number }>;
  rows: StudioTruthRow[];
  truncated?: boolean;
  reason?: string;
}

export interface StudioWaveformStep {
  label?: string;
  inputs: Record<string, string>;
  outputs: Record<string, string>;
}

export interface StudioWaveform {
  timeSteps: StudioWaveformStep[];
  inputNames: string[];
  outputNames: string[];
  error?: string;
}

export interface StudioTestRow {
  kind: "input" | "expect" | string;
  name: string;
  expected?: string;
  actual?: string;
  width?: number;
  pass?: boolean;
  step?: number;
}

export interface StudioTestCase {
  label: string;
  pass: boolean;
  line?: number;
  error?: string;
  step?: number;
  rows: StudioTestRow[];
}

export interface StudioTestSuite {
  name: string;
  pass: boolean;
  runnable?: boolean;
  reason?: string;
  line?: number;
  cases: StudioTestCase[];
}

export interface StudioTests {
  ok: boolean;
  passed: number;
  failed: number;
  unsupported?: number;
  elapsedMs?: number;
  suites: StudioTestSuite[];
}

/**
 * Runtime-only IR summary. The full IR is large, so it is sent only when the
 * IR tab asks for it. The studio needs events and states on every update.
 */
export interface StudioIrSummary {
  name: string;
  inputs: Array<{ name: string; width: number }>;
  outputs: Array<{ name: string; width: number }>;
  states: Array<{ name: string; node: string; width: number; init: string; line: number; column: number }>;
  events: Array<{
    id: string;
    edge: string;
    clock: string;
    /** Resolved input name for the clock node, when it is driven by an input. */
    clockName?: string;
    scope: string[];
    line: number;
    column: number;
  }>;
  sequential: boolean;
  stats: StudioCircuitData["stats"];
}

export interface StudioDiagnostic {
  message: string;
  severity: string;
  line: number;
  column: number;
}

export interface StudioModel {
  circuits: StudioCircuitData[];
  activeCircuit: string;
  inputs: Record<string, string>;
  snapshot: StudioSnapshot | null;
  layout: GraphLayout | null;
  /** Computed lazily when the tab is opened. */
  truthTable: StudioTruthTable | null;
  /** Computed lazily when the tab is opened. */
  waveform: StudioWaveform | null;
  tests: StudioTests | null;
  /** Compact runtime summary; the full IR arrives through {@link irText}. */
  ir: StudioIrSummary | null;
  /** Full lowered IR, computed lazily when the IR tab is opened. */
  irText?: string | null;
  diagnostics: StudioDiagnostic[];
  isSidebar?: boolean;
}

export interface StudioHtmlOptions {
  initialTab?: "circuit" | "truth" | "waveform" | "tests" | "ir";
  version?: string;
}

export type StudioDerivedKind = "truthTable" | "waveform" | "irText";

export function mapDiagnostics(
  diagnostics: EngineDiagnostic[],
): StudioDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    message: diagnostic.message,
    severity: diagnostic.severity,
    line: diagnostic.line ?? 1,
    column: diagnostic.column ?? 1,
  }));
}

/** Parses an input field and returns a zero-padded binary string. */
export function normalizeInputValue(raw: string, width: number): string {
  try {
    return formatBinary(parseSimulationInput(raw, width), width);
  } catch {
    return "0".repeat(width);
  }
}

/** Keeps every input at the exact width of its circuit port. */
export function normalizeInputs(
  circuit: Pick<CircuitIR, "inputs">,
  values: Record<string, string>,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const input of circuit.inputs) {
    normalized[input.name] = normalizeInputValue(values[input.name] ?? "0", input.width);
  }
  return normalized;
}

export function buildCircuitSummaries(
  circuits: CircuitIR[],
): StudioCircuitData[] {
  return circuits.map((circuit) => ({
    name: circuit.name,
    stats: circuit.stats,
    sequential: circuit.sequential,
    inputs: circuit.inputs.map((input) => ({ name: input.name, width: input.width })),
    outputs: circuit.outputs.map((output) => ({ name: output.name, width: output.width })),
  }));
}

export function buildIrSummary(circuit: CircuitIR): StudioIrSummary {
  const nodesById = new Map(circuit.nodes.map((node) => [node.id, node]));
  return {
    name: circuit.name,
    inputs: circuit.inputs.map((input) => ({ name: input.name, width: input.width })),
    outputs: circuit.outputs.map((output) => ({ name: output.name, width: output.width })),
    states: circuit.states.map((state) => ({
      name: state.name,
      node: state.node,
      width: state.width,
      init: state.init,
      line: state.line,
      column: state.column,
    })),
    events: circuit.events.map((event) => {
      const clockNode = nodesById.get(event.clock);
      return {
        id: event.id,
        edge: event.edge,
        clock: event.clock,
        clockName: clockNode?.inputName ?? event.clock,
        scope: event.scope,
        line: event.line,
        column: event.column,
      };
    }),
    sequential: circuit.sequential,
    stats: circuit.stats,
  };
}

export function buildIrText(circuit: CircuitIR): string {
  return JSON.stringify(circuit, null, 2);
}

export function buildTruthTable(circuit: CircuitIR): StudioTruthTable {
  const table = generateTruthTable(circuit);
  return {
    circuit: table.circuit,
    inputBits: table.inputBits,
    inputs: table.inputs,
    outputs: table.outputs,
    rows: table.rows,
    truncated: table.truncated,
    reason: table.reason,
  };
}

export function buildWaveform(circuit: CircuitIR): StudioWaveform {
  const inputNames = circuit.inputs.map((input) => input.name);
  const outputNames = circuit.outputs.map((output) => output.name);
  const totalBits = circuit.inputs.reduce((total, input) => total + input.width, 0);

  if (circuit.sequential) {
    return {
      timeSteps: [],
      inputNames,
      outputNames,
      error:
        "This circuit is sequential. Use the clock Step and Run controls to drive it; the waveform preview enumerates combinational inputs only.",
    };
  }

  if (totalBits > 6) {
    return {
      timeSteps: [],
      inputNames,
      outputNames,
      error: `Too many input bits (${totalBits}) for an automatic full-state waveform. The preview is capped at 6 bits.`,
    };
  }

  try {
    const simulator = new Simulator(circuit);
    const stepsCount = Math.min(2 ** totalBits, 16);
    const timeSteps: StudioWaveformStep[] = [];

    for (let index = 0; index < stepsCount; index += 1) {
      const inputValues: Record<string, bigint> = {};
      const inputBits: Record<string, string> = {};
      let offset = 0;
      for (const input of circuit.inputs) {
        const value = (BigInt(index) >> BigInt(offset)) & ((1n << BigInt(input.width)) - 1n);
        inputValues[input.name] = value;
        inputBits[input.name] = formatBinary(value, input.width);
        offset += input.width;
      }

      const snapshot = simulator.setInputs(inputValues);
      const outputs: Record<string, string> = {};
      for (const output of circuit.outputs) {
        outputs[output.name] = snapshot.outputs[output.name]?.binary ?? "0".repeat(output.width);
      }
      timeSteps.push({ inputs: inputBits, outputs });
    }

    return { timeSteps, inputNames, outputNames };
  } catch (error) {
    return {
      timeSteps: [],
      inputNames,
      outputNames,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Converts the compiled test suites into the view model. Tests are executed
 * here, not marked as passed by assumption.
 */
export function buildTestsModel(
  result: Pick<CompileResult, "tests" | "circuits">,
): StudioTests | null {
  if (result.tests.length === 0) return null;
  const run = runTests(result);
  return {
    ok: run.ok,
    passed: run.passed,
    failed: run.failed,
    unsupported: run.unsupported,
    elapsedMs: run.elapsedMs,
    suites: run.suites.map((suite) => ({
      name: suite.name,
      pass: suite.pass,
      runnable: suite.runnable,
      reason: suite.reason,
      line: suite.line,
      cases: suite.cases.map((testCase) => ({
        label: testCase.label,
        pass: testCase.pass,
        line: testCase.line,
        error: testCase.error,
        step: testCase.step,
        rows: testCase.rows.map((row) => ({
          kind: row.kind,
          name: row.name,
          expected: row.expected,
          actual: row.actual,
          width: row.width,
          pass: row.pass,
          step: row.step,
        })),
      })),
    })),
  };
}

export function snapshotToModel(snapshot: SimulationSnapshot): StudioSnapshot {
  return {
    inputs: snapshot.inputs,
    outputs: snapshot.outputs,
    nodes: snapshot.nodes,
    states: snapshot.states,
    clockValues: snapshot.clockValues,
    runtimeError: snapshot.runtimeError,
  };
}

/** Returns the TEST name on a line, matching the CodeLens parser. */
export function findTestAtPosition(
  source: string,
  line: number,
): string | null {
  const lines = source.split("\n");
  if (line < 0 || line >= lines.length) return null;
  const match = /^\s*TEST\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(lines[line] ?? "");
  return match ? match[1] : null;
}

/** The value of one bit in a binary string, with index 0 as the LSB. */
export function inputBitAt(value: string, width: number, bitIndex: number): string {
  const padded = value.padStart(width, "0");
  const character = padded[width - 1 - bitIndex];
  return character === "1" ? "1" : "0";
}
