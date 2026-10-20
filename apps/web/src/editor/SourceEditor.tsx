import {
  HighlightStyle,
  StreamLanguage,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  forceLinting,
  lintGutter,
  linter,
  type Diagnostic as LintMessage,
} from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Diagnostic } from "@shortcircuit/engine";
import { logicFlowCompletions } from "./completions";
import { logicFlowHoverTooltip } from "./hover";
import "./editor.css";

const KEYWORDS = new Set([
  "CIRCUIT",
  "INPUT",
  "OUTPUT",
  "STATE",
  "ON",
  "RISING_EDGE",
  "FALLING_EDGE",
  "IF",
  "ELSE",
  "END",
  "TEST",
  "CASE",
  "EXPECT",
  "BUS",
]);

const FUNCTIONS = new Set([
  "AND",
  "OR",
  "XOR",
  "NAND",
  "NOR",
  "XNOR",
  "NOT",
  "BUFFER",
  "ADD",
  "SUBTRACT",
  "MULTIPLY",
  "DIVIDE",
  "EQUAL",
  "LESS",
  "GREATER",
  "COMPARE",
  "MUX",
  "CONCAT",
  "SLICE",
  "SHIFT_LEFT",
  "SHIFT_RIGHT",
  "DECODER",
  "ENCODER",
  "HALF_ADDER",
  "FULL_ADDER",
]);

const logicflowLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/#.*/)) return "comment";
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return "string";
    if (stream.match(/^'(?:[^'\\]|\\.)*'?/)) return "string";
    if (stream.match(/^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|[0-9][0-9_]*)/)) {
      return "number";
    }
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) {
      const value = stream.current();
      const upper = value.toUpperCase();
      if (value === "BUS") return "typeName";
      if (KEYWORDS.has(upper)) return "keyword";
      if (FUNCTIONS.has(upper)) return "functionName";
      if (stream.match(/^\s*\(/, false)) return "callName";
      return "variableName";
    }
    if (stream.match(/^(?:==|=|:|,|\.)/)) return "operator";
    if (stream.match(/^[()[\]{}]/)) return "punctuation";
    stream.next();
    return null;
  },
  tokenTable: {
    functionName: tags.function(tags.variableName),
    callName: tags.function(tags.propertyName),
    typeName: tags.typeName,
  },
  // The built-in CodeMirror completion UI reads this language data, so the
  // studio gets completions without a second autocomplete extension.
  languageData: {
    autocomplete: logicFlowCompletions,
  },
});

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#7aa7ff", fontWeight: "600" },
  { tag: tags.function(tags.variableName), color: "#a78bfa" },
  { tag: tags.function(tags.propertyName), color: "#a78bfa" },
  { tag: tags.typeName, color: "#e9a06a" },
  { tag: tags.number, color: "#e9a06a" },
  { tag: tags.string, color: "#e2b95c" },
  { tag: tags.lineComment, color: "#5a6373", fontStyle: "italic" },
  { tag: tags.variableName, color: "#e4e7ec" },
  { tag: tags.operator, color: "#97a0b0" },
  { tag: tags.punctuation, color: "#78818f" },
]);

const editorTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "#0a0c10",
      color: "#e4e7ec",
      height: "100%",
      fontSize: "13.5px",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace",
      overflow: "auto",
      lineHeight: "1.75",
    },
    ".cm-content": {
      caretColor: "#6c9eff",
      padding: "14px 0 60px",
      minHeight: "100%",
    },
    ".cm-line": {
      padding: "0 20px 0 12px",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "#6c9eff",
      borderLeftWidth: "1.5px",
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "rgba(108, 158, 255, 0.18)",
    },
    ".cm-gutters": {
      backgroundColor: "#0a0c10",
      color: "#4d5665",
      border: "none",
      paddingLeft: "6px",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      minWidth: "26px",
      padding: "0 8px 0 2px",
      fontFamily: "'JetBrains Mono Variable', monospace",
      fontSize: "11px",
    },
    ".cm-activeLine": { backgroundColor: "rgba(108, 158, 255, 0.03)" },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "#6c9eff",
    },
    ".cm-foldGutter .cm-gutterElement": {
      color: "#4d5665",
      padding: "0 4px",
    },
    ".cm-matchingBracket, .cm-nonmatchingBracket": {
      backgroundColor: "rgba(108, 158, 255, 0.12)",
      outline: "1px solid rgba(108, 158, 255, 0.28)",
    },
    ".cm-lintRange-error": {
      backgroundImage:
        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='3'%3E%3Cpath d='m0 3 1.5-1.5L3 3l1.5-1.5L6 3' fill='none' stroke='%23ef6f6f' stroke-width='1'/%3E%3C/svg%3E\")",
    },
    ".cm-lintRange-warning": {
      backgroundImage:
        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='3'%3E%3Cpath d='m0 3 1.5-1.5L3 3l1.5-1.5L6 3' fill='none' stroke='%23e2b95c' stroke-width='1'/%3E%3C/svg%3E\")",
    },
    ".cm-tooltip": {
      backgroundColor: "#14171c",
      border: "1px solid #2d333c",
      borderRadius: "6px",
      color: "#e4e7ec",
      fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif",
      boxShadow: "0 14px 36px rgba(0,0,0,.45)",
    },
    ".cm-tooltip-lint": { padding: "0" },
    ".cm-diagnostic": {
      padding: "8px 10px",
      fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif",
      fontSize: "12px",
    },
    ".cm-panels": {
      backgroundColor: "#14171c",
      color: "#e4e7ec",
      borderColor: "#2d333c",
    },
    ".cm-searchMatch": { backgroundColor: "rgba(226, 185, 92, 0.22)" },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "rgba(108, 158, 255, 0.25)",
    },
    ".cm-gutter-lint": { width: "14px" },
    ".cm-gutter-lint .cm-gutterElement": { padding: "0 4px" },
    ".cm-tooltip.cm-tooltip-autocomplete": {
      backgroundColor: "#14171c",
      border: "1px solid #2d333c",
      borderRadius: "6px",
      boxShadow: "0 14px 36px rgba(0, 0, 0, 0.5)",
      overflow: "hidden",
    },
    ".cm-tooltip.cm-tooltip-autocomplete ul": {
      fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace",
      fontSize: "12px",
      maxHeight: "17em",
      padding: "4px",
    },
    ".cm-tooltip.cm-tooltip-autocomplete ul li": {
      borderRadius: "3px",
      color: "#c3cad6",
      padding: "4px 8px",
    },
    ".cm-completionLabel": { color: "#e8ecf4" },
    ".cm-completionDetail": {
      color: "#6b7481",
      fontSize: "10px",
      fontStyle: "normal",
      marginLeft: "10px",
    },
    ".cm-completionIcon": { color: "#6c9eff", opacity: "0.9" },
    ".cm-completionMatchedText": { color: "#6c9eff", fontWeight: "600" },
  },
  { dark: true },
);

export interface SourceEditorHandle {
  gotoLine(line: number, column?: number): void;
  focus(): void;
}

interface SourceEditorProps {
  value: string;
  diagnostics: Diagnostic[];
  onChange(value: string): void;
  onRun(): void;
}

function toLintMessage(view: EditorView, diagnostic: Diagnostic): LintMessage {
  const lineNumber = Math.min(Math.max(1, diagnostic.line), view.state.doc.lines);
  const line = view.state.doc.line(lineNumber);
  const from = Math.min(line.to, line.from + Math.max(0, diagnostic.column - 1));
  const requestedLength = Math.max(1, diagnostic.length ?? 1);
  const to = Math.min(line.to, from + requestedLength);
  const severity =
    diagnostic.severity === "error"
      ? "error"
      : diagnostic.severity === "warning"
        ? "warning"
        : "info";
  return {
    from,
    to: Math.max(from + (from === to ? 0 : 1), Math.min(to, line.to)),
    severity,
    message: diagnostic.hint
      ? `${diagnostic.message} ${diagnostic.hint}`
      : diagnostic.message,
    source: diagnostic.code,
  };
}

export const SourceEditor = forwardRef<SourceEditorHandle, SourceEditorProps>(
  function SourceEditor({ value, diagnostics, onChange, onRun }, ref) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    const onRunRef = useRef(onRun);
    const diagnosticsRef = useRef(diagnostics);

    onChangeRef.current = onChange;
    onRunRef.current = onRun;
    diagnosticsRef.current = diagnostics;

    useImperativeHandle(
      ref,
      () => ({
        gotoLine(line: number, column = 1) {
          const view = viewRef.current;
          if (!view) return;
          const lineNumber = Math.min(Math.max(1, line), view.state.doc.lines);
          const info = view.state.doc.line(lineNumber);
          const position = Math.min(info.to, info.from + Math.max(0, column - 1));
          view.dispatch({
            selection: { anchor: position },
            effects: EditorView.scrollIntoView(position, { y: "center" }),
          });
          view.focus();
        },
        focus() {
          viewRef.current?.focus();
        },
      }),
      [],
    );

    useEffect(() => {
      if (!hostRef.current) return;
      const view = new EditorView({
        state: EditorState.create({
          doc: value,
          extensions: [
            basicSetup,
            EditorState.tabSize.of(2),
            indentUnit.of("  "),
            EditorView.lineWrapping,
            EditorView.contentAttributes.of({
              "aria-label": "LogicFlow circuit source editor",
              spellcheck: "false",
            }),
            logicflowLanguage,
            syntaxHighlighting(highlightStyle),
            logicFlowHoverTooltip,
            editorTheme,
            linter(
              (editorView) =>
                diagnosticsRef.current.map((diagnostic) =>
                  toLintMessage(editorView, diagnostic),
                ),
              { delay: 140 },
            ),
            lintGutter(),
            keymap.of([
              {
                key: "Mod-Enter",
                run: () => {
                  onRunRef.current();
                  return true;
                },
              },
            ]),
            EditorView.updateListener.of((update) => {
              if (update.docChanged) onChangeRef.current(update.state.doc.toString());
            }),
          ],
        }),
        parent: hostRef.current,
      });
      viewRef.current = view;
      return () => {
        view.destroy();
        viewRef.current = null;
      };
      // The editor is intentionally created once. Incoming values are synced below.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      if (view.state.doc.toString() !== value) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: value },
        });
      }
    }, [value]);

    useEffect(() => {
      if (viewRef.current) forceLinting(viewRef.current);
    }, [diagnostics]);

    return <div className="source-editor" ref={hostRef} />;
  },
);
