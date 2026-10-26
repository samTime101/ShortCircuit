import type { Diagnostic } from "./types";

const DEFAULT_MAX = 100;

/**
 * Two diagnostics are the same report when every part a reader can see matches.
 * The same source line can legitimately carry two different messages, so the
 * message is part of the identity.
 */
function diagnosticKey(diagnostic: Diagnostic): string {
  return `${diagnostic.code}\u0000${diagnostic.severity}\u0000${diagnostic.line}\u0000${diagnostic.column}\u0000${diagnostic.message}`;
}

export class DiagnosticBag {
  readonly items: Diagnostic[] = [];
  private readonly max: number;
  private readonly seen = new Set<string>();
  private hasErrors = false;
  /** Unique reports that did not fit in the bag because of the limit. */
  private dropped = 0;

  constructor(max = DEFAULT_MAX) {
    this.max = max;
  }

  error(
    code: string,
    message: string,
    line: number,
    column: number,
    options: Pick<Diagnostic, "hint" | "length" | "related" | "suggestion"> = {},
  ): void {
    this.add({ code, severity: "error", message, line, column, ...options });
    this.hasErrors = true;
  }

  warning(
    code: string,
    message: string,
    line: number,
    column: number,
    options: Pick<Diagnostic, "hint" | "length" | "related" | "suggestion"> = {},
  ): void {
    this.add({ code, severity: "warning", message, line, column, ...options });
  }

  info(
    code: string,
    message: string,
    line: number,
    column: number,
    options: Pick<Diagnostic, "hint" | "length" | "related"> = {},
  ): void {
    this.add({ code, severity: "info", message, line, column, ...options });
  }

  add(diagnostic: Diagnostic): void {
    // A circuit that another circuit instantiates is analyzed once on its own
    // and again while expanding the instance. Both passes describe the same
    // source position, so keep the first report instead of showing it twice.
    const key = diagnosticKey(diagnostic);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.items.length >= this.max) {
      this.dropped += 1;
      return;
    }
    this.items.push(diagnostic);
    if (diagnostic.severity === "error") this.hasErrors = true;
  }

  get blocked(): boolean {
    return this.hasErrors;
  }

  sorted(): Diagnostic[] {
    const sorted = [...this.items].sort(
      (a, b) => a.line - b.line || a.column - b.column || a.code.localeCompare(b.code),
    );
    if (this.dropped > 0) {
      // A truncated list must say so; otherwise a file with 300 errors looks
      // like a file with 100. Append after sorting so the notice stays last.
      const lastLine = sorted.at(-1)?.line ?? 1;
      sorted.push({
        code: "W900",
        severity: "warning",
        message: `Showing ${this.items.length} of ${this.items.length + this.dropped} diagnostics.`,
        line: lastLine,
        column: 1,
        length: 1,
        hint: "Fix the errors shown, then compile again to see the rest.",
      });
    }
    return sorted;
  }
}

/** Levenshtein distance with an early cutoff, used for friendly suggestions. */
export function editDistance(a: string, b: string, cutoff = 4): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cutoff) return cutoff + 1;
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  const current = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let rowMin = current[0]!;
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution);
      rowMin = Math.min(rowMin, current[j]!);
    }
    if (rowMin > cutoff) return cutoff + 1;
    for (let j = 0; j <= b.length; j++) previous[j] = current[j]!;
  }
  return previous[b.length]!;
}

export function suggestName(
  name: string,
  candidates: Iterable<string>,
  cutoff = 2,
): string | undefined {
  let best: string | undefined;
  let bestDistance = cutoff + 1;
  const lower = name.toLowerCase();
  for (const candidate of candidates) {
    const distance =
      candidate === name
        ? 0
        : Math.min(
            editDistance(name, candidate, cutoff),
            editDistance(lower, candidate.toLowerCase(), cutoff),
          );
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

export function quoteList(values: Iterable<string>, limit = 6): string {
  const list = [...values];
  if (list.length === 0) return "none";
  const shown = list.slice(0, limit).join(", ");
  return list.length > limit ? `${shown}, +${list.length - limit} more` : shown;
}
