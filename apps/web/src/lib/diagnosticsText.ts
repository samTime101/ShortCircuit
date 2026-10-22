import type { Diagnostic } from "@shortcircuit/engine";

export function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The text the console's Copy button puts on the clipboard: every diagnostic,
 * one block each, with the source line so the paste still makes sense elsewhere.
 */
export function formatDiagnostics(diagnostics: Diagnostic[], sourceLines: string[]): string {
  const errors = diagnostics.filter((item) => item.severity === "error").length;
  const warnings = diagnostics.filter((item) => item.severity === "warning").length;
  const counts = [countLabel(errors, "error")];
  if (warnings > 0) counts.push(countLabel(warnings, "warning"));

  const entries = diagnostics.map((diagnostic, index) => {
    const headline = diagnostic.plain?.headline;
    const entry = [
      `${index + 1}. [${diagnostic.severity}] ${diagnostic.code} · L${diagnostic.line}:${diagnostic.column} · ${
        headline ?? diagnostic.message
      }`,
    ];
    if (headline && headline !== diagnostic.message) entry.push(`   ${diagnostic.message}`);
    if (diagnostic.plain) entry.push(`   ${diagnostic.plain.detail}`);
    if (diagnostic.hint && diagnostic.hint !== diagnostic.plain?.detail) {
      entry.push(`   ${diagnostic.hint}`);
    }
    for (const related of diagnostic.related ?? []) {
      entry.push(`   ↳ L${related.line}:${related.column} ${related.message}`);
    }
    const sourceLine = sourceLines[Math.max(0, diagnostic.line - 1)] ?? "";
    if (sourceLine.trim()) entry.push(`   ${diagnostic.line} | ${sourceLine.trim()}`);
    return entry.join("\n");
  });

  return [`Short Circuit diagnostics · ${counts.join(" · ")}`, "", ...entries].join("\n");
}
