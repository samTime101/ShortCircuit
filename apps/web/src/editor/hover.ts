import { EditorView, hoverTooltip, type Tooltip } from "@codemirror/view";
import {
  BUILTINS,
  INTRINSIC_CIRCUITS,
  LANGUAGE_SNIPPETS,
} from "@shortcircuit/engine";
import { scanDocument, wordAt } from "./documentModel";
import { infoCard } from "./infoCard";

const CATEGORY_LABEL: Record<string, string> = {
  gate: "gate",
  arithmetic: "arithmetic",
  compare: "comparison",
  bus: "bus",
  selection: "selection",
};

const KEYWORD_NOTES: Record<string, string> = {
  CIRCUIT: "Starts a circuit block. Every signal inside is defined exactly once.",
  END: "Closes a CIRCUIT, TEST, CASE, IF, or ON block.",
  INPUT: "Declares an input port. Use : BUS(n) for a bus.",
  OUTPUT: "Exposes a signal, or an instance port such as result.sum.",
  STATE: "Declares stored state. Give it a width and an initial value.",
  ON: "Starts a clocked block: ON RISING_EDGE(clock):",
  RISING_EDGE: "Fires when the clock changes from 0 to 1.",
  FALLING_EDGE: "Fires when the clock changes from 1 to 0.",
  IF: "Conditional update inside a clocked block. Closes with END.",
  ELSE: "Optional alternative branch of an IF block.",
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

function intrinsicCard(name: string): HTMLElement | null {
  const spec = INTRINSIC_CIRCUITS.find((entry) => entry.name === name);
  if (!spec) return null;
  return infoCard({
    title: spec.name,
    badge: "component",
    rows: [
      { label: "Signature", value: spec.signature },
      { label: "Ports", value: `${spec.inputs.join(", ")} -> ${spec.outputs.join(", ")}` },
      { label: "Width", value: spec.widthRule },
    ],
    code: `inst = ${spec.name}(${spec.inputs.join(", ")})\nresult = inst.${spec.outputs[0] ?? "out"}`,
    note: `${spec.description} ${spec.tip}`,
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
    builtinCard(upper) ??
    intrinsicCard(upper) ??
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
