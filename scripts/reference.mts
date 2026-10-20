import {
  BUILTINS,
  INTRINSIC_CIRCUITS,
  type BuiltinArgument,
  type BuiltinExample,
  type BuiltinSpec,
} from "../packages/engine/src/builtins.ts";

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

export function operationReferenceMarkdown(): string {
  const lines: string[] = [];
  lines.push("<!-- BEGIN GENERATED REFERENCE -->");
  lines.push("");
  lines.push(
    "This section is generated from the engine's operation registry. Every built-in lists its",
    "arguments, the width it produces, and a worked example with the value it returns.",
  );
  lines.push("");

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
  for (const spec of INTRINSIC_CIRCUITS) {
    lines.push(`#### \`${spec.signature}\``);
    lines.push("");
    lines.push(spec.description);
    lines.push("");
    lines.push(`- **Arguments:** ${argumentList(spec.args)}`);
    lines.push(`- **Outputs:** ${spec.outputs.join(", ")}`);
    lines.push(`- **Result width:** ${spec.widthRule}`);
    lines.push(`- **Example:** ${exampleLine(spec.example)}`);
    lines.push(`- **Tip:** ${spec.tip}`);
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
