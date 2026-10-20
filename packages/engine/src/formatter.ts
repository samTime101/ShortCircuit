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

/**
 * A conservative source formatter. It normalizes indentation and keyword case
 * without touching comments, signal case, or expression contents.
 */
export function formatSource(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let depth = 0;
  let previousWasBlank = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed === "") {
      if (!previousWasBlank && output.length > 0) output.push("");
      previousWasBlank = true;
      continue;
    }
    previousWasBlank = false;

    const leadMatch = KEYWORD_LINE.exec(trimmed);
    const firstWord = leadMatch?.[1]?.toUpperCase() ?? "";
    const isComment = trimmed.startsWith("#");
    const isDedent = !isComment && (firstWord === "END" || firstWord === "ELSE");
    if (isDedent) depth = Math.max(0, depth - 1);

    let content = trimmed;
    if (!isComment && UPPERCASE_KEYWORDS.has(firstWord) && leadMatch) {
      content = `${firstWord}${trimmed.slice(leadMatch[1]!.length)}`;
    }

    output.push(`${"  ".repeat(depth)}${content}`);

    if (!isComment) {
      const isOnOpen = firstWord === "ON" && content.trimEnd().endsWith(":");
      if (OPENERS.has(firstWord) || isOnOpen) depth += 1;
    }
  }

  while (output.length > 0 && output[output.length - 1] === "") output.pop();
  return `${output.join("\n")}\n`;
}
