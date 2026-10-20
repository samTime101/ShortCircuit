import type { EditorState } from "@codemirror/state";

/**
 * A light, editor-side model of the current LogicFlow source.
 *
 * The compiler owns the authoritative circuit model; this is only used to make
 * completions and hover cards context aware (which signals exist, which
 * instance ports are visible, where a signal is declared).
 */

export type SignalKind = "input" | "state" | "signal" | "instance";

export interface SignalSummary {
  name: string;
  kind: SignalKind;
  line: number;
}

export interface DocumentModel {
  signals: Map<string, SignalSummary>;
  /** Instance name to the ports exposed through `OUTPUT instance.port`. */
  instancePorts: Map<string, string[]>;
  circuits: string[];
}

const DECLARATION = /^\s*(INPUT|STATE)\s+([A-Za-z_][A-Za-z0-9_]*)/i;
const ASSIGNMENT = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
const SIMPLE_ASSIGNMENT = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(?!\s*([A-Za-z_][A-Za-z0-9_]*)\s*\()/;
const OUTPUT = /^\s*OUTPUT\s+([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/;
const CIRCUIT = /^\s*CIRCUIT\s+([A-Za-z_][A-Za-z0-9_]*)/i;

function stripComment(line: string): string {
  const hash = line.indexOf("#");
  return hash === -1 ? line : line.slice(0, hash);
}

/** Scans the source for signal names, instance ports, and circuit names. */
export function scanDocument(source: string): DocumentModel {
  const signals = new Map<string, SignalSummary>();
  const instancePorts = new Map<string, string[]>();
  const circuits: string[] = [];
  const lines = source.split("\n");

  lines.forEach((raw, index) => {
    const line = stripComment(raw);
    if (line.trim() === "") return;

    const circuit = CIRCUIT.exec(line);
    if (circuit?.[1]) {
      circuits.push(circuit[1]);
      return;
    }

    const declaration = DECLARATION.exec(line);
    if (declaration?.[2]) {
      const kind = declaration[1]!.toUpperCase() === "INPUT" ? "input" : "state";
      if (!signals.has(declaration[2])) {
        signals.set(declaration[2], { name: declaration[2], kind, line: index + 1 });
      }
      return;
    }

    const instance = ASSIGNMENT.exec(line);
    if (instance?.[1] && instance[2]) {
      if (!signals.has(instance[1])) {
        signals.set(instance[1], {
          name: instance[1],
          kind: "instance",
          line: index + 1,
        });
      }
      return;
    }

    const simple = SIMPLE_ASSIGNMENT.exec(line);
    if (simple?.[1]) {
      if (!signals.has(simple[1])) {
        signals.set(simple[1], { name: simple[1], kind: "signal", line: index + 1 });
      }
      return;
    }

    const output = OUTPUT.exec(line);
    if (output?.[1] && output[2]) {
      const list = instancePorts.get(output[1]) ?? [];
      if (!list.includes(output[2])) list.push(output[2]);
      instancePorts.set(output[1], list);
    }
  });

  return { signals, instancePorts, circuits };
}

export interface WordAt {
  text: string;
  from: number;
  to: number;
}

/** Returns the identifier under a document position, if any. */
export function wordAt(state: EditorState, pos: number): WordAt | null {
  const line = state.doc.lineAt(pos);
  const offset = Math.max(0, Math.min(line.length, pos - line.from));
  const before = line.text.slice(0, offset);
  const after = line.text.slice(offset);

  const startMatch = /[A-Za-z0-9_]*$/.exec(before);
  const endMatch = /^[A-Za-z0-9_]*/.exec(after);
  const start = startMatch?.[0] ?? "";
  const end = endMatch?.[0] ?? "";
  const text = start + end;
  if (text === "") return null;
  if (!/^[A-Za-z_]/.test(text)) return null;

  const from = line.from + offset - start.length;
  return { text, from, to: from + text.length };
}
