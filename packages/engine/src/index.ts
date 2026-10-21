import { ProgramAnalyzer } from "./analyzer";
import { Parser } from "./parser";
import {
  createPackageCatalog,
  packageCircuitAsts,
  resolvePackageBundle,
  resolvePackageImports,
} from "./packages";
import type { CompileOptions, CompileResult, Diagnostic } from "./types";

export type {
  CircuitIR,
  CircuitInput,
  CircuitNode,
  CircuitOutput,
  CircuitState,
  ClockEdge,
  ClockEvent,
  CompileOptions,
  CompileResult,
  Diagnostic,
  DiagnosticSeverity,
  FormatResult,
  NodeKind,
  ProgramIR,
  SignalSnapshot,
  SimulationSnapshot,
  TestCaseIR,
  TestCaseResult,
  TestExpectationIR,
  TestInputIR,
  TestRowResult,
  TestRunResult,
  TestSuiteIR,
  TestSuiteResult,
  TruthTable,
} from "./types";
export type { BitValue } from "./values";
export { Simulator, SimulationError } from "./simulator";
export { runTests } from "./testing";
export { runPackageTests } from "./packageTests";
export type {
  PackageTestFileResult,
  PackageTestReport,
} from "./packageTests";
export { generateTruthTable, type TruthTableOptions } from "./truthTable";
export { formatSource } from "./formatter";
export {
  formatBinary,
  formatHex,
  parseLanguageLiteral,
  parseSimulationInput,
} from "./values";
export { BUILTINS, BUILTIN_BY_NAME } from "./builtins";
export type { BuiltinArgument, BuiltinExample, BuiltinSpec } from "./builtins";
export {
  DEFAULT_PACKAGE_BUNDLE,
  DEFAULT_PACKAGE_CATALOG,
  DEFAULT_PACKAGE_CIRCUITS,
  DEFAULT_PACKAGE_MACROS,
  createPackageCatalog,
  findPackageMacro,
  macroBodyForArity,
  parseMacroExpression,
  parsePackageMacroSource,
  resolvePackageBundle,
  resolvePackageImports,
} from "./packages";
export type {
  PackageBundle,
  PackageCatalog,
  PackageCircuitExport,
  PackageCircuitPort,
  PackageExport,
  PackageMacroExport,
  PackageManifest,
  ParsedPackageMacro,
  ResolvedPackageMacro,
  ImportResolution,
  ResolvedPackageImport,
} from "./packages";
export {
  packageWorkedExamples,
  type WorkedExample,
  type WorkedExamplePort,
} from "./packageExamples";
export { plainFor } from "./plainLanguage";
export { GLOSSARY, GLOSSARY_BY_TERM } from "./glossary";
export type { GlossaryEntry } from "./glossary";
export { exportVerilog } from "./verilog";
export type { VerilogOptions, VerilogResult } from "./verilog";
export type { DiagnosticFix, PlainDiagnostic } from "./plainLanguage";
export { LANGUAGE_SNIPPETS, SNIPPET_BY_ID, type LanguageSnippet, type SnippetCategory } from "./snippets";

export const ENGINE_VERSION = "0.1.0";
export const IR_SCHEMA = "shortcircuit.ir/v1";
export { LANGUAGE_VERSION } from "./version";

/**
 * Compile LogicFlow source into a portable IR plus validated test suites.
 * The core is pure TypeScript and has no DOM, React, or browser dependency.
 */
export function compile(source: string, options: CompileOptions = {}): CompileResult {
  const started = Date.now();
  try {
    const parser = new Parser(source, [], options.maxDiagnostics ?? 100);
    const program = parser.parse();
    const parserDiagnostics = parser.diagnostics;
    const bundle = resolvePackageBundle(options);
    const packageCatalog = createPackageCatalog([bundle]);
    const importResolution = resolvePackageImports(
      packageCatalog,
      program.imports,
      options,
    );
    // Package circuits are appended after the user's circuits so the first
    // circuit in the result is still the one the user wrote.
    program.circuits.push(...packageCircuitAsts(packageCatalog));
    const analyzer = new ProgramAnalyzer(
      source,
      program,
      options,
      parserDiagnostics,
      packageCatalog,
      importResolution,
    );
    return analyzer.analyze();
  } catch (error) {
    const diagnostic: Diagnostic = {
      code: "E999",
      severity: "error",
      message: `The compiler could not finish: ${error instanceof Error ? error.message : String(error)}`,
      line: 1,
      column: 1,
      hint: "This is an engine bug rather than a circuit error. The source was left untouched.",
    };
    return {
      ok: false,
      source,
      diagnostics: [diagnostic],
      circuits: [],
      tests: [],
      ir: null,
      elapsedMs: Date.now() - started,
    };
  }
}

export function findCircuit(result: CompileResult, name?: string) {
  if (!name) return result.circuits[0];
  return result.circuits.find((circuit) => circuit.name === name);
}
