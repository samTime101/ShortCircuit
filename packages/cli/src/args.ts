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
  "registry",
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
  { usage: "shortcircuit init [dir]", description: "Create a new Short Circuit project." },
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
    usage: "shortcircuit package list [--json] [--verbose]",
    description: "List installed and linked project packages.",
  },
  {
    usage: "shortcircuit package list upstream [--json] [--verbose]",
    description: "List packages available from the upstream registry.",
  },
  {
    usage: "shortcircuit package install [name] [--save-exact]",
    description: "Install dependencies, or add a package and install it.",
  },
  {
    usage: "shortcircuit package uninstall <name>",
    description: "Remove a direct dependency without deleting local files.",
  },
  {
    usage: "shortcircuit package update [name] [--latest]",
    description: "Update dependencies within their version ranges.",
  },
  {
    usage: "shortcircuit package link <name|path> [--force]",
    description: "Use a local package by path, with no symlink or copy.",
  },
  {
    usage: "shortcircuit package init [flags]",
    description: "Create a package, source, docs, and tests locally.",
  },
  {
    usage: "shortcircuit package build",
    description: "Validate the package and build dist/packages.json.",
  },
  {
    usage: "shortcircuit package test",
    description: "Run the package tests against its installed dependencies.",
  },
  {
    usage: "shortcircuit package check",
    description: "Build and test the package in one command.",
  },
  {
    usage: "shortcircuit package register [--dry-run]",
    description: "Validate a package and prepare a registry submission.",
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
  lines.push("  --package <dir>            Load an explicit local package. Repeatable.");
  lines.push("  --registry <url>           Use a different package registry index.");
  lines.push("  --offline                  Use only cached registry data.");
  lines.push("  --refresh                  Ignore cached registry data.");
  lines.push("  --frozen                   Fail if the lockfile and store are incomplete.");
  lines.push("  --force                    Replace a conflicting dependency or file.");
  lines.push("  --save-exact               Save an exact version when installing.");
  lines.push("  --latest                   Update the saved range to the latest version.");
  lines.push("  --verbose                  Include export counts and extra columns.");
  lines.push("  --dry-run                  Validate without writing a submission.");
  lines.push("  --yes                      Use defaults and never prompt.");
  lines.push("");
  lines.push('Run "shortcircuit package help" for package commands.');
  lines.push("");
  return lines.join("\n");
}

export function initHelpText(): string {
  return `Create a Short Circuit project

Usage:
  shortcircuit init
  shortcircuit init my-project

Options:
  --force                    Replace an existing project manifest.
  --registry <url>           Set the project package registry.
  --help                     Show this message.

The command creates shortcircuit.json, shortcircuit.lock.json, src/main.lf,
and a .gitignore entry for .shortcircuit/ and dist/.
`;
}

export function packageHelpText(): string {
  return `Short Circuit package commands

Usage:
  shortcircuit package list [--json] [--verbose]
      List installed and path-linked packages in this project or package.
  shortcircuit package list upstream [--json] [--verbose] [--offline] [--refresh]
      List packages available from the upstream registry.
  shortcircuit package install [name] [--save-exact] [--force] [--offline] [--frozen]
      Resolve the manifest, or add a package and install it.
  shortcircuit package uninstall <name>
      Remove a direct dependency. Local path package files are never deleted.
  shortcircuit package update [name] [--latest] [--offline]
      Update one or all registry dependencies within their ranges.
  shortcircuit package link <name|path> [--force]
      Store a path dependency in the manifest. No symlink and no copy.
  shortcircuit package init [flags]
      Create a package, source, docs, and tests locally.
  shortcircuit package build
      Validate the package and write dist/packages.json.
  shortcircuit package test
      Run the package tests against installed dependencies.
  shortcircuit package check
      Build and test the package.
  shortcircuit package register [--dry-run] [--out <dir>] [--json]
      Validate and prepare a registry submission.

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
  --force                    Overwrite generated files in an existing package.
  --yes                      Use defaults and never prompt.
  --help                     Show this message.

The package is created in the current directory (or the directory positional).
`;
}

export function packageListHelpText(): string {
  return `List project packages

Usage:
  shortcircuit package list [--json] [--verbose]
  shortcircuit package list upstream [--json] [--verbose] [--offline] [--refresh]

"package list" reads the project lockfile. "package list upstream" fetches the
registry index and each package manifest.
`;
}
