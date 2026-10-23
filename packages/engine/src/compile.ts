import { ProgramAnalyzer } from "./analyzer";
import { Parser } from "./parser";
import {
  createPackageCatalog,
  packageCircuitAsts,
  packageClosure,
  resolvePackageBundle,
  resolvePackageImports,
} from "./packages";
import type { CompileOptions, CompileResult, Diagnostic } from "./types";

/**
 * Compile LogicFlow source into a portable IR plus validated test suites.
 *
 * This core compiler only uses packages supplied through `options`. The root
 * `@shortcircuit/engine` entry injects the web default snapshot before calling
 * it; the core entry stays free of that snapshot.
 */
export function compile(source: string, options: CompileOptions = {}): CompileResult {
  const started = Date.now();
  try {
    const parser = new Parser(source, [], options.maxDiagnostics ?? 100);
    const program = parser.parse();
    const parserDiagnostics = parser.diagnostics;
    const bundle = resolvePackageBundle(options);
    const packageCatalog = createPackageCatalog([bundle]);
    const importResolution = resolvePackageImports(packageCatalog, program.imports);
    // Package circuits are appended after the user's circuits so the first
    // circuit in the result is still the one the user wrote. Only imported
    // packages and their declared dependencies take part in the compilation.
    const loadedPackages = packageClosure(packageCatalog, importResolution.importedPackages);
    program.circuits.push(...packageCircuitAsts(packageCatalog, loadedPackages));
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
