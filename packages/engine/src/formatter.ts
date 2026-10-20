const KEYWORD_LINE = /^([A-Za-z_]+)/;
const UPPERCASE_KEYWORDS = new Set([
  "CIRCUIT",
  "INPUT",
  "OUTPUT",
  "STATE",
  "ON",
  "END",
  "TEST",
  "CASE",
  "EXPECT",
  "IF",
  "ELSE",
]);

const OPENERS = new Set(["CIRCUIT", "TEST", "CASE", "IF", "ELSE"]);

type Part = { kind: "code" | "comment"; text: string };

/**
 * Splits one line into code and comment parts so the formatter can rewrite
 * code without ever touching a comment. String literals are respected, so a
 * `//` inside a quoted string stays part of the string.
 */
function scanLine(line: string, inBlock: boolean): { parts: Part[]; inBlock: boolean } {
  const parts: Part[] = [];
  let code = "";
  let comment = "";
  let index = 0;
  let inString: string | null = null;
  let block = inBlock;

  const flushCode = () => {
    if (code !== "") {
      parts.push({ kind: "code", text: code });
      code = "";
    }
  };
  const flushComment = () => {
    if (comment !== "") {
      parts.push({ kind: "comment", text: comment });
      comment = "";
    }
  };

  while (index < line.length) {
    const char = line[index]!;

    if (block) {
      const end = line.indexOf("*/", index);
      if (end === -1) {
        comment += line.slice(index);
        break;
      }
      comment += line.slice(index, end + 2);
      flushCode();
      flushComment();
      block = false;
      index = end + 2;
      continue;
    }

    if (inString) {
      if (char === "\\") {
        code += char + (line[index + 1] ?? "");
        index += 2;
        continue;
      }
      if (char === inString) inString = null;
      code += char;
      index += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      inString = char;
      code += char;
      index += 1;
      continue;
    }

    if (char === "/" && line[index + 1] === "/") {
      comment += line.slice(index);
      flushCode();
      flushComment();
      break;
    }

    if (char === "/" && line[index + 1] === "*") {
      const end = line.indexOf("*/", index + 2);
      if (end === -1) {
        comment += line.slice(index);
        flushCode();
        flushComment();
        block = true;
        break;
      }
      comment += line.slice(index, end + 2);
      flushCode();
      flushComment();
      index = end + 2;
      continue;
    }

    code += char;
    index += 1;
  }

  flushCode();
  flushComment();
  return { parts, inBlock: block };
}

/**
 * A conservative source formatter. It normalizes indentation and keyword case
 * without touching comments, signal case, or expression contents.
 */
export function formatSource(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let depth = 0;
  let previousWasBlank = false;
  let inBlock = false;
  let blockIndent = "";

  for (const rawLine of lines) {
    const originalIndent = /^[ \t]*/.exec(rawLine)?.[0] ?? "";
    const { parts, inBlock: nextInBlock } = scanLine(rawLine, inBlock);
    const openedBlock = !inBlock && nextInBlock;
    const codePart = parts.find((part) => part.kind === "code" && part.text.trim() !== "");

    // Inside a block comment every line is comment text, kept as written.
    if (inBlock || !codePart) {
      if (inBlock && rawLine.trim() === "") {
        output.push("");
        inBlock = nextInBlock;
        continue;
      }
      if (!inBlock && rawLine.trim() === "") {
        if (!previousWasBlank && output.length > 0) output.push("");
        previousWasBlank = true;
        inBlock = nextInBlock;
        continue;
      }
      previousWasBlank = false;
      const relative =
        inBlock && !openedBlock && originalIndent.startsWith(blockIndent)
          ? originalIndent.slice(blockIndent.length)
          : "";
      output.push(`${"  ".repeat(depth)}${relative}${rawLine.trim()}`);
      if (openedBlock) blockIndent = originalIndent;
      inBlock = nextInBlock;
      continue;
    }

    previousWasBlank = false;

    const leadMatch = KEYWORD_LINE.exec(codePart.text.trim());
    const firstWord = leadMatch?.[1]?.toUpperCase() ?? "";
    const isDedent = firstWord === "END" || firstWord === "ELSE";
    if (isDedent) depth = Math.max(0, depth - 1);

    const leading = parts[0] === codePart;
    let result = "";
    let isFirst = true;
    for (const part of parts) {
      if (part.kind === "comment") {
        result += part.text;
        continue;
      }
      let text = part.text;
      if (isFirst) {
        text = text.replace(/^[ \t]+/, "");
        isFirst = false;
        if (leading && UPPERCASE_KEYWORDS.has(firstWord) && leadMatch) {
          text = text.replace(leadMatch[1]!, firstWord);
        }
      }
      result += text;
    }
    const last = parts[parts.length - 1];
    if (last?.kind === "code") result = result.trimEnd();

    output.push(`${"  ".repeat(depth)}${result}`);

    const isOnOpen = firstWord === "ON" && codePart.text.trimEnd().endsWith(":");
    if (OPENERS.has(firstWord) || isOnOpen) depth += 1;
    inBlock = nextInBlock;
  }

  while (output.length > 0 && output[output.length - 1] === "") output.pop();
  return `${output.join("\n")}\n`;
}
