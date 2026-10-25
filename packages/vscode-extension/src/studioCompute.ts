import * as path from "path";
import { createHash } from "node:crypto";
import {
  compile,
  parsePackageMacroSource,
  type CircuitIR,
  type TestSuiteIR,
} from "@shortcircuit/engine";
import { buildLayout, type GraphLayout } from "./graphLayout";
import {
  buildCircuitSummaries,
  buildIrSummary,
  buildIrText,
  buildTestsModel,
  buildTruthTable,
  buildWaveform,
  mapDiagnostics,
  type StudioCircuitData,
  type StudioDerivedKind,
  type StudioDiagnostic,
  type StudioIrSummary,
  type StudioTests,
  type StudioTruthTable,
  type StudioWaveform,
} from "./studioModel";
import {
  resolveWorkspaceContext,
  type ResolveWorkspaceOptions,
} from "./packageResolver";

/**
 * Everything the studio needs after a compile. This is deliberately a plain
 * data object so it can cross a worker-thread boundary.
 */
export interface StudioCompileData {
  macro: boolean;
  circuits: StudioCircuitData[];
  activeCircuitName: string;
  activeCircuit: CircuitIR | null;
  /** All compiled circuits, including imported package circuits (for tests). */
  allCircuits: CircuitIR[];
  /** Compiled test suites. Tests are executed lazily, never on every edit. */
  tests: TestSuiteIR[];
  layout: GraphLayout | null;
  ir: StudioIrSummary | null;
  diagnostics: StudioDiagnostic[];
  /**
   * Cheap identity for everything the webview draws structurally. When this
   * is unchanged, the webview can patch values instead of rebuilding its DOM.
   */
  structureKey: string;
  /**
   * Identity of the compiled circuit semantics. Derived views (truth table,
   * waveform, IR) stay valid only while this is unchanged; a constant or
   * operation parameter can change behavior without changing the graph layout.
   */
  derivedKey: string;
}

export type StudioDerivedPayload =
  | StudioTruthTable
  | StudioWaveform
  | StudioTests
  | string
  | null;

export interface CompileStudioOptions extends ResolveWorkspaceOptions {
  activeCircuitName?: string;
}

function isMacroFile(source: string, filePath: string): boolean {
  return (
    !/^\s*CIRCUIT\b/im.test(source) &&
    (/^\s*MACRO\b/im.test(source) ||
      filePath.replace(/\\/g, "/").includes("/macros/"))
  );
}

function emptyCompileData(diagnostics: StudioDiagnostic[]): StudioCompileData {
  return {
    macro: false,
    circuits: [],
    activeCircuitName: "",
    activeCircuit: null,
    allCircuits: [],
    tests: [],
    layout: null,
    ir: null,
    diagnostics,
    structureKey: "empty",
    derivedKey: "empty",
  };
}

function circuitFingerprint(circuit: CircuitIR): string {
  return createHash("sha1").update(JSON.stringify(circuit)).digest("hex");
}

function buildStructureKey(
  circuits: StudioCircuitData[],
  activeCircuitName: string,
  layout: GraphLayout | null,
  ir: StudioIrSummary | null,
): string {
  return createHash("sha1")
    .update(
      JSON.stringify({
        circuits,
        activeCircuit: activeCircuitName,
        layout,
        ir,
      }),
    )
    .digest("hex");
}

/**
 * Compiles a LogicFlow document into the data the studio renders.
 *
 * This function is intentionally free of VS Code APIs so the extension can run
 * it in a worker thread and keep the extension host responsive.
 */
export function compileStudioSource(
  filePath: string,
  source: string,
  options: CompileStudioOptions = {},
): StudioCompileData {
  const macro = isMacroFile(source, filePath);
  if (macro) {
    const fileName = filePath ? path.basename(filePath) : "package macro";
    const { declarations, diagnostics } = parsePackageMacroSource(source, fileName);
    const circuits = declarations.map((declaration) => ({
      name: declaration.name,
      stats: { nodes: 0, states: 0, events: 0, maxDepth: 0, maxWidth: 0 },
      sequential: false,
      inputs: declaration.args.map((argument) => ({ name: argument, width: 1 })),
      outputs: [{ name: "out", width: 1 }],
    }));
    const activeCircuitName = declarations[0]?.name ?? "";
    return {
      macro: true,
      circuits,
      activeCircuitName,
      activeCircuit: null,
      allCircuits: [],
      tests: [],
      layout: null,
      ir: null,
      diagnostics: mapDiagnostics(diagnostics),
      structureKey: buildStructureKey(circuits, activeCircuitName, null, null),
      derivedKey: "macro",
    };
  }

  const context = filePath
    ? resolveWorkspaceContext(filePath, source, { openSources: options.openSources })
    : null;
  const result = compile(source, {
    packages: context?.bundle,
    implicitImports: context?.implicitImports,
    maxDiagnostics: 100,
  });
  const diagnostics = mapDiagnostics(result.diagnostics);

  if (result.circuits.length === 0) {
    return {
      ...emptyCompileData(diagnostics),
      allCircuits: result.circuits,
      tests: result.tests,
    };
  }

  let circuit = result.circuits.find(
    (candidate) => candidate.name === options.activeCircuitName,
  );
  if (!circuit) circuit = result.circuits[0]!;

  let layout: GraphLayout | null = null;
  try {
    layout = buildLayout(circuit);
  } catch (error) {
    diagnostics.push({
      message: `Could not build the circuit graph: ${error instanceof Error ? error.message : String(error)}`,
      severity: "warning",
      line: 1,
      column: 1,
    });
  }

  const circuits = buildCircuitSummaries(result.circuits);
  const ir = buildIrSummary(circuit);
  return {
    macro: false,
    circuits,
    activeCircuitName: circuit.name,
    activeCircuit: circuit,
    allCircuits: result.circuits,
    tests: result.tests,
    layout,
    ir,
    diagnostics,
    structureKey: buildStructureKey(circuits, circuit.name, layout, ir),
    derivedKey: circuitFingerprint(circuit),
  };
}

/** Computes a lazily requested studio view (truth table, waveform, tests, IR). */
export function computeStudioDerived(
  kind: StudioDerivedKind,
  circuit: CircuitIR,
  allCircuits: CircuitIR[],
  tests: TestSuiteIR[],
): StudioDerivedPayload {
  if (kind === "truthTable") return buildTruthTable(circuit);
  if (kind === "waveform") return buildWaveform(circuit);
  if (kind === "tests") return buildTestsModel({ tests, circuits: allCircuits });
  return buildIrText(circuit);
}
