/**
 * Turns a recording of simulator actions into a LogicFlow test case.
 */

export interface RecordedCase {
  /** The circuit the case belongs to. */
  circuit: string;
  /** The name shown in the CASE label. */
  label: string;
  /** The statements of the case, in the order they were recorded. */
  lines: string[];
}

/** Suggests a case name from what was recorded. */
export function suggestCaseName(lines: string[]): string {
  const cycles = lines.reduce((total, line) => {
    const match = /^CYCLE\s+\S+\s+(\d+)/.exec(line.trim());
    return total + (match ? Number(match[1]) : 0);
  }, 0);
  const steps = lines.filter((line) => line.trim() === "STEP").length;
  if (cycles > 0) return `${cycles} clock tick${cycles === 1 ? "" : "s"}`;
  if (steps > 0) return `${steps} step${steps === 1 ? "" : "s"}`;
  const inputs = lines.filter((line) => line.startsWith("INPUT ")).length;
  return inputs > 0 ? `${inputs} input${inputs === 1 ? "" : "s"}` : "recorded case";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Inserts a recorded case into the source.
 *
 * When the circuit already has a TEST block, the case is added to it. Otherwise
 * a new TEST block is appended to the end of the file.
 */
export function insertRecordedCase(source: string, recorded: RecordedCase): string {
  const caseBlock = [
    `  CASE "${recorded.label.replace(/"/g, '\\"')}"`,
    ...recorded.lines.map((line) => `    ${line}`),
    "  END",
  ].join("\n");

  const lines = source.split("\n");
  const header = new RegExp(`^TEST\\s+${escapeRegExp(recorded.circuit)}\\s*$`, "m");
  const match = header.exec(source);
  if (match) {
    const startLine = source.slice(0, match.index).split("\n").length - 1;
    // CASE and STEP nest, so the TEST block ends at the first END that closes
    // none of them. Inserting before the first END would nest the new case
    // inside the previous one and break the file.
    let depth = 0;
    for (let index = startLine + 1; index < lines.length; index += 1) {
      const text = lines[index]!.trim();
      if (/^(CASE|STEP)\b/i.test(text)) {
        depth += 1;
        continue;
      }
      if (/^END$/i.test(text)) {
        if (depth === 0) {
          lines.splice(index, 0, caseBlock);
          return lines.join("\n");
        }
        depth -= 1;
      }
    }
  }

  const trimmed = source.replace(/\s+$/, "");
  return `${trimmed}\n\nTEST ${recorded.circuit}\n${caseBlock}\nEND\n`;
}
