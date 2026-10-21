import { EditorView, hoverTooltip, type Tooltip } from "@codemirror/view";
import { scanDocument, wordAt } from "./documentModel";
import {
  builtinCard,
  keywordCard,
  packageCircuitCard,
  packageMacroCard,
  snippetCard,
} from "./cards";
import { infoCard } from "./infoCard";

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
