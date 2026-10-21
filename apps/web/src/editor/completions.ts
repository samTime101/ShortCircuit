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
import {
  builtinCard,
  keywordCard,
  packageCircuitCard,
  packageMacroCard,
  snippetCard,
} from "./cards";
import { KEYWORDS } from "./keywords";

function packageMacroCompletions(): Completion[] {
  return DEFAULT_PACKAGE_MACROS.map((macro) => ({
    label: macro.name,
    type: "function",
    detail: macro.signature,
    boost: 1,
    info: () => packageMacroCard(macro.name)!,
  }));
}

function packageCircuitCompletions(): Completion[] {
  return DEFAULT_PACKAGE_CIRCUITS.map(({ circuit }) => ({
    label: circuit.name,
    type: "class",
    detail: `${circuit.name}(${(circuit.ports?.inputs ?? []).map((port) => port.name).join(", ")})`,
    boost: 1,
    info: () => packageCircuitCard(circuit.name)!,
  }));
}

function functionCompletions(): Completion[] {
  const packageNames = new Set(DEFAULT_PACKAGE_MACROS.map((macro) => macro.name));
  const functions: Completion[] = BUILTINS.filter((spec) => !packageNames.has(spec.name)).map(
    (spec) => ({
      label: spec.name,
      type: "function",
      detail: spec.signature,
      boost: 1,
      info: () => builtinCard(spec.name)!,
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
    info: () => keywordCard(spec.name)!,
  }));
}

function snippetCompletions(): Completion[] {
  return LANGUAGE_SNIPPETS.map((snippet) =>
    snippetCompletion(snippet.template, {
      label: snippet.title,
      type: "snippet",
      detail: snippet.description,
      boost: -1,
      info: () => snippetCard(snippet.title)!,
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
        description: `Declared on line ${signal.line}.`,
      }),
  }));

  const trimmed = before.trimStart();
  const options: Completion[] = [];

  if (/^(INPUT|OUTPUT|STATE|EXPECT)\b/i.test(trimmed)) {
    // After a declaration keyword only existing signals make sense.
    options.push(...signalOptions);
  } else if (/^(CIRCUIT|TEST|ON|CASE|IMPORT)\b/i.test(trimmed)) {
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
