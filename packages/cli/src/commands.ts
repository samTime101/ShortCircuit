import {
  DEFAULT_PACKAGE_BUNDLE,
  compile,
  exportVerilog,
  formatSource,
  generateTruthTable,
  runTests,
  type CompileOptions,
  type CompileResult,
  type PackageBundle,
  type PackageManifest,
} from "@shortcircuit/engine";

export interface CommandResult {
  /** Process exit code: 0 on success, 1 on a diagnostic error or a failed test. */
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandOptions {
  json?: boolean;
  circuit?: string;
  out?: string;
  write?: boolean;
  packages?: PackageBundle;
  packageOrigins?: Map<string, string>;
  disableDefaultPackages?: boolean;
  enabledPackages?: string[];
  disabledPackages?: string[];
}

function compileOptions(options: CommandOptions): CompileOptions {
  return {
    ...(options.packages ? { packages: options.packages } : {}),
    ...(options.disableDefaultPackages ? { disableDefaultPackages: true } : {}),
    ...(options.enabledPackages ? { enabledPackages: options.enabledPackages } : {}),
    ...(options.disabledPackages ? { disabledPackages: options.disabledPackages } : {}),
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

interface PackageListRow {
  manifest: PackageManifest;
  enabled: boolean;
  origin: string;
}

function pad(value: string, width: number): string {
  return value.padEnd(width);
}

export function packageListCommand(options: CommandOptions = {}): CommandResult {
  const defaultPackages = DEFAULT_PACKAGE_BUNDLE.packages;
  const defaultSet = new Set(defaultPackages);
  const customPackages = options.packages?.packages ?? [];
  const allPackages = [...defaultPackages, ...customPackages];
  const disabled = new Set(options.disabledPackages ?? []);
  const enabled = options.enabledPackages ? new Set(options.enabledPackages) : null;
  const origins = options.packageOrigins ?? new Map<string, string>();

  const rows: PackageListRow[] = allPackages.map((manifest) => {
    const isDefault = defaultSet.has(manifest);
    return {
      manifest,
      enabled:
        !disabled.has(manifest.name) &&
        (!enabled || enabled.has(manifest.name)) &&
        !(isDefault && options.disableDefaultPackages),
      origin: isDefault ? "bundled" : (origins.get(manifest.name) ?? "local"),
    };
  });

  const known = new Set(allPackages.map((manifest) => manifest.name));
  const unknown = (options.enabledPackages ?? []).filter((name) => !known.has(name));
  const stderr =
    unknown.length > 0
      ? `warning: No ${unknown.length === 1 ? "package" : "packages"} named ${unknown
          .map((name) => `"${name}"`)
          .join(", ")} for --only-packages.\n`
      : "";

  if (options.json) {
    return {
      code: 0,
      stdout: `${JSON.stringify(
        {
          includeDefaultPackages: !options.disableDefaultPackages,
          packages: rows.map((row) => ({
            name: row.manifest.name,
            version: row.manifest.version,
            description: row.manifest.description,
            enabled: row.enabled,
            origin: row.origin,
            exports: row.manifest.exports.length,
          })),
        },
        null,
        2,
      )}\n`,
      stderr,
    };
  }

  const headers = ["NAME", "VERSION", "EXPORTS", "STATUS", "ORIGIN"];
  const values = rows.map((row) => [
    row.manifest.name,
    row.manifest.version,
    String(row.manifest.exports.length),
    row.enabled ? "enabled" : "disabled",
    row.origin,
  ]);
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...values.map((value) => value[column]!.length)),
  );
  const formatRow = (cells: string[]) =>
    cells
      .map((cell, column) => (column === cells.length - 1 ? cell : pad(cell, widths[column]!)))
      .join("  ");
  const lines = [formatRow(headers), ...values.map(formatRow)];
  const enabledCount = rows.filter((row) => row.enabled).length;
  const disabledCount = rows.length - enabledCount;
  lines.push("");
  lines.push(
    `${rows.length} package${rows.length === 1 ? "" : "s"}, ${enabledCount} enabled, ${disabledCount} disabled.`,
  );

  return { code: 0, stdout: `${lines.join("\n")}\n`, stderr };
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
