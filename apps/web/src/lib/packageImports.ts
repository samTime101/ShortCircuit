/**
 * Source-level package imports.
 *
 * The package manager edits the same IMPORT lines that the compiler reads, so
 * the source stays the single source of truth for which packages are active.
 */

export interface PackageImportLine {
  packageName: string;
  alias: string | null;
  /** One-based line number. */
  line: number;
}

const IMPORT_LINE = /^\s*IMPORT\s+"([^"]+)"(?:\s+AS\s+([A-Za-z_][A-Za-z0-9_]*))?(?:\s|$)/i;

function stripComments(
  line: string,
  inBlockComment: boolean,
): { text: string; inBlockComment: boolean } {
  let text = "";
  let quote: string | null = null;
  let index = 0;
  let inBlock = inBlockComment;

  while (index < line.length) {
    const char = line[index]!;
    if (inBlock) {
      const end = line.indexOf("*/", index);
      if (end === -1) return { text, inBlockComment: true };
      index = end + 2;
      inBlock = false;
      text += " ";
      continue;
    }
    if (quote) {
      text += char;
      if (char === "\\" && index + 1 < line.length) {
        text += line[index + 1]!;
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      text += char;
      index += 1;
      continue;
    }
    if (char === "/" && line[index + 1] === "/") break;
    if (char === "/" && line[index + 1] === "*") {
      inBlock = true;
      index += 2;
      text += " ";
      continue;
    }
    text += char;
    index += 1;
  }

  return { text, inBlockComment: inBlock };
}

function parseImportLine(text: string): { packageName: string; alias: string | null } | null {
  const match = IMPORT_LINE.exec(text);
  if (!match?.[1]) return null;
  return {
    packageName: match[1],
    alias: match[2] ?? null,
  };
}

/** Every IMPORT line in the source, in source order. */
export function readPackageImports(source: string): PackageImportLine[] {
  const imports: PackageImportLine[] = [];
  let inBlockComment = false;
  for (const [index, rawLine] of source.split("\n").entries()) {
    const stripped = stripComments(rawLine, inBlockComment);
    inBlockComment = stripped.inBlockComment;
    const parsed = parseImportLine(stripped.text);
    if (parsed) {
      imports.push({ ...parsed, line: index + 1 });
    }
  }
  return imports;
}

export function hasPackageImport(source: string, packageName: string): boolean {
  return readPackageImports(source).some((entry) => entry.packageName === packageName);
}

/**
 * Add an unaliased import at the top of the source, after any leading comments
 * and after any existing imports. Existing imports for the package are left
 * alone.
 */
export function addPackageImport(source: string, packageName: string): string {
  if (hasPackageImport(source, packageName)) return source;
  if (source.trim() === "") return `IMPORT "${packageName}"\n`;

  const lines = source.split("\n");
  const importLines = readPackageImports(source);
  let insertAt: number;

  if (importLines.length > 0) {
    insertAt = importLines[importLines.length - 1]!.line;
  } else {
    let inBlockComment = false;
    let index = 0;
    while (index < lines.length) {
      const stripped = stripComments(lines[index]!, inBlockComment);
      inBlockComment = stripped.inBlockComment;
      if (stripped.text.trim() !== "") break;
      index += 1;
    }
    insertAt = index;
  }

  const importLine = `IMPORT "${packageName}"`;
  lines.splice(insertAt, 0, importLine);

  const next = lines[insertAt + 1];
  if (next !== undefined && next.trim() !== "" && parseImportLine(next) === null) {
    lines.splice(insertAt + 1, 0, "");
  }

  return lines.join("\n");
}

/** Remove every import for a package. Other imports and comments are kept. */
export function removePackageImport(source: string, packageName: string): string {
  const lines = source.split("\n");
  const kept: string[] = [];
  let removed = false;
  let inBlockComment = false;

  for (const rawLine of lines) {
    const stripped = stripComments(rawLine, inBlockComment);
    inBlockComment = stripped.inBlockComment;
    const parsed = parseImportLine(stripped.text);
    if (parsed?.packageName === packageName) {
      removed = true;
      continue;
    }
    if (removed && rawLine.trim() === "" && kept[kept.length - 1]?.trim() === "") {
      continue;
    }
    kept.push(rawLine);
  }

  if (!removed) return source;
  return kept.join("\n");
}
