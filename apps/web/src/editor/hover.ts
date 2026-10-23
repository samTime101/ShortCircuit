import { EditorView, hoverTooltip, type Tooltip } from "@codemirror/view";
import {
  DEFAULT_PACKAGE_CIRCUITS,
  DEFAULT_PACKAGE_MACROS,
} from "@shortcircuit/engine";
import { scanDocument, wordAt, type DocumentModel } from "./documentModel";
import {
  builtinCard,
  keywordCard,
  packageCircuitCard,
  packageMacroCard,
  snippetCard,
} from "./cards";
import { infoCard } from "./infoCard";

function packageForAlias(model: DocumentModel, alias: string): string | undefined {
  return (
    model.aliases.get(alias) ??
    [...model.aliases].find(([candidate]) => candidate.toUpperCase() === alias.toUpperCase())?.[1]
  );
}

function packageExportCard(
  name: string,
  packageNames: Set<string>,
): HTMLElement | null {
  const upper = name.toUpperCase();
  const macro = DEFAULT_PACKAGE_MACROS.find(
    (entry) =>
      entry.name.toUpperCase() === upper && packageNames.has(entry.packageName),
  );
  if (macro) return packageMacroCard(macro.name);
  const circuit = DEFAULT_PACKAGE_CIRCUITS.find(
    (entry) =>
      entry.circuit.name.toUpperCase() === upper &&
      packageNames.has(entry.packageName),
  );
  return circuit ? packageCircuitCard(circuit.circuit.name) : null;
}

/**
 * Hover cards for LogicFlow: built-in operations, circuit-shaped components,
 * keywords, and the signals that exist in the current document. Package cards
 * appear only for packages the source actually imports.
 */
export function logicFlowHover(view: EditorView, pos: number): Tooltip | null {
  const word = wordAt(view.state, pos);
  if (!word) return null;

  const model = scanDocument(view.state.doc.toString());
  const upper = word.text.toUpperCase();
  const line = view.state.doc.lineAt(word.from);
  const before = line.text.slice(0, word.from - line.from);
  const qualified = /([A-Za-z_][A-Za-z0-9_]*)\.$/.exec(before);
  const qualifiedPackage = qualified?.[1]
    ? packageForAlias(model, qualified[1])
    : undefined;
  const aliasCard = qualifiedPackage ? null : [...model.aliases].find(
    ([alias]) => alias.toUpperCase() === upper,
  );

  const dom =
    packageExportCard(
      word.text,
      qualifiedPackage
        ? new Set([qualifiedPackage])
        : model.unqualifiedPackages,
    ) ??
    (aliasCard
      ? infoCard({
          title: aliasCard[0],
          badge: "package alias",
          description: aliasCard[1],
        })
      : null) ??
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
          description: `Declared on line ${signal.line}.`,
        }),
      }),
    };
  }

  return null;
}

export const logicFlowHoverTooltip = hoverTooltip(logicFlowHover, {
  hideOnChange: true,
});
