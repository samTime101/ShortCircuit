import { EditorView, hoverTooltip, type Tooltip } from "@codemirror/view";
import {
  BUILTINS,
  DEFAULT_PACKAGE_CIRCUITS,
  DEFAULT_PACKAGE_MACROS,
  LANGUAGE_SNIPPETS,
} from "@shortcircuit/engine";
import { scanDocument, wordAt } from "./documentModel";
import { infoCard } from "./infoCard";

const CATEGORY_LABEL: Record<string, string> = {
  gate: "gate",
  bus: "bus",
};

const KEYWORD_NOTES: Record<string, string> = {
  CIRCUIT: "Starts a circuit block. Every signal inside is defined exactly once.",
  END: "Closes a CIRCUIT, TEST, CASE, or ON block.",
  INPUT: "Declares an input port. Use : BUS(n) for a bus.",
  OUTPUT: "Exposes a signal, or an instance port such as result.sum.",
  STATE: "Declares stored state. Give it a width and an initial value.",
  ON: "Starts a clocked block: ON RISING_EDGE(clock):",
  RISING_EDGE: "Fires when the clock changes from 0 to 1.",
  FALLING_EDGE: "Fires when the clock changes from 1 to 0.",
  IMPORT: "Imports a package. Add AS Alias for qualified access.",
  AS: "Names an imported package for qualified access.",
  TEST: "Starts a test suite for the circuit with the same name.",
  CASE: "One test case with a label, INPUT lines, and EXPECT lines.",
  EXPECT: "Expected output value inside a test case.",
  BUS: "Declares a bus width: INPUT data : BUS(8)",
};

function builtinCard(name: string): HTMLElement | null {
  const spec = BUILTINS.find((entry) => entry.name === name);
  if (!spec) return null;
  return infoCard({
    title: spec.name,
    badge: CATEGORY_LABEL[spec.category] ?? spec.category,
    rows: [
      { label: "Signature", value: spec.signature },
      { label: "Width", value: spec.widthRule },
    ],
    code: `result = ${spec.signature}`,
    note: `${spec.description} ${spec.tip}`,
  });
}

function packageMacroCard(name: string): HTMLElement | null {
  const macro = DEFAULT_PACKAGE_MACROS.find((entry) => entry.name === name);
  if (!macro) return null;
  return infoCard({
    title: macro.name,
    badge: macro.group ?? "package macro",
    rows: [
      { label: "Signature", value: macro.signature },
      { label: "Width", value: macro.widthRule ?? "Result width follows compiler width rules" },
    ],
    code: `result = ${macro.name}(${macro.args.join(", ")})`,
    note: macro.tip ?? macro.summary ?? "Package macro.",
  });
}

function packageCircuitCard(name: string): HTMLElement | null {
  const entry = DEFAULT_PACKAGE_CIRCUITS.find(({ circuit }) => circuit.name === name);
  if (!entry) return null;
  const { circuit } = entry;
  const inputs = circuit.ports?.inputs.map((port) => port.name) ?? [];
  const outputs = circuit.ports?.outputs.map((port) => port.name) ?? [];
  return infoCard({
    title: circuit.name,
    badge: circuit.group ?? "component",
    rows: [
      { label: "Signature", value: `${circuit.name}(${inputs.join(", ")})` },
      { label: "Ports", value: `${inputs.join(", ")} -> ${outputs.join(", ")}` },
    ],
    code: `inst = ${circuit.name}(${inputs.join(", ")})\nresult = inst.${outputs[0] ?? "out"}`,
    note: circuit.summary ?? "Package circuit.",
  });
}

function keywordCard(name: string): HTMLElement | null {
  const note = KEYWORD_NOTES[name];
  if (!note) return null;
  return infoCard({ title: name, badge: "keyword", note });
}

function snippetCard(name: string): HTMLElement | null {
  const snippet = LANGUAGE_SNIPPETS.find((entry) => entry.title === name);
  if (!snippet) return null;
  return infoCard({
    title: snippet.title,
    badge: "snippet",
    note: snippet.description,
    code: snippet.preview,
  });
}

/**
 * Hover cards for LogicFlow: built-in operations, circuit-shaped components,
 * keywords, and the signals that exist in the current document.
 */
export function logicFlowHover(view: EditorView, pos: number): Tooltip | null {
  const word = wordAt(view.state, pos);
  if (!word) return null;

  const upper = word.text.toUpperCase();
  const dom =
    packageMacroCard(upper) ??
    packageCircuitCard(upper) ??
    builtinCard(upper) ??
    keywordCard(upper) ??
    snippetCard(word.text);

  if (dom) {
    return {
      pos: word.from,
      end: word.to,
      above: true,
      create: () => ({ dom }),
    };
  }

  const model = scanDocument(view.state.doc.toString());
  const signal = model.signals.get(word.text);
  if (signal) {
    return {
      pos: word.from,
      end: word.to,
      above: true,
      create: () => ({
        dom: infoCard({
          title: signal.name,
          badge: signal.kind,
          note: `Declared on line ${signal.line}.`,
        }),
      }),
    };
  }

  return null;
}

export const logicFlowHoverTooltip = hoverTooltip(logicFlowHover, {
  hideOnChange: true,
});
