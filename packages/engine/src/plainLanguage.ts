import type { Diagnostic } from "./types";

/**
 * Plain-language layer for diagnostics.
 *
 * Every diagnostic keeps its stable code, but the headline and the detail are
 * written for someone who has never used a compiler. The same text is used by
 * the studio, the CLI, and any other host.
 */

export interface DiagnosticFix {
  /** Button label, for example "Replace with `carry`". */
  label: string;
  /** The text that replaces the range. */
  text: string;
  /** 1-based line of the range to replace. */
  line: number;
  /** 1-based column of the range to replace. */
  column: number;
  /** Length of the range to replace. */
  length: number;
}

export interface PlainDiagnostic {
  /** Short, plain headline. */
  headline: string;
  /** One or two sentences explaining what went wrong. */
  detail: string;
  /** An optional edit that fixes the problem. */
  fix?: DiagnosticFix;
}

interface Template {
  headline: string;
  detail: string;
}

const TEMPLATES: Record<string, Template> = {
  E001: {
    headline: "A string was left open",
    detail: "The quote before this text never closed, so the rest of the line was read as part of it.",
  },
  E002: {
    headline: "That character does not belong here",
    detail: "LogicFlow uses letters, numbers, brackets, commas, colons, dots, and equals signs. Comments start with // or /* ... */.",
  },
  E003: {
    headline: "This comment was never closed",
    detail: "A /* comment needs a matching */ to finish it.",
  },
  E100: {
    headline: "This line does not start a block",
    detail: "Every top-level block begins with CIRCUIT or TEST.",
  },
  E101: {
    headline: "This block is never closed",
    detail: "Add END as the last line of the block.",
  },
  E105: {
    headline: "This clock needs an edge",
    detail: "Write ON RISING_EDGE(clock): or ON FALLING_EDGE(clock):",
  },
  E110: {
    headline: "This line is not a test statement",
    detail: "Inside a test case you can set INPUT values, check EXPECT values, load a state, group changes with STEP, or pulse a clock with CYCLE.",
  },
  E111: {
    headline: "This test case is never closed",
    detail: "Add END as the last line of the case.",
  },
  E112: {
    headline: "That is not a valid width",
    detail: "Widths are whole numbers, for example 8 or BUS(8).",
  },
  E113: {
    headline: "This needs a width",
    detail: "Write INPUT data : BUS(8) to declare an eight-bit bus.",
  },
  E119: {
    headline: "There is too much on this line",
    detail: "LogicFlow puts one declaration or assignment on each line.",
  },
  E200: {
    headline: "That name is taken by the language",
    detail: "Pick a name that is not a keyword, a built-in operation, or an enabled package export.",
  },
  E201: {
    headline: "There is no signal with that name",
    detail: "Check the spelling, or declare the signal before using it.",
  },
  E202: {
    headline: "This name is used twice",
    detail: "Every signal has exactly one definition.",
  },
  E203: {
    headline: "There is no circuit with that name",
    detail: "A test suite runs against a circuit with the same name.",
  },
  E204: {
    headline: "This circuit does not have that output",
    detail: "Check the name of the port, including any instance prefix.",
  },
  E205: {
    headline: "This case never sets one of the inputs",
    detail: "Set every input so the expected values are unambiguous.",
  },
  E209: {
    headline: "This is set twice",
    detail: "Give each input a single value, or move the second one into a later step.",
  },
  E210: {
    headline: "There is no function with that name",
    detail: "Use a built-in operation, or define a CIRCUIT with that name.",
  },
  E212: {
    headline: "This signal has no ports",
    detail: "Only a circuit instance has outputs you can read.",
  },
  E213: {
    headline: "This is a circuit, not a value",
    detail: "Read one of its outputs instead, for example instance.sum.",
  },
  E214: {
    headline: "That bit number is not valid",
    detail: "Bit numbers are whole numbers, starting at 0.",
  },
  E215: {
    headline: "The slice runs backwards",
    detail: "Write the high bit first, for example data[7:4].",
  },
  E216: {
    headline: "That bit is outside the signal",
    detail: "A four-bit signal has bits 0 to 3.",
  },
  E217: {
    headline: "Give the instance a name first",
    detail: "Write instance = Name(...) on its own line, then read instance.output.",
  },
  E218: {
    headline: "Built-in functions take plain arguments",
    detail: "Write AND(a, b) instead of AND(a = x, b = y).",
  },
  E219: {
    headline: "This needs a plain number",
    detail: "Slice bounds and counts are written as plain decimal numbers.",
  },
  E220: {
    headline: "Only stored state can change in here",
    detail: "Inside a clocked block, assign to a STATE signal. Compute everything else in a normal assignment.",
  },
  E221: {
    headline: "This case checks nothing",
    detail: "Add at least one EXPECT line so the case has something to prove.",
  },
  E230: {
    headline: "LOAD can only set stored state",
    detail: "LOAD gives a state a starting value, so it needs the name of a STATE signal.",
  },
  E231: {
    headline: "This clock is not an input",
    detail: "CYCLE pulses an input of the circuit.",
  },
  E232: {
    headline: "LOAD does not belong inside a step",
    detail: "LOAD sets a starting value, so it belongs at the top of a case.",
  },
  E301: {
    headline: "These two signals are different sizes",
    detail: "An operation can only combine signals of the same width. Widen the smaller one or slice the larger one.",
  },
  E302: {
    headline: "This function was given the wrong number of arguments",
    detail: "Check the signature of the function and count the arguments.",
  },
  E303: {
    headline: "This signal is the wrong size",
    detail: "A clock, a condition, and a selector are all one bit wide.",
  },
  E304: {
    headline: "This state has no size",
    detail: "Give the state a width, an initial value, or both.",
  },
  E305: {
    headline: "That value does not fit",
    detail: "The value needs more bits than the signal it is written to.",
  },
  E306: {
    headline: "Pick one way to connect the ports",
    detail: "Use all positional arguments or all named arguments, not a mixture.",
  },
  E307: {
    headline: "The wrong number of values were connected",
    detail: "Connect one value for every input of the circuit.",
  },
  E308: {
    headline: "This signal is the wrong size",
    detail: "Slice or widen the signal so it matches the port.",
  },
  E310: {
    headline: "This signal depends on itself",
    detail: "Use a STATE signal and a clocked block when a circuit needs to remember something.",
  },
  E312: {
    headline: "Two clocked blocks write to the same state",
    detail: "Keep one ON block per state and clock edge, and combine the logic inside it.",
  },
  E320: {
    headline: "This design is larger than the limits allow",
    detail: "Reduce the size of the design, or raise the limit for a program you trust.",
  },
  E324: {
    headline: "A circuit cannot contain itself",
    detail: "Break the cycle with a STATE signal instead of another instance.",
  },
  E332: {
    headline: "That would make the value narrower",
    detail: "ZEXT and SEXT only widen a value. Use SLICE(value, 3, 0) to narrow it.",
  },
  E403: {
    headline: "This has to be a whole number",
    detail: "Widths, indexes, and slice bounds are plain numeric literals.",
  },
  W402: {
    headline: "This number could be read two ways",
    detail: "A number made only of 0 and 1 can be decimal or binary. Use the 0b prefix to be explicit.",
  },
};

/**
 * Builds the plain-language layer for a diagnostic. The fix is only offered
 * when the diagnostic carries a suggestion and a known length.
 */
export function plainFor(diagnostic: Diagnostic): PlainDiagnostic | undefined {
  const template = TEMPLATES[diagnostic.code];
  if (!template) return undefined;

  const plain: PlainDiagnostic = {
    headline: template.headline,
    detail: template.detail,
  };

  if (diagnostic.suggestion && diagnostic.length && diagnostic.length > 0) {
    plain.fix = {
      label: `Replace with \`${diagnostic.suggestion}\``,
      text: diagnostic.suggestion,
      line: diagnostic.line,
      column: diagnostic.column,
      length: diagnostic.length,
    };
  }

  return plain;
}
