import { compile as compileCore } from "./compile";
import {
  DEFAULT_PACKAGE_BUNDLE,
} from "./defaultPackages";
import { runPackageTests as runPackageTestsCore } from "./packageTests";
import type { CompileOptions, CompileResult } from "./types";

export * from "./core";
export {
  packageWorkedExamples,
  type WorkedExample,
  type WorkedExamplePort,
} from "./packageExamples";
export {
  DEFAULT_PACKAGE_BUNDLE,
  DEFAULT_PACKAGE_CATALOG,
  DEFAULT_PACKAGE_CIRCUITS,
  DEFAULT_PACKAGE_MACROS,
} from "./defaultPackages";

function withDefaultPackages(options: CompileOptions): CompileOptions {
  if (options.disableDefaultPackages || options.defaultPackages || options.packages) return options;
  return { ...options, defaultPackages: DEFAULT_PACKAGE_BUNDLE };
}

/**
 * Compile LogicFlow source into a portable IR plus validated test suites.
 * The web root entry supplies the bundled snapshot by default; hosts that need
 * to stay independent of it can import `@shortcircuit/engine/core` instead.
 */
export function compile(source: string, options: CompileOptions = {}): CompileResult {
  return compileCore(source, withDefaultPackages(options));
}

/** Run package tests with the web default snapshot unless a host overrides it. */
export function runPackageTests(options: CompileOptions = {}) {
  return runPackageTestsCore(withDefaultPackages(options));
}
