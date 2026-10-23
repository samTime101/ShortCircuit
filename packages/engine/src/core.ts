import type { CompileResult } from "./types";

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
export { runPackageTests as runPackageTestsCore } from "./packageTests";
export type {
  PackageTestFileResult,
  PackageTestReport,
} from "./packageTests";
export { generateTruthTable, type TruthTableOptions } from "./truthTable";
export { formatSource } from "./formatter";
export {
  binaryToDecimal,
  formatBinary,
  formatHex,
  parseLanguageLiteral,
  parseSimulationInput,
} from "./values";
export { BUILTINS, BUILTIN_BY_NAME } from "./builtins";
export type { BuiltinArgument, BuiltinExample, BuiltinSpec } from "./builtins";
export {
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
export { plainFor } from "./plainLanguage";
export { GLOSSARY, GLOSSARY_BY_TERM } from "./glossary";
export type { GlossaryEntry } from "./glossary";
export { exportVerilog } from "./verilog";
export type { VerilogOptions, VerilogResult } from "./verilog";
export type { DiagnosticFix, PlainDiagnostic } from "./plainLanguage";
export { LANGUAGE_SNIPPETS, SNIPPET_BY_ID, type LanguageSnippet, type SnippetCategory } from "./snippets";
export { compile as compileCore } from "./compile";

export const ENGINE_VERSION = "0.1.0";
export const IR_SCHEMA = "shortcircuit.ir/v1";
export { LANGUAGE_VERSION } from "./version";

export function findCircuit(result: CompileResult, name?: string) {
  if (!name) return result.circuits[0];
  return result.circuits.find((circuit) => circuit.name === name);
}
