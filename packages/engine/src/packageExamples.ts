import type {
  CallAst,
  Path,
  ProgramAst,
  TestCaseAst,
  TestStatementAst,
} from "./ast";
import { Parser } from "./parser";
import {
  DEFAULT_PACKAGE_CATALOG,
  type PackageCatalog,
  type PackageCircuitExport,
  type PackageMacroExport,
  type PackageManifest,
} from "./packages";

/**
 * A value a package test expects on one output.
 */
export interface WorkedExamplePort {
  /** The output port name, for example "sum". */
  name: string;
  /** The expected value, for example "1". */
  value: string;
}

/**
 * A worked example taken from the package's own test suite.
 *
 * Every package ships tests, so the studio can show a real call with the
 * values it was exercised with and the results it produced, without any
 * extra data in the package manifest.
 */
export interface WorkedExample {
  /** The call with the values from the test case, e.g. "FULL_ADDER(1, 1, 1)". */
  call: string;
  /** The label of the test case the example comes from, e.g. "1 + 1 + 1". */
  label: string;
  /** The values the test expects on the output ports. */
  ports: WorkedExamplePort[];
  /** The whole result, for exports that return a single value. */
  value?: string;
}

interface CaseValues {
  inputs: Map<string, string>;
  expects: Map<string, string>;
}

interface CallSite {
  /** The name the call is assigned to, e.g. "full". */
  instance: string;
  call: CallAst;
}

function parseProgram(source: string): ProgramAst | null {
  try {
    return new Parser(source, [], 20).parse();
  } catch {
    return null;
  }
}

function pathLabel(path: Path): string {
  return path.map((segment) => segment.name).join(".");
}

/** Finds the first place the test source calls the given export. */
function findCallSite(program: ProgramAst, exportName: string): CallSite | null {
  const wanted = exportName.toUpperCase();
  for (const circuit of program.circuits) {
    for (const item of circuit.body) {
      if (item.kind !== "Assignment") continue;
      if (item.value.kind !== "Call") continue;
      if (item.value.name.toUpperCase() !== wanted) continue;
      const instance = item.target[0]?.name;
      if (!instance) continue;
      return { instance, call: item.value };
    }
  }
  return null;
}

function collectStatements(statements: TestStatementAst[], values: CaseValues): void {
  for (const statement of statements) {
    if (statement.kind === "TestInput") {
      values.inputs.set(statement.name, statement.value.raw);
    } else if (statement.kind === "TestExpect") {
      values.expects.set(pathLabel(statement.path), statement.value.raw);
    } else if (statement.kind === "TestStep") {
      collectStatements(statement.statements, values);
    }
  }
}

/**
 * Builds the example for one test case, or null when the case does not
 * exercise the call with plain input values.
 */
function exampleForCase(
  site: CallSite,
  testCase: TestCaseAst,
  exportName: string,
): WorkedExample | null {
  const values: CaseValues = { inputs: new Map(), expects: new Map() };
  collectStatements(testCase.statements, values);

  const args: string[] = [];
  for (const argument of site.call.args) {
    const value = argument.value;
    if (value.kind === "Literal") {
      args.push(value.raw);
      continue;
    }
    if (value.kind === "Reference") {
      const name = value.path[0]?.name;
      const input = name ? values.inputs.get(name) : undefined;
      if (input === undefined) return null;
      args.push(input);
      continue;
    }
    return null;
  }
  if (args.length === 0) return null;

  const ports: WorkedExamplePort[] = [];
  let whole: string | undefined;
  for (const [label, value] of values.expects) {
    if (label === site.instance) {
      whole = value;
      continue;
    }
    if (label.startsWith(`${site.instance}.`)) {
      ports.push({ name: label.slice(site.instance.length + 1), value });
    }
  }
  if (ports.length === 0 && whole === undefined) return null;

  return {
    call: `${exportName}(${args.join(", ")})`,
    label: testCase.label,
    ports,
    ...(whole === undefined ? {} : { value: whole }),
  };
}

/**
 * Picks the example for an export: the first test case that shows a result
 * other than all zeroes, or the first case when every result is zero.
 */
function workedExample(program: ProgramAst, exportName: string): WorkedExample | null {
  const site = findCallSite(program, exportName);
  if (!site) return null;
  let fallback: WorkedExample | null = null;
  for (const test of program.tests) {
    for (const testCase of test.cases) {
      const example = exampleForCase(site, testCase, exportName);
      if (!example) continue;
      if (!fallback) fallback = example;
      const results = example.ports.map((port) => port.value);
      if (example.value !== undefined) results.push(example.value);
      if (results.some((value) => value.includes("1"))) return example;
    }
  }
  return fallback;
}

function exampleForMacro(
  manifest: PackageManifest,
  item: PackageMacroExport,
  programs: Map<string, ProgramAst | null>,
): WorkedExample | null {
  if (item.internal) return null;
  const program = programs.get(manifest.name) ?? null;
  if (!program) return null;
  return workedExample(program, item.name);
}

function exampleForCircuit(
  manifest: PackageManifest,
  item: PackageCircuitExport,
  programs: Map<string, ProgramAst | null>,
): WorkedExample | null {
  const key = `${manifest.name}:${item.name}`;
  const program = programs.get(key) ?? null;
  if (!program) return null;
  return workedExample(program, item.name);
}

/**
 * Collects the worked example of every export in a package catalog.
 *
 * The key is "<package name>:<export name>". Macros are exercised by the
 * package level tests, circuits by the tests that ship with the circuit.
 */
export function packageWorkedExamples(
  catalog: PackageCatalog = DEFAULT_PACKAGE_CATALOG,
): Map<string, WorkedExample> {
  const examples = new Map<string, WorkedExample>();
  const programs = new Map<string, ProgramAst | null>();

  for (const manifest of catalog.packages) {
    programs.set(
      manifest.name,
      manifest.testText ? parseProgram(manifest.testText) : null,
    );
    for (const item of manifest.exports) {
      if (item.kind === "circuit" && item.testText) {
        programs.set(
          `${manifest.name}:${item.name}`,
          parseProgram(item.testText),
        );
      }
    }

    for (const item of manifest.exports) {
      const example =
        item.kind === "macro"
          ? exampleForMacro(manifest, item, programs)
          : exampleForCircuit(manifest, item, programs);
      if (example) examples.set(`${manifest.name}:${item.name}`, example);
    }
  }

  return examples;
}
