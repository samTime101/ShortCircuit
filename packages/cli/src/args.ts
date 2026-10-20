export interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

/** Flags that take a value, such as --circuit HalfAdder. */
const VALUE_FLAGS = new Set(["circuit", "out", "format", "width", "rows"]);

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const body = token.slice(2);
    const equals = body.indexOf("=");
    if (equals !== -1) {
      flags[body.slice(0, equals)] = body.slice(equals + 1);
      continue;
    }
    if (VALUE_FLAGS.has(body)) {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[body] = next;
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
];

export function helpText(): string {
  const lines = ["Short Circuit — the LogicFlow command line", "", "Usage:"];
  for (const entry of HELP) {
    lines.push(`  ${entry.usage}`);
    lines.push(`      ${entry.description}`);
  }
  lines.push("");
  lines.push("Options:");
  lines.push("  --json            Print machine-readable output where it is available.");
  lines.push("  --write           Change the file in place (format).");
  lines.push("  --out <file>      Write to a file instead of standard output.");
  lines.push("  --circuit <name>  Choose a circuit (truth-table).");
  lines.push("");
  return lines.join("\n");
}
