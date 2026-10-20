import type { Diagnostic } from "./types";

const DEFAULT_MAX = 100;

export class DiagnosticBag {
  readonly items: Diagnostic[] = [];
  private readonly max: number;
  private hasErrors = false;

  constructor(max = DEFAULT_MAX) {
    this.max = max;
  }

  error(
    code: string,
    message: string,
    line: number,
    column: number,
    options: Pick<Diagnostic, "hint" | "length" | "related"> = {},
  ): void {
    this.add({ code, severity: "error", message, line, column, ...options });
    this.hasErrors = true;
  }

  warning(
    code: string,
    message: string,
    line: number,
    column: number,
    options: Pick<Diagnostic, "hint" | "length" | "related"> = {},
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
    if (this.items.length >= this.max) return;
    this.items.push(diagnostic);
    if (diagnostic.severity === "error") this.hasErrors = true;
  }

  get blocked(): boolean {
    return this.hasErrors;
  }

  sorted(): Diagnostic[] {
    return [...this.items].sort(
      (a, b) => a.line - b.line || a.column - b.column || a.code.localeCompare(b.code),
    );
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
