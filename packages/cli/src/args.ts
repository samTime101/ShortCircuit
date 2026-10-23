export type FlagValue = string | boolean | string[];

export interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Record<string, FlagValue>;
}

/** Flags that take a value, such as --circuit HalfAdder. */
const VALUE_FLAGS = new Set([
  "circuit",
  "out",
  "format",
  "width",
  "rows",
  "package",
  "root",
  "main",
  "name",
  "export",
  "kind",
  "description",
  "version",
  "license",
  "dependencies",
]);

/** Value flags that can be passed more than once. */
const REPEATABLE_VALUE_FLAGS = new Set(["package"]);

function appendFlag(flags: Record<string, FlagValue>, name: string, value: string): void {
  const current = flags[name];
  if (Array.isArray(current)) {
    current.push(value);
  } else if (typeof current === "string") {
    flags[name] = [current, value];
  } else if (current === true) {
    // Keep the missing value marker so listFlag reports it.
    return;
  } else {
    flags[name] = [value];
  }
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, FlagValue> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const body = token.slice(2);
    const equals = body.indexOf("=");
    if (equals !== -1) {
      const name = body.slice(0, equals);
      const value = body.slice(equals + 1);
      if (REPEATABLE_VALUE_FLAGS.has(name)) {
        appendFlag(flags, name, value);
      } else {
        flags[name] = value;
      }
      continue;
    }
    if (VALUE_FLAGS.has(body)) {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        if (REPEATABLE_VALUE_FLAGS.has(body)) {
          appendFlag(flags, body, next);
        } else {
          flags[body] = next;
        }
        index += 1;
        continue;
      }
      flags[body] = true;
      continue;
    }
    flags[body] = true;
  }

  return { command: positionals[0] ?? "help", positionals: positionals.slice(1), flags };
}

/**
 * Read a repeatable flag as a list. Values are kept whole because a package
 * path can contain a comma.
 */
export function listFlag(
  flags: Record<string, FlagValue>,
  name: string,
): string[] | undefined {
  if (!Object.hasOwn(flags, name)) return undefined;
  const value = flags[name];
  if (value === undefined || typeof value === "boolean") {
    throw new Error(`Option --${name} needs a value.`);
  }
  const raw = Array.isArray(value) ? value : [value];
  const values = raw.map((entry) => entry.trim());
  if (values.length === 0 || values.some((entry) => entry === "")) {
    throw new Error(`Option --${name} needs a value.`);
  }
  return values;
}

export interface HelpEntry {
  usage: string;
  description: string;
}

export const HELP: HelpEntry[] = [
  { usage: "shortcircuit compile <file>", description: "Compile a file and print the diagnostics." },
  { usage: "shortcircuit test <file>", description: "Run the TEST blocks and report the results." },
  {
    usage: "shortcircuit truth-table <file> [--circuit Name]",
    description: "Print the truth table of a combinational circuit.",
  },
  { usage: "shortcircuit format <file> [--write]", description: "Format a file, in place with --write." },
  { usage: "shortcircuit export-ir <file> [--out out.json]", description: "Write the portable IR as JSON." },
  {
    usage: "shortcircuit export-verilog <file> [--out out.v]",
    description: "Write Verilog modules, with a testbench.",
  },
  {
    usage: "shortcircuit package list [--json] [--package <dir>]",
    description: "List bundled and local packages available to the compiler.",
  },
  {
    usage: "shortcircuit package registry [--json] [--root <dir>]",
    description: "List packages registered for authoring.",
  },
  {
    usage: "shortcircuit package init [flags]",
    description: "Create a package, source, docs, tests, and registry entry.",
  },
  {
    usage: "shortcircuit package build [--root <dir>]",
    description: "Validate package manifests and rebuild the bundle.",
  },
  {
    usage: "shortcircuit package test [--root <dir>] [--main <dir>]",
    description: "Build, then run the package tests.",
  },
  {
    usage: "shortcircuit package check [--root <dir>] [--main <dir>]",
    description: "Build and test the package registry.",
  },
];

export function helpText(): string {
  const lines = ["Short Circuit: the LogicFlow command line", "", "Usage:"];
  for (const entry of HELP) {
    lines.push(`  ${entry.usage}`);
    lines.push(`      ${entry.description}`);
  }
  lines.push("");
  lines.push("Options:");
  lines.push("  --json                     Print machine-readable output where it is available.");
  lines.push("  --write                    Change the file in place (format).");
  lines.push("  --out <file>               Write to a file instead of standard output.");
  lines.push("  --circuit <name>           Choose a circuit (truth-table).");
  lines.push("  --package <dir>            Load a local package directory or manifest. Repeatable.");
  lines.push("  --root <dir>               Package registry checkout for authoring commands.");
  lines.push("  --main <dir>               Main checkout for package tests.");
  lines.push("");
  lines.push('Run "shortcircuit package help" for package authoring details.');
  lines.push("");
  return lines.join("\n");
}

export function packageHelpText(): string {
  return `Short Circuit package commands

Usage:
  shortcircuit package list [--json] [--package <dir>]
      List bundled and local packages available to the compiler.
  shortcircuit package registry [--json] [--root <dir>]
      List packages registered for authoring.
  shortcircuit package init [flags]
      Create a package, source, docs, tests, and registry entry.
  shortcircuit package build [--root <dir>]
      Validate manifests and rebuild dist/packages.json.
  shortcircuit package test [--root <dir>] [--main <dir>]
      Build, then run the package tests.
  shortcircuit package check [--root <dir>] [--main <dir>]
      Build and test the package registry.

Run "shortcircuit package init --help" for init flags.
`;
}

export function packageInitHelpText(): string {
  return `Create a Short Circuit package

Usage:
  shortcircuit package init
  shortcircuit package init --name @acme/parity --export PARITY3 --kind macro

Options:
  --name <@scope/name>       Package name. Required when not prompting.
  --export <NAME>            Public macro or circuit name.
  --kind <macro|circuit>     Export kind. Default: macro.
  --description <text>       Catalog description.
  --version <semver>         Package version. Default: 0.1.0.
  --license <id>             License identifier. Default: MIT.
  --dependencies <list>      Comma-separated package names.
  --auto-import              Enable recommendedAutoImport.
  --no-registry              Do not edit registry.json.
  --force                    Replace an existing package directory.
  --yes                      Use defaults and never prompt.
  --root <dir>               Package registry checkout.

The package is created under <root>/packages/<package-directory>.
`;
}
