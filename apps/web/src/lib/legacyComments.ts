/**
 * Legacy comment migration.
 *
 * LogicFlow 0.2 replaced the `#` comment marker with `//` for line comments
 * and `/* ... *\/` for block comments. A source saved by an older studio still
 * uses `#`, so it is rewritten once, when it is read back.
 */

/** Rewrites every `#` comment marker that is not inside a string. */
export function migrateLegacyComments(source: string): string {
  if (!source.includes("#")) return source;

  let out = "";
  let index = 0;
  let quote: string | null = null;

  while (index < source.length) {
    const char = source[index]!;

    if (quote) {
      out += char;
      if (char === "\\" && index + 1 < source.length) {
        out += source[index + 1]!;
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      out += char;
      index += 1;
      continue;
    }

    if (char === "#") {
      out += "//";
      index += 1;
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}
