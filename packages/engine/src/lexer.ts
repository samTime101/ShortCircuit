import type { Diagnostic } from "./types";

export type TokenKind = "identifier" | "number" | "string" | "symbol" | "newline" | "eof";

export interface Token {
  kind: TokenKind;
  value: string;
  raw: string;
  line: number;
  column: number;
  offset: number;
  length: number;
}

const SYMBOLS = new Set([
  "(",
  ")",
  "[",
  "]",
  ":",
  "=",
  ",",
  ".",
  "==",
  "+",
  "-",
  "*",
  "/",
  "%",
]);
const SINGLE_SYMBOLS = new Set([
  "(",
  ")",
  "[",
  "]",
  ":",
  "=",
  ",",
  ".",
  "+",
  "-",
  "*",
  "/",
  "%",
]);

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_]/.test(char);
}

/** Tokenizes LogicFlow source while collecting recoverable lexical errors. */
export function lex(source: string, diagnostics: Diagnostic[]): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let line = 1;
  let column = 1;

  const push = (
    kind: TokenKind,
    value: string,
    raw: string,
    startLine: number,
    startColumn: number,
    startOffset: number,
  ) => {
    tokens.push({
      kind,
      value,
      raw,
      line: startLine,
      column: startColumn,
      offset: startOffset,
      length: raw.length,
    });
  };

  const advance = (count = 1) => {
    for (let i = 0; i < count; i++) {
      if (source[index] === "\n") {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
      index += 1;
    }
  };

  while (index < source.length) {
    const char = source[index]!;

    if (char === "\r") {
      advance();
      continue;
    }

    if (char === "\n") {
      const start = index;
      const startLine = line;
      const startColumn = column;
      advance();
      push("newline", "\n", "\n", startLine, startColumn, start);
      continue;
    }

    if (char === " " || char === "\t") {
      advance();
      continue;
    }

    if (char === "#") {
      while (index < source.length && source[index] !== "\n") advance();
      continue;
    }

    const startLine = line;
    const startColumn = column;
    const startOffset = index;

    if (char === '"' || char === "'") {
      const quote = char;
      let raw = quote;
      advance();
      let terminated = false;
      while (index < source.length) {
        const next = source[index]!;
        if (next === "\n") break;
        if (next === "\\") {
          raw += next;
          advance();
          if (index < source.length) {
            raw += source[index]!;
            advance();
          }
          continue;
        }
        if (next === quote) {
          raw += next;
          advance();
          terminated = true;
          break;
        }
        raw += next;
        advance();
      }
      if (!terminated) {
        diagnostics.push({
          code: "E001",
          severity: "error",
          message: "Unterminated string literal.",
          line: startLine,
          column: startColumn,
          length: raw.length,
          hint: "Close the string with the same quote character.",
        });
      }
      const value = raw.slice(1, terminated ? -1 : undefined).replace(/\\(["'\\])/g, "$1");
      push("string", value, raw, startLine, startColumn, startOffset);
      continue;
    }

    if (char === "=" && source[index + 1] === "=") {
      advance(2);
      push("symbol", "==", "==", startLine, startColumn, startOffset);
      continue;
    }

    if (SINGLE_SYMBOLS.has(char)) {
      advance();
      push("symbol", char, char, startLine, startColumn, startOffset);
      continue;
    }

    if (/[0-9]/.test(char)) {
      let raw = "";
      if (char === "0" && (source[index + 1] === "x" || source[index + 1] === "X")) {
        raw += source[index]!;
        advance();
        raw += source[index]!;
        advance();
        while (index < source.length && /[0-9a-fA-F_]/.test(source[index]!)) {
          raw += source[index]!;
          advance();
        }
      } else if (char === "0" && (source[index + 1] === "b" || source[index + 1] === "B")) {
        raw += source[index]!;
        advance();
        raw += source[index]!;
        advance();
        while (index < source.length && /[01_]/.test(source[index]!)) {
          raw += source[index]!;
          advance();
        }
      } else {
        while (index < source.length && /[0-9_]/.test(source[index]!)) {
          raw += source[index]!;
          advance();
        }
      }
      push("number", raw, raw, startLine, startColumn, startOffset);
      continue;
    }

    if (isIdentifierStart(char)) {
      let raw = "";
      while (index < source.length && isIdentifierPart(source[index]!)) {
        raw += source[index]!;
        advance();
      }
      push("identifier", raw, raw, startLine, startColumn, startOffset);
      continue;
    }

    if (SYMBOLS.has(char)) {
      advance();
      push("symbol", char, char, startLine, startColumn, startOffset);
      continue;
    }

    diagnostics.push({
      code: "E002",
      severity: "error",
      message: `Unexpected character "${char}".`,
      line: startLine,
      column: startColumn,
      hint: "LogicFlow uses letters, numbers, parentheses, brackets, commas, colons, dots, and equals signs.",
    });
    advance();
  }

  tokens.push({
    kind: "eof",
    value: "",
    raw: "",
    line,
    column,
    offset: index,
    length: 0,
  });
  return tokens;
}
