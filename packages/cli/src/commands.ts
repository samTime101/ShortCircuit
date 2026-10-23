import {
  compileCore as compile,
  exportVerilog,
  formatSource,
  generateTruthTable,
  runTests,
  type CompileOptions,
  type CompileResult,
  type PackageBundle,
} from "@shortcircuit/engine/core";

export interface DelegatedCommand {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
}

export interface CommandResult {
  /** Process exit code: 0 on success, 1 on a diagnostic error or a failed test. */
  code: number;
  stdout: string;
  stderr: string;
  /** Run this command with inherited stdio instead of printing the result. */
  delegate?: DelegatedCommand;
}

export interface CommandOptions {
  json?: boolean;
  verbose?: boolean;
  circuit?: string;
  out?: string;
  write?: boolean;
  packages?: PackageBundle;
}

function compileOptions(options: CommandOptions): CompileOptions {
  return {
    disableDefaultPackages: true,
    ...(options.packages ? { packages: options.packages } : {}),
  };
}

function compileSource(source: string, options: CommandOptions): CompileResult {
  return compile(source, compileOptions(options));
}

function report(result: CompileResult): { lines: string[]; errors: number } {
  const lines: string[] = [];
  let errors = 0;
  for (const diagnostic of result.diagnostics) {
    if (diagnostic.severity === "error") errors += 1;
    const where = `${diagnostic.line}:${diagnostic.column}`;
    const mark = diagnostic.severity === "error" ? "error" : diagnostic.severity;
    lines.push(`${where}  ${mark}  ${diagnostic.code}  ${diagnostic.message}`);
    if (diagnostic.hint) lines.push(`      ${diagnostic.hint}`);
  }
  return { lines, errors };
}

export function compileCommand(source: string, options: CommandOptions = {}): CommandResult {
  const result = compileSource(source, options);
  const { lines, errors } = report(result);

  if (options.json) {
    return {
      code: errors > 0 ? 1 : 0,
      stdout: JSON.stringify(
        {
          ok: result.ok,
          diagnostics: result.diagnostics,
          circuits: result.circuits.map((circuit) => ({
            name: circuit.name,
            inputs: circuit.inputs.length,
            outputs: circuit.outputs.length,
            nodes: circuit.stats.nodes,
          })),
        },
        null,
        2,
      ),
      stderr: "",
    };
  }

  const summary = result.ok
    ? `Compiled ${result.circuits.length} circuit${result.circuits.length === 1 ? "" : "s"}, ${result.circuits.reduce(
        (total, circuit) => total + circuit.stats.nodes,
        0,
      )} nodes.`
    : `Failed with ${errors} error${errors === 1 ? "" : "s"}.`;

  if (!result.ok) {
    return {
      code: 1,
      stdout: "",
      stderr: `${lines.join("\n")}\n\n${summary}\n`,
    };
  }

  return {
    code: 0,
    stdout: lines.length > 0 ? `${lines.join("\n")}\n\n` : `${summary}\n`,
    stderr: "",
  };
}

export function testCommand(source: string, options: CommandOptions = {}): CommandResult {
  const result = compileSource(source, options);
  if (!result.ok) {
    const { lines } = report(result);
    return {
      code: 1,
      stdout: options.json ? JSON.stringify({ ok: false, diagnostics: result.diagnostics }, null, 2) : "",
      stderr: `${lines.join("\n")}\n`,
    };
  }

  const tests = runTests(result);
  const lines: string[] = [];
  for (const suite of tests.suites) {
    lines.push(`${suite.pass ? "PASS" : "FAIL"}  ${suite.name}`);
    for (const testCase of suite.cases) {
      lines.push(`  ${testCase.pass ? "pass" : "fail"}  ${testCase.label}`);
      if (testCase.error) lines.push(`        ${testCase.error}`);
    }
  }
  lines.push("");
  lines.push(
    `${tests.passed} passed, ${tests.failed} failed, ${tests.unsupported} unsupported (${tests.elapsedMs.toFixed(1)} ms)`,
  );

  if (options.json) {
    return {
      code: tests.ok ? 0 : 1,
      stdout: JSON.stringify(tests, null, 2),
      stderr: "",
    };
  }

  return {
    code: tests.ok ? 0 : 1,
    stdout: `${lines.join("\n")}\n`,
    stderr: tests.ok ? "" : "",
  };
}

export function truthTableCommand(source: string, options: CommandOptions = {}): CommandResult {
  const result = compileSource(source, options);
  if (!result.ok) {
    const { lines } = report(result);
    return { code: 1, stdout: "", stderr: `${lines.join("\n")}\n` };
  }

  const circuit =
    result.circuits.find((entry) => entry.name === options.circuit) ?? result.circuits[0];
  if (!circuit) {
    return { code: 1, stdout: "", stderr: "No circuits to print.\n" };
  }

  const table = generateTruthTable(circuit);
  if (table.rows.length === 0) {
    return {
      code: 1,
      stdout: "",
      stderr: `${table.reason ?? "This circuit has no truth table."}\n`,
    };
  }

  if (options.json) {
    return { code: 0, stdout: JSON.stringify(table, null, 2), stderr: "" };
  }

  const inputNames = table.inputs.map((input) => input.name);
  const outputNames = table.outputs.map((output) => output.name);
  const lines: string[] = [];
  lines.push(
    `${inputNames.join(" | ")} | ${outputNames.join(" | ")}`,
    `${inputNames.map((name) => "-".repeat(name.length)).join("-|-")} | ${outputNames
      .map((name) => "-".repeat(name.length))
      .join("-|-")}`,
  );
  for (const row of table.rows) {
    const left = inputNames.map((name) => row.input[name] ?? "").join(" | ");
    const right = outputNames.map((name) => row.output[name] ?? "").join(" | ");
    lines.push(`${left} | ${right}`);
  }

  return { code: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
}

export function formatCommand(source: string, options: CommandOptions = {}): CommandResult {
  const formatted = formatSource(source);
  if (options.json) {
    return { code: 0, stdout: JSON.stringify({ source: formatted }, null, 2), stderr: "" };
  }
  return { code: 0, stdout: formatted, stderr: "" };
}

export interface PackageListRow {
  name: string;
  version: string;
  origin: "local" | "registry";
  path: string;
  exports: number | null;
  state: "ok" | "missing" | "not installed";
}

export interface UpstreamPackageListRow {
  name: string;
  version: string;
  description?: string;
  exports: number | null;
  installedVersion?: string;
  state: "ok" | "error";
  error?: string;
}

function pad(value: string, width: number): string {
  return value.padEnd(width);
}

function formatRows(
  headers: string[],
  values: string[][],
): { lines: string[]; widths: number[] } {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...values.map((value) => value[column]!.length)),
  );
  const formatRow = (cells: string[]) =>
    cells
      .map((cell, column) =>
        column === cells.length - 1 ? cell : pad(cell, widths[column]!),
      )
      .join("  ");
  return { lines: [formatRow(headers), ...values.map(formatRow)], widths };
}

export function packageListCommand(
  rows: PackageListRow[],
  options: CommandOptions = {},
): CommandResult {
  if (options.json) {
    return {
      code: 0,
      stdout: `${JSON.stringify({ packages: rows }, null, 2)}\n`,
      stderr: "",
    };
  }

  if (rows.length === 0) {
    return {
      code: 0,
      stdout:
        "No packages installed. Run shortcircuit package install <name> or " +
        "shortcircuit package link <package>.\n",
      stderr: "",
    };
  }

  const headers = options.verbose
    ? ["NAME", "VERSION", "ORIGIN", "STATE", "EXPORTS", "PATH"]
    : ["NAME", "VERSION", "ORIGIN", "STATE", "PATH"];
  const values = rows.map((row) => {
    const base = [row.name, row.version, row.origin, row.state];
    if (options.verbose) {
      base.push(row.exports === null ? "-" : String(row.exports));
    }
    base.push(row.path);
    return base;
  });
  const { lines } = formatRows(headers, values);
  lines.push("");
  lines.push(
    `${rows.length} package${rows.length === 1 ? "" : "s"}. ` +
      "Local packages are read in place; registry packages are stored in .shortcircuit/packages.",
  );
  return { code: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
}

export function packageUpstreamListCommand(
  rows: UpstreamPackageListRow[],
  options: CommandOptions = {},
): CommandResult {
  if (options.json) {
    return {
      code: 0,
      stdout: `${JSON.stringify({ packages: rows }, null, 2)}\n`,
      stderr: "",
    };
  }

  if (rows.length === 0) {
    return { code: 0, stdout: "The upstream registry has no packages.\n", stderr: "" };
  }

  const headers = options.verbose
    ? ["NAME", "LATEST", "INSTALLED", "EXPORTS", "DESCRIPTION"]
    : ["NAME", "LATEST", "INSTALLED", "DESCRIPTION"];
  const values = rows.map((row) => {
    const description =
      row.state === "error"
        ? `error: ${row.error ?? "unknown"}`
        : (row.description ?? "");
    if (options.verbose) {
      return [
        row.name,
        row.version,
        row.installedVersion ?? "-",
        row.exports === null ? "-" : String(row.exports),
        description,
      ];
    }
    return [row.name, row.version, row.installedVersion ?? "-", description];
  });
  const { lines } = formatRows(headers, values);
  const failures = rows.filter((row) => row.state === "error");
  if (failures.length > 0) {
    lines.push("");
    for (const failure of failures) {
      lines.push(`Could not read ${failure.name}: ${failure.error ?? "unknown error"}`);
    }
  }
  return { code: failures.length > 0 ? 1 : 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
}

export function exportIrCommand(source: string, options: CommandOptions = {}): CommandResult {
  const result = compileSource(source, options);
  if (!result.ok) {
    const { lines } = report(result);
    return { code: 1, stdout: "", stderr: `${lines.join("\n")}\n` };
  }
  return {
    code: 0,
    stdout: `${JSON.stringify(result.ir, null, 2)}\n`,
    stderr: "",
  };
}

export function exportVerilogCommand(source: string, options: CommandOptions = {}): CommandResult {
  const result = compileSource(source, options);
  if (!result.ok) {
    const { lines } = report(result);
    return { code: 1, stdout: "", stderr: `${lines.join("\n")}\n` };
  }
  const { verilog, warnings } = exportVerilog(result.ir!, { includeTestbenches: true });
  const stderr = warnings.length > 0 ? `${warnings.map((line) => `warning: ${line}`).join("\n")}\n` : "";
  return { code: 0, stdout: verilog, stderr };
}
