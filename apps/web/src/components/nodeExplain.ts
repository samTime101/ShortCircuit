/**
 * Plain-English explanations and truth tables for the built-in gates.
 *
 * The graph uses the same wording as the editor hover cards, so a gate reads
 * the same everywhere in the studio.
 */

export interface TruthRow {
  inputs: string[];
  output: string;
}

const ONE_INPUT: Record<string, (bits: number[]) => number> = {
  NOT: (bits) => (bits[0] ? 0 : 1),
  BUFFER: (bits) => bits[0] ?? 0,
};

const TWO_INPUT: Record<string, (bits: number[]) => number> = {
  AND: (bits) => (bits[0] && bits[1] ? 1 : 0),
  OR: (bits) => (bits[0] || bits[1] ? 1 : 0),
  XOR: (bits) => ((bits[0] ?? 0) ^ (bits[1] ?? 0)) & 1,
  NAND: (bits) => (bits[0] && bits[1] ? 0 : 1),
  NOR: (bits) => (bits[0] || bits[1] ? 0 : 1),
  XNOR: (bits) => (((bits[0] ?? 0) ^ (bits[1] ?? 0)) & 1) === 0 ? 1 : 0,
};

/** The truth table of a gate, or undefined when the operation has no simple table. */
export function gateTruthTable(op: string | undefined): TruthRow[] | undefined {
  if (!op) return undefined;

  const one = ONE_INPUT[op];
  if (one) {
    return [0, 1].map((bit) => ({
      inputs: [String(bit)],
      output: String(one([bit])),
    }));
  }

  const two = TWO_INPUT[op];
  if (two) {
    const rows: TruthRow[] = [];
    for (let a = 0; a <= 1; a += 1) {
      for (let b = 0; b <= 1; b += 1) {
        rows.push({ inputs: [String(a), String(b)], output: String(two([a, b])) });
      }
    }
    return rows;
  }

  return undefined;
}

export interface NodeExplanation {
  /** Short label for the kind of node. */
  kind: string;
  /** One sentence, in plain language. */
  sentence: string;
  /** A second sentence, when there is something useful to add. */
  detail?: string;
}

/** Explains a node in plain language, whatever kind of node it is. */
export function explainNode(
  node: {
    kind: string;
    op?: string;
    description?: string;
    tip?: string;
    widthRule?: string;
    arity?: number;
  },
): NodeExplanation {
  if (node.kind === "operation" && node.description) {
    return {
      kind: "operation",
      sentence: node.description,
      detail: node.tip,
    };
  }
  if (node.kind === "operation") {
    return {
      kind: "operation",
      sentence: `This node evaluates ${node.op ?? "an operation"}.`,
      detail: node.widthRule,
    };
  }
  if (node.kind === "input") {
    return {
      kind: "input",
      sentence: "An input: the outside world sets this value.",
    };
  }
  if (node.kind === "state") {
    return {
      kind: "state",
      sentence: "Stored state: a value the circuit remembers between clock edges.",
    };
  }
  if (node.kind === "constant") {
    return {
      kind: "constant",
      sentence: "A constant: the same value every time.",
    };
  }
  return {
    kind: node.kind,
    sentence: "An output: a value this circuit publishes.",
  };
}
