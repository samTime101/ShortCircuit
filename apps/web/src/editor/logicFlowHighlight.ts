/**
 * A tiny LogicFlow tokenizer used for syntax highlighting outside the editor:
 * the documentation page, hover cards, and generated examples.
 *
 * It mirrors the editor's stream tokenizer, but returns plain tokens so any
 * host can render them.
 */

export type HighlightKind =
  | "keyword"
  | "function"
  | "type"
  | "number"
  | "string"
  | "comment"
  | "operator"
  | "punctuation"
  | "variable"
  | "plain";

export interface HighlightToken {
  text: string;
  kind: HighlightKind;
}

const KEYWORDS = new Set([
  "CIRCUIT",
  "END",
  "INPUT",
  "OUTPUT",
  "STATE",
  "ON",
  "RISING_EDGE",
  "FALLING_EDGE",
  "TEST",
  "CASE",
  "EXPECT",
  "IMPORT",
  "AS",
  "LOAD",
  "STEP",
  "CYCLE",
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

const OPERATORS = new Set(["=", ":", ",", "."]);
const PUNCTUATION = new Set(["(", ")", "[", "]"]);

/** Splits LogicFlow source into styled tokens. */
export function highlightLogicFlow(code: string): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  let index = 0;
  let plain = "";

  const flush = () => {
    if (plain !== "") {
      tokens.push({ text: plain, kind: "plain" });
      plain = "";
    }
  };

  const push = (text: string, kind: HighlightKind) => {
    flush();
    tokens.push({ text, kind });
  };

  while (index < code.length) {
    const char = code[index]!;

    if (char === "/" && code[index + 1] === "/") {
      const end = code.indexOf("\n", index);
      const stop = end === -1 ? code.length : end;
      push(code.slice(index, stop), "comment");
      index = stop;
      continue;
    }

    if (char === "/" && code[index + 1] === "*") {
      const end = code.indexOf("*/", index + 2);
      const stop = end === -1 ? code.length : end + 2;
      push(code.slice(index, stop), "comment");
      index = stop;
      continue;
    }

    if (char === '"' || char === "'") {
      let end = index + 1;
      while (end < code.length && code[end] !== char && code[end] !== "\n") {
        if (code[end] === "\\") end += 1;
        end += 1;
      }
      const stop = Math.min(code.length, end + 1);
      push(code.slice(index, stop), "string");
      index = stop;
      continue;
    }

    if (/[0-9]/.test(char)) {
      const match = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|[0-9][0-9_]*)/.exec(code.slice(index));
      const text = match?.[0] ?? char;
      push(text, "number");
      index += text.length;
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(code.slice(index));
      const text = match?.[0] ?? char;
      const upper = text.toUpperCase();
      if (upper === "BUS") push(text, "type");
      else if (KEYWORDS.has(upper)) push(text, "keyword");
      else if (FUNCTIONS.has(upper)) push(text, "function");
      else push(text, "variable");
      index += text.length;
      continue;
    }

    if (PUNCTUATION.has(char)) {
      push(char, "punctuation");
      index += 1;
      continue;
    }

    if (OPERATORS.has(char)) {
      push(char, "operator");
      index += 1;
      continue;
    }

    plain += char;
    index += 1;
  }

  flush();
  return tokens;
}
