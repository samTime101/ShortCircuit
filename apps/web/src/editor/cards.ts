import {
  BUILTINS,
  DEFAULT_PACKAGE_CIRCUITS,
  DEFAULT_PACKAGE_MACROS,
  LANGUAGE_SNIPPETS,
  packageWorkedExamples,
  type WorkedExample,
} from "@shortcircuit/engine";
import { infoCard } from "./infoCard";
import { KEYWORDS } from "./keywords";

const CATEGORY_LABEL: Record<string, string> = {
  gate: "gate",
  bus: "bus",
};

let workedExampleCache: Map<string, WorkedExample> | null = null;

/**
 * The worked examples of every package export, taken from the tests the
 * packages ship with. They are built once and then reused by every card.
 */
function workedExamples(): Map<string, WorkedExample> {
  if (!workedExampleCache) workedExampleCache = packageWorkedExamples();
  return workedExampleCache;
}

function bits(width: number): string {
  return `${width} ${width === 1 ? "bit" : "bits"}`;
}

function portList(
  ports: Array<{ name: string; width: number }> | undefined,
): string[] {
  return (ports ?? []).map((port) => `${port.name} (${bits(port.width)})`);
}

/** The example of a package export, when the package ships a test for it. */
function exampleFor(
  packageName: string,
  exportName: string,
): WorkedExample | undefined {
  return workedExamples().get(`${packageName}:${exportName}`);
}

export function builtinCard(name: string): HTMLElement | null {
  const spec = BUILTINS.find((entry) => entry.name === name);
  if (!spec) return null;
  return infoCard({
    title: spec.name,
    badge: CATEGORY_LABEL[spec.category] ?? spec.category,
    description: spec.description,
    rows: [
      { label: "Signature", value: spec.signature },
      {
        label: "Arguments",
        value: spec.args.map(
          (argument) =>
            `${argument.name} — ${argument.description}${
              argument.optional ? " (optional)" : ""
            }`,
        ),
      },
      { label: "Returns", value: spec.widthRule },
    ],
    example: {
      label: "Example",
      lines: [
        `result = ${spec.example.call}`,
        `→ ${spec.example.result} — ${spec.example.note}`,
      ],
    },
    note: spec.tip,
  });
}

export function packageMacroCard(name: string): HTMLElement | null {
  const macro = DEFAULT_PACKAGE_MACROS.find((entry) => entry.name === name);
  if (!macro) return null;
  const example = exampleFor(macro.packageName, macro.name);
  const argumentsList = [...macro.args];
  if (macro.variadic) argumentsList.push("...");
  return infoCard({
    title: macro.name,
    badge: macro.group ?? "package macro",
    description: macro.summary ?? "Package macro.",
    rows: [
      { label: "Signature", value: macro.signature },
      {
        label: "Arguments",
        value: argumentsList.map((argument) =>
          argument === "..."
            ? "... — further inputs, folded by the package macro"
            : argument,
        ),
      },
      {
        label: "Returns",
        value: `one value — ${macro.widthRule ?? "width follows the compiler width rules"}`,
      },
    ],
    example: example
      ? {
          label: `Example — "${example.label}"`,
          lines: [
            example.value === undefined
              ? `y = ${example.call}`
              : `y = ${example.call}  →  ${example.value}`,
          ],
        }
      : macro.examples?.[0]
        ? { label: "Example", lines: [macro.examples[0]] }
        : undefined,
    note: macro.tip ?? macro.summary,
  });
}

export function packageCircuitCard(name: string): HTMLElement | null {
  const entry = DEFAULT_PACKAGE_CIRCUITS.find(({ circuit }) => circuit.name === name);
  if (!entry) return null;
  const { circuit } = entry;
  const inputs = circuit.ports?.inputs ?? [];
  const outputs = circuit.ports?.outputs ?? [];
  const example = exampleFor(entry.packageName, circuit.name);
  const firstOutput = outputs[0]?.name ?? "out";
  return infoCard({
    title: circuit.name,
    badge: circuit.group ?? "component",
    description: circuit.summary ?? "Package circuit.",
    rows: [
      { label: "Signature", value: `${circuit.name}(${inputs.map((port) => port.name).join(", ")})` },
      { label: "Arguments", value: portList(inputs) },
      { label: "Returns", value: portList(outputs) },
    ],
    example: example
      ? {
          label: `Example — "${example.label}"`,
          lines: [
            `inst = ${example.call}`,
            ...example.ports.map((port) => `inst.${port.name} = ${port.value}`),
          ],
        }
      : undefined,
    note: `Assign an instance, then read its output ports: inst.${firstOutput}.`,
  });
}

export function keywordCard(name: string): HTMLElement | null {
  const keyword = KEYWORDS.find((entry) => entry.name === name);
  if (!keyword) return null;
  return infoCard({
    title: keyword.name,
    badge: keyword.detail,
    description: keyword.note,
  });
}

export function snippetCard(name: string): HTMLElement | null {
  const snippet = LANGUAGE_SNIPPETS.find((entry) => entry.title === name);
  if (!snippet) return null;
  return infoCard({
    title: snippet.title,
    badge: "snippet",
    description: snippet.description,
    code: snippet.preview,
  });
}
