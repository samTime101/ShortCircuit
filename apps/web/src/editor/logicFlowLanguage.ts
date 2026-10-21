import { StreamLanguage } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { logicFlowCompletions } from "./completions";

const KEYWORDS = new Set([
  "CIRCUIT",
  "INPUT",
  "OUTPUT",
  "STATE",
  "ON",
  "RISING_EDGE",
  "FALLING_EDGE",
  "END",
  "TEST",
  "CASE",
  "EXPECT",
  "IMPORT",
  "AS",
  "LOAD",
  "STEP",
  "CYCLE",
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
  "MUX",
  "CONCAT",
  "BROADCAST",
  "SLICE",
  "ZEXT",
  "SEXT",
  "REPEAT",
  "REVERSE",
  "HALF_ADDER",
  "FULL_ADDER",
  "ADD4",
  "ADD8",
]);

export interface LogicFlowState {
  /** True while the parser sits inside a block comment that is still open. */
  inBlockComment: boolean;
}

export const logicflowLanguage = StreamLanguage.define<LogicFlowState>({
  startState: () => ({ inBlockComment: false }),
  token(stream, state) {
    // A block comment can span lines, but the stream only ever holds one line,
    // so the state carries the "still inside a comment" flag to the next line.
    if (state.inBlockComment) {
      const close = stream.string.indexOf("*/", stream.pos);
      if (close === -1) {
        stream.skipToEnd();
        return "comment";
      }
      stream.pos = close + 2;
      state.inBlockComment = false;
      return "comment";
    }

    if (stream.eatSpace()) return null;
    if (stream.match(/\/\/[^\n]*/)) return "comment";
    if (stream.match(/\/\*/)) {
      const close = stream.string.indexOf("*/", stream.pos);
      if (close === -1) {
        stream.skipToEnd();
        state.inBlockComment = true;
      } else {
        stream.pos = close + 2;
      }
      return "comment";
    }
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
    if (stream.match(/^(?:=|:|,|\.)/)) return "operator";
    if (stream.match(/^[()[\]]/)) return "punctuation";
    stream.next();
    return null;
  },
  tokenTable: {
    // The style sheet styles `tags.lineComment`, so the comment token has to
    // point at that exact tag rather than the generic `tags.comment`.
    comment: tags.lineComment,
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
