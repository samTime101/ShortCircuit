import {
  BUILTINS,
  type BuiltinArgument,
  type BuiltinExample,
  type BuiltinSpec,
} from "../packages/engine/src/builtins.ts";

export interface PackageMacroReference {
  name: string;
  signature: string;
  args: string[];
  variadic: boolean;
  summary?: string;
  group?: string;
  widthRule?: string;
  examples?: string[];
}

export interface PackageCircuitReference {
  name: string;
  summary?: string;
  group?: string;
  ports?: {
    inputs: Array<{ name: string }>;
    outputs: Array<{ name: string }>;
  };
}

export interface PackageReference {
  macros: PackageMacroReference[];
  circuits: PackageCircuitReference[];
}

/**
 * Generates the operation reference in the language guide from the engine
 * metadata, so the documentation cannot drift from the implementation.
 */

const CATEGORY_TITLES: Record<string, string> = {
  gate: "Logic gates",
  arithmetic: "Arithmetic",
  compare: "Comparison",
  bus: "Bus operations",
  selection: "Selection",
};

function argumentList(args: BuiltinArgument[]): string {
  return args
    .map((arg) => `\`${arg.name}\` — ${arg.description}${arg.optional ? " (optional)" : ""}`)
    .join(" · ");
}

function exampleLine(example: BuiltinExample): string {
  return `\`${example.call}\` → \`${example.result}\` — ${example.note}`;
}

export function operationReferenceMarkdown(packages: PackageReference): string {
  const lines: string[] = [];
  lines.push("<!-- BEGIN GENERATED REFERENCE -->");
  lines.push("");
  lines.push(
    "This section is generated from the engine and package catalogs. Every operation lists its",
    "arguments, the width it produces, and a call example.",
  );
  lines.push("");

  if (packages.macros.length > 0) {
    lines.push("### Package gates");
    lines.push("");
    for (const macro of packages.macros) {
      lines.push(`#### \`${macro.signature}\``);
      lines.push("");
      lines.push(macro.summary ?? "Package macro.");
      lines.push("");
      lines.push(`- **Arguments:** ${macro.args.join(" · ") || "none"}`);
      lines.push(`- **Result width:** ${macro.widthRule ?? "Follows compiler width rules"}`);
      if (macro.examples?.[0]) lines.push(`- **Example:** \`${macro.examples[0]}\``);
      lines.push(`- **Package:** ${macro.group ?? "Package macro"}`);
      lines.push("");
    }
  }

  const categories = [...new Set(BUILTINS.map((spec) => spec.category))];
  for (const category of categories) {
    lines.push(`### ${CATEGORY_TITLES[category] ?? category}`);
    lines.push("");
    for (const spec of BUILTINS.filter((entry) => entry.category === category)) {
      lines.push(...functionBlock(spec));
    }
  }

  lines.push("### Circuit-shaped components");
  lines.push("");
  for (const circuit of packages.circuits) {
    const inputs = circuit.ports?.inputs.map((port) => port.name) ?? [];
    const outputs = circuit.ports?.outputs.map((port) => port.name) ?? [];
    lines.push(`#### \`${circuit.name}(${inputs.join(", ")})\``);
    lines.push("");
    lines.push(circuit.summary ?? "Package circuit.");
    lines.push("");
    lines.push(`- **Inputs:** ${inputs.join(", ") || "none"}`);
    lines.push(`- **Outputs:** ${outputs.join(", ") || "none"}`);
    lines.push(`- **Package:** ${circuit.group ?? "Package circuit"}`);
    lines.push("");
  }

  lines.push("<!-- END GENERATED REFERENCE -->");
  return lines.join("\n");
}

function functionBlock(spec: BuiltinSpec): string[] {
  return [
    `#### \`${spec.signature}\``,
    "",
    spec.description,
    "",
    `- **Arguments:** ${argumentList(spec.args)}`,
    `- **Result width:** ${spec.widthRule}`,
    `- **Example:** ${exampleLine(spec.example)}`,
    `- **Tip:** ${spec.tip}`,
    "",
  ];
}
