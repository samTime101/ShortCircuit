import { compile } from "./compile";
import {
  resolvePackageBundle,
  type PackageBundle,
  type PackageManifest,
} from "./packages";
import { runTests } from "./testing";
import type {
  CompileOptions,
  Diagnostic,
  TestRunResult,
} from "./types";

export interface PackageTestFileResult {
  packageName: string;
  packageVersion: string;
  /** Package-level tests or a circuit export's tests. */
  kind: "package" | "circuit";
  /** Set for circuit export tests. */
  exportName?: string;
  source: string;
  compileOk: boolean;
  diagnostics: Diagnostic[];
  run: TestRunResult | null;
  ok: boolean;
}

export interface PackageTestReport {
  ok: boolean;
  files: PackageTestFileResult[];
  passed: number;
  failed: number;
  unsupported: number;
  elapsedMs: number;
}

/**
 * Compile and run every test embedded in the loaded package bundles.
 *
 * Package tests use the same compiler and simulator as user tests. Each test
 * source is compiled with its package and dependencies explicitly imported so
 * non-default packages work without test-only import boilerplate.
 */
export function runPackageTests(options: CompileOptions = {}): PackageTestReport {
  const started = Date.now();
  const bundle = resolvePackageBundle(options);
  const byName = new Map(
    bundle.packages.map((manifest) => [manifest.name, manifest]),
  );
  const files: PackageTestFileResult[] = [];
  let passed = 0;
  let failed = 0;
  let unsupported = 0;

  for (const manifest of bundle.packages) {
    const sources: Array<{
      kind: "package" | "circuit";
      exportName?: string;
      source: string;
    }> = [];
    if (manifest.testText) {
      sources.push({ kind: "package", source: manifest.testText });
    }
    for (const item of manifest.exports) {
      if (item.kind === "circuit" && item.testText) {
        sources.push({
          kind: "circuit",
          exportName: item.name,
          source: item.testText,
        });
      }
    }

    for (const entry of sources) {
      const imports = importLinesFor(manifest, byName);
      const source = `${imports}${entry.source}`;
      const result = compile(source, {
        ...testCompileOptions(options),
        packages: bundle,
        disableDefaultPackages: true,
      });
      const diagnostics = result.diagnostics;
      const compileOk = result.ok;
      const run = compileOk ? runTests(result) : null;
      const ok = compileOk && run !== null && run.ok;
      if (run) {
        passed += run.passed;
        failed += run.failed;
        unsupported += run.unsupported;
      }
      files.push({
        packageName: manifest.name,
        packageVersion: manifest.version,
        kind: entry.kind,
        ...(entry.exportName ? { exportName: entry.exportName } : {}),
        source: entry.source,
        compileOk,
        diagnostics,
        run,
        ok,
      });
    }
  }

  return {
    ok: files.every((file) => file.ok),
    files,
    passed,
    failed,
    unsupported,
    elapsedMs: Date.now() - started,
  };
}

function testCompileOptions(options: CompileOptions): CompileOptions {
  return {
    ...(options.maxNodes === undefined ? {} : { maxNodes: options.maxNodes }),
    ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
    ...(options.maxInstances === undefined ? {} : { maxInstances: options.maxInstances }),
    ...(options.maxWidth === undefined ? {} : { maxWidth: options.maxWidth }),
    ...(options.maxDiagnostics === undefined ? {} : { maxDiagnostics: options.maxDiagnostics }),
  };
}

function importLinesFor(
  manifest: PackageManifest,
  byName: Map<string, PackageManifest>,
): string {
  const names: string[] = [];
  const visit = (entry: PackageManifest) => {
    if (names.includes(entry.name)) return;
    names.push(entry.name);
    for (const dependency of Object.keys(entry.dependencies ?? {})) {
      const resolved = byName.get(dependency);
      if (resolved) visit(resolved);
    }
  };
  visit(manifest);
  return names.map((name) => `IMPORT "${name}"`).join("\n") + "\n";
}
