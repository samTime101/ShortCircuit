import {
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import {
  BUILTINS,
  DEFAULT_PACKAGE_CIRCUITS,
  DEFAULT_PACKAGE_MACROS,
  LANGUAGE_SNIPPETS,
} from "@shortcircuit/engine";
import { scanDocument } from "./documentModel";
import { infoCard } from "./infoCard";

interface KeywordSpec {
  name: string;
  detail: string;
  note: string;
  apply?: string;
}

const KEYWORDS: KeywordSpec[] = [
  {
    name: "CIRCUIT",
    detail: "block",
    note: "Starts a circuit. Every signal inside is defined exactly once.",
    apply: "CIRCUIT ",
  },
  {
    name: "END",
    detail: "block",
    note: "Closes a CIRCUIT, TEST, CASE, IF, or ON block.",
    apply: "END",
  },
  {
    name: "INPUT",
    detail: "declaration",
    note: "Declares an input port. Add : BUS(n) for a bus.",
    apply: "INPUT ",
  },
  {
    name: "OUTPUT",
    detail: "declaration",
    note: "Exposes a signal or an instance port on the circuit output.",
    apply: "OUTPUT ",
  },
  {
    name: "STATE",
    detail: "declaration",
    note: "Declares stored state. Give it a width and an initial value.",
    apply: "STATE ",
  },
  {
    name: "ON",
    detail: "sequential",
    note: "Starts a clocked block: ON RISING_EDGE(clock):",
    apply: "ON ",
  },
  {
    name: "RISING_EDGE",
    detail: "clock",
    note: "Fires when the clock changes from 0 to 1.",
    apply: "RISING_EDGE",
  },
  {
    name: "FALLING_EDGE",
    detail: "clock",
    note: "Fires when the clock changes from 1 to 0.",
    apply: "FALLING_EDGE",
  },
  {
    name: "IF",
    detail: "sequential",
    note: "Conditional update inside a clocked block. Closes with END.",
    apply: "IF ",
  },
  {
    name: "ELSE",
    detail: "sequential",
    note: "Optional alternative branch of an IF block.",
    apply: "ELSE:",
  },
  {
    name: "TEST",
    detail: "block",
    note: "Starts a test suite for a circuit of the same name.",
    apply: "TEST ",
  },
  {
    name: "CASE",
    detail: "block",
    note: "One test case. Give it a label and list INPUT and EXPECT lines.",
    apply: "CASE ",
  },
  {
    name: "EXPECT",
    detail: "test",
    note: "Expected output value of a test case.",
    apply: "EXPECT ",
  },
  {
    name: "BUS",
    detail: "width",
    note: "Declares a bus width: INPUT data : BUS(8)",
    apply: "BUS",
  },
  {
    name: "CONST",
    detail: "compile time",
    note: "Declares a compile-time constant: CONST W = 4",
    apply: "CONST ",
  },
  {
    name: "FOR",
    detail: "compile time",
    note: "Repeats a block once per value. FOR i IN 0..7 ... END",
    apply: "FOR ",
  },
  {
    name: "IN",
    detail: "loop",
    note: "Introduces the range of a FOR loop.",
    apply: "IN ",
  },
];

const CATEGORY_LABEL: Record<string, string> = {
  gate: "gate",
  arithmetic: "arithmetic",
  compare: "comparison",
  bus: "bus",
  selection: "selection",
};

function packageMacroCompletions(): Completion[] {
  return DEFAULT_PACKAGE_MACROS.map((macro) => ({
    label: macro.name,
    type: "function",
    detail: macro.signature,
    boost: 1,
    info: () =>
      infoCard({
        title: macro.name,
        badge: macro.group ?? "package macro",
        rows: [
          { label: "Signature", value: macro.signature },
          { label: "Width", value: macro.widthRule ?? "Result width follows compiler width rules" },
        ],
        code: `result = ${macro.name}(${macro.args.join(", ")})`,
        note: macro.tip ?? macro.summary ?? "Package macro.",
      }),
  }));
}

function packageCircuitCompletions(): Completion[] {
  return DEFAULT_PACKAGE_CIRCUITS.map(({ circuit }) => {
    const inputs = circuit.ports?.inputs.map((port) => port.name) ?? [];
    const outputs = circuit.ports?.outputs.map((port) => port.name) ?? [];
    return {
      label: circuit.name,
      type: "class",
      detail: circuit.summary ?? "package circuit",
      boost: 1,
      info: () =>
        infoCard({
          title: circuit.name,
          badge: circuit.group ?? "component",
          rows: [
            { label: "Signature", value: `${circuit.name}(${inputs.join(", ")})` },
            { label: "Ports", value: `${inputs.join(", ")} -> ${outputs.join(", ")}` },
          ],
          code: `inst = ${circuit.name}(${inputs.join(", ")})\nresult = inst.${outputs[0] ?? "out"}`,
          note: circuit.summary ?? "Package circuit.",
        }),
    };
  });
}

function functionCompletions(): Completion[] {
  const packageNames = new Set(DEFAULT_PACKAGE_MACROS.map((macro) => macro.name));
  const functions: Completion[] = BUILTINS.filter((spec) => !packageNames.has(spec.name)).map(
    (spec) => ({
      label: spec.name,
      type: "function",
      detail: spec.signature,
      boost: 1,
      info: () =>
        infoCard({
          title: spec.name,
          badge: CATEGORY_LABEL[spec.category] ?? spec.category,
          rows: [
            { label: "Signature", value: spec.signature },
            { label: "Width", value: spec.widthRule },
          ],
          code: `${spec.name.toLowerCase()}_result = ${spec.signature}`,
          note: spec.tip,
        }),
    }),
  );

  return [...functions, ...packageMacroCompletions(), ...packageCircuitCompletions()];
}

function keywordCompletions(): Completion[] {
  return KEYWORDS.map((spec) => ({
    label: spec.name,
    type: "keyword",
    detail: spec.detail,
    apply: spec.apply ?? spec.name,
    info: () =>
      infoCard({
        title: spec.name,
        badge: spec.detail,
        note: spec.note,
      }),
  }));
}

function snippetCompletions(): Completion[] {
  return LANGUAGE_SNIPPETS.map((snippet) =>
    snippetCompletion(snippet.template, {
      label: snippet.title,
      type: "snippet",
      detail: snippet.description,
      boost: -1,
      info: () =>
        infoCard({
          title: snippet.title,
          badge: snippet.category,
          note: snippet.description,
          code: snippet.preview,
        }),
    }),
  );
}

/**
 * Context aware completions for LogicFlow: signals from the current document,
 * built-in operations, keywords, and ready-made snippets.
 */
export function logicFlowCompletions(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const model = scanDocument(context.state.doc.toString());

  // "instance." -> offer the ports that instance exposes.
  const dotted = /([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)?$/.exec(before);
  if (dotted?.[1]) {
    const ports = model.instancePorts.get(dotted[1]) ?? [];
    if (ports.length > 0) {
      return {
        from: context.pos - (dotted[2]?.length ?? 0),
        options: ports.map((port) => ({
          label: port,
          type: "property",
          detail: `${dotted[1]} output`,
        })),
        validFor: /^[A-Za-z_][A-Za-z0-9_]*$/,
      };
    }
  }

  const signalOptions: Completion[] = [...model.signals.values()].map((signal) => ({
    label: signal.name,
    type: "variable",
    detail: signal.kind,
    info: () =>
      infoCard({
        title: signal.name,
        badge: signal.kind,
        note: `Declared on line ${signal.line}.`,
      }),
  }));

  const trimmed = before.trimStart();
  const options: Completion[] = [];

  if (/^(INPUT|OUTPUT|STATE|EXPECT)\b/i.test(trimmed)) {
    // After a declaration keyword only existing signals make sense.
    options.push(...signalOptions);
  } else if (/^(CIRCUIT|TEST|ON|IF|ELSE|CASE)\b/i.test(trimmed)) {
    options.push(...keywordCompletions(), ...snippetCompletions());
  } else {
    options.push(
      ...signalOptions,
      ...functionCompletions(),
      ...keywordCompletions(),
      ...snippetCompletions(),
    );
  }

  return {
    from: word ? word.from : context.pos,
    options,
    validFor: /^[A-Za-z_][A-Za-z0-9_]*$/,
  };
}
