/**
 * Public, serializable types shared by the LogicFlow engine and its hosts.
 *
 * These types intentionally contain no parser or runtime internals. The IR is
 * the contract that lets Short Circuit's UI (or another language's tooling)
 * execute and inspect a compiled circuit without understanding the source
 * syntax.
 */

import { LANGUAGE_VERSION } from "./version";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  /** Stable diagnostic identifier, for example E201. */
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  line: number;
  column: number;
  length?: number;
  hint?: string;
  /** A name the diagnostic believes the author meant. */
  suggestion?: string;
  /** Plain-language headline and explanation for people new to the language. */
  plain?: {
    headline: string;
    detail: string;
    fix?: {
      label: string;
      text: string;
      line: number;
      column: number;
      length: number;
    };
  };
  related?: Array<{
    message: string;
    line: number;
    column: number;
  }>;
}

export interface CompileOptions {
  /** Maximum number of graph nodes across the compiled program. */
  maxNodes?: number;
  /** Maximum nested circuit instantiation depth. */
  maxDepth?: number;
  /** Maximum number of circuit instances expanded in one top-level circuit. */
  maxInstances?: number;
  /** Maximum signal width, in bits. */
  maxWidth?: number;
  /** Stop collecting diagnostics after this many entries. */
  maxDiagnostics?: number;
  /**
   * Additional package manifests to make available to the compiler. The
   * default package snapshot is included unless disabled below. Availability
   * does not activate a package; source code still needs an IMPORT for it.
   */
  packages?: import("./packages").PackageBundle | import("./packages").PackageManifest[];
  /**
   * Omit the bundled package snapshot. This is a host option for compiling
   * against an explicit package bundle; it does not disable imports in source.
   */
  disableDefaultPackages?: boolean;
}

export interface CircuitInput {
  name: string;
  width: number;
  line: number;
  column: number;
}

export interface CircuitOutput {
  /** Human-facing output name, preserving a dotted source path when present. */
  name: string;
  /** Last path segment, useful for ports of nested circuit instances. */
  portName: string;
  node: string;
  width: number;
  line: number;
  column: number;
}

export interface CircuitState {
  name: string;
  node: string;
  width: number;
  /** Initial value as a zero-padded binary string. */
  init: string;
  line: number;
  column: number;
}

export type NodeKind = "input" | "constant" | "state" | "operation";

export interface CircuitNode {
  id: string;
  kind: NodeKind;
  /** Primitive operation name for operation nodes, e.g. NAND, CONCAT, SLICE. */
  op?: string;
  width: number;
  /** Short display label, usually the assigned signal name. */
  label: string;
  /** Local instantiation path. Empty for the top-level circuit. */
  scope: string[];
  /** Node IDs consumed by this node, in argument order. */
  operands: string[];
  /** Constant/initializer value for constants and state nodes. */
  value?: string;
  /** Source input name for input nodes. */
  inputName?: string;
  /** Compile-time operation parameters (slice bounds, gate arity, etc.). */
  params?: Record<string, string | number | boolean>;
  line: number;
  column: number;
}

export type ClockEdge = "rising" | "falling";

export interface ClockEvent {
  id: string;
  edge: ClockEdge;
  /** Node whose value is observed for transitions. */
  clock: string;
  scope: string[];
  updates: Array<{
    state: string;
    /** Combinational node evaluated against the pre-edge state. */
    value: string;
  }>;
  line: number;
  column: number;
}

export interface CircuitIR {
  name: string;
  line: number;
  inputs: CircuitInput[];
  outputs: CircuitOutput[];
  states: CircuitState[];
  nodes: CircuitNode[];
  events: ClockEvent[];
  sequential: boolean;
  stats: {
    nodes: number;
    states: number;
    events: number;
    maxDepth: number;
    maxWidth: number;
  };
}

export interface TestInputIR {
  name: string;
  width: number;
  /** Zero-padded binary value. */
  value: string;
  line: number;
  column: number;
}

export interface TestExpectationIR extends TestInputIR {
  actualName: string;
}

export interface TestCaseIR {
  label: string;
  line: number;
  /** Flat view of every input used in the case. */
  inputs: TestInputIR[];
  /** Flat view of every expectation in the case. */
  expectations: TestExpectationIR[];
  /** Ordered program, including STEP and CYCLE blocks. */
  program: TestInstructionIR[];
}

/** One statement in a test program. */
export type TestInstructionIR =
  | TestInputInstruction
  | TestExpectInstruction
  | TestLoadInstruction
  | TestStepInstruction
  | TestCycleInstruction;

export interface TestInputInstruction {
  kind: "input";
  name: string;
  width: number;
  value: string;
  line: number;
  column: number;
}

export interface TestExpectInstruction {
  kind: "expect";
  name: string;
  /** Output name or state name the value is read from. */
  actualName: string;
  target: "output" | "state";
  width: number;
  value: string;
  line: number;
  column: number;
}

export interface TestLoadInstruction {
  kind: "load";
  name: string;
  width: number;
  value: string;
  line: number;
  column: number;
}

export interface TestStepInstruction {
  kind: "step";
  statements: TestInstructionIR[];
  line: number;
  column: number;
}

export interface TestCycleInstruction {
  kind: "cycle";
  clock: string;
  count: number;
  line: number;
  column: number;
}

export interface TestSuiteIR {
  name: string;
  circuit: string;
  line: number;
  cases: TestCaseIR[];
  runnable: boolean;
  reason?: string;
}

export interface ProgramIR {
  schema: "shortcircuit.ir/v1";
  language: typeof LANGUAGE_VERSION;
  circuits: CircuitIR[];
  tests: TestSuiteIR[];
}

export interface CompileResult {
  ok: boolean;
  source: string;
  diagnostics: Diagnostic[];
  circuits: CircuitIR[];
  tests: TestSuiteIR[];
  ir: ProgramIR | null;
  elapsedMs: number;
}

export interface SignalSnapshot {
  width: number;
  /** Zero-padded binary representation. */
  binary: string;
  /** Decimal representation as a string, safe for arbitrary bus widths. */
  decimal: string;
}

export interface SimulationSnapshot {
  inputs: Record<string, SignalSnapshot>;
  outputs: Record<string, SignalSnapshot>;
  states: Record<string, SignalSnapshot>;
  nodes: Record<string, string>;
  clockValues: Record<string, string>;
  /** Events that fired on the most recent input mutation. */
  firedEvents: Array<{ edge: ClockEdge; clock: string; scope: string[] }>;
  /**
   * Present when the initial all-zero input state could not be fully
   * evaluated. The simulator remains usable so the host can correct inputs.
   */
  runtimeError?: { code: string; message: string };
}

export interface TestRowResult {
  kind: "input" | "expect";
  name: string;
  expected?: string;
  actual?: string;
  width: number;
  pass?: boolean;
  line: number;
  /** Simulation step the row was recorded at, when the case is sequential. */
  step?: number;
}

export interface TestCaseResult {
  label: string;
  line: number;
  pass: boolean;
  rows: TestRowResult[];
  error?: string;
  /** Step the case stopped at, when it failed. */
  step?: number;
}

export interface TestSuiteResult {
  name: string;
  circuit: string;
  pass: boolean;
  runnable: boolean;
  reason?: string;
  line: number;
  cases: TestCaseResult[];
}

export interface TestRunResult {
  ok: boolean;
  suites: TestSuiteResult[];
  passed: number;
  failed: number;
  unsupported: number;
  elapsedMs: number;
}

export interface TruthTable {
  circuit: string;
  inputBits: number;
  inputs: Array<{ name: string; width: number }>;
  outputs: Array<{ name: string; width: number }>;
  rows: Array<{
    input: Record<string, string>;
    output: Record<string, string>;
  }>;
  truncated: boolean;
  reason?: string;
}

export interface FormatResult {
  source: string;
  changed: boolean;
}
