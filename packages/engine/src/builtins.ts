export type BuiltinCategory =
  | "gate"
  | "arithmetic"
  | "compare"
  | "bus"
  | "selection";

export interface BuiltinSpec {
  name: string;
  category: BuiltinCategory;
  minArgs: number;
  maxArgs: number;
  description: string;
  symbol: string;
  /** Callable shape, for example "AND(a, b, ...)". */
  signature: string;
  /** How the result width is decided. */
  widthRule: string;
  /** Short practical tip shown in editors and documentation. */
  tip: string;
}

export const BUILTINS: BuiltinSpec[] = [
  {
    name: "AND",
    category: "gate",
    minArgs: 2,
    maxArgs: Number.POSITIVE_INFINITY,
    description: "Bitwise AND. Result is 1 where every input bit is 1.",
    symbol: "&",
    signature: "AND(a, b, ...)",
    widthRule: "Result width = common input width",
    tip: "Variadic: AND(a, b, c) is one three-input gate, not a chain of two-input gates.",
  },
  {
    name: "OR",
    category: "gate",
    minArgs: 2,
    maxArgs: Number.POSITIVE_INFINITY,
    description: "Bitwise OR. Result is 1 where any input bit is 1.",
    symbol: "≥1",
    signature: "OR(a, b, ...)",
    widthRule: "Result width = common input width",
    tip: "Variadic. Useful for summing several conditions into one signal.",
  },
  {
    name: "XOR",
    category: "gate",
    minArgs: 2,
    maxArgs: Number.POSITIVE_INFINITY,
    description: "Bitwise XOR. Result is 1 where an odd number of inputs are 1.",
    symbol: "=1",
    signature: "XOR(a, b, ...)",
    widthRule: "Result width = common input width",
    tip: "Parity: XOR(a, b, c) is 1 when an odd number of the bits are set.",
  },
  {
    name: "NAND",
    category: "gate",
    minArgs: 2,
    maxArgs: Number.POSITIVE_INFINITY,
    description: "Inverse of multi-input AND.",
    symbol: "&̄",
    signature: "NAND(a, b, ...)",
    widthRule: "Result width = common input width",
    tip: "Negates the whole multi-input AND; it is not a chain of two-input NANDs.",
  },
  {
    name: "NOR",
    category: "gate",
    minArgs: 2,
    maxArgs: Number.POSITIVE_INFINITY,
    description: "Inverse of multi-input OR.",
    symbol: "≥̄1",
    signature: "NOR(a, b, ...)",
    widthRule: "Result width = common input width",
    tip: "Negates the whole multi-input OR. Handy for \"none of these\" conditions.",
  },
  {
    name: "XNOR",
    category: "gate",
    minArgs: 2,
    maxArgs: Number.POSITIVE_INFINITY,
    description: "Inverse of multi-input XOR.",
    symbol: "=̄1",
    signature: "XNOR(a, b, ...)",
    widthRule: "Result width = common input width",
    tip: "Equality per bit. Two inputs gives an equality check.",
  },
  {
    name: "NOT",
    category: "gate",
    minArgs: 1,
    maxArgs: 1,
    description: "Bitwise inversion of one input.",
    symbol: "!",
    signature: "NOT(x)",
    widthRule: "Result width = input width",
    tip: "Exactly one input. NOT(a) inverts every bit of a bus.",
  },
  {
    name: "BUFFER",
    category: "gate",
    minArgs: 1,
    maxArgs: 1,
    description: "Passes its input through unchanged.",
    symbol: "▷",
    signature: "BUFFER(x)",
    widthRule: "Result width = input width",
    tip: "Names a wire explicitly. Keeps a graph readable when a signal is only a rename.",
  },
  {
    name: "ADD",
    category: "arithmetic",
    minArgs: 2,
    maxArgs: 2,
    description: "Unsigned addition at the widest input width. Carry out is discarded.",
    symbol: "+",
    signature: "ADD(a, b)",
    widthRule: "Result width = common input width; wraps modulo 2^w",
    tip: "Carry out is dropped. Widen the bus if you need the carry.",
  },
  {
    name: "SUBTRACT",
    category: "arithmetic",
    minArgs: 2,
    maxArgs: 2,
    description: "Unsigned modulo subtraction at the widest input width.",
    symbol: "−",
    signature: "SUBTRACT(a, b)",
    widthRule: "Result width = common input width; wraps modulo 2^w",
    tip: "Borrow is dropped, so 0 - 1 wraps to the largest value.",
  },
  {
    name: "MULTIPLY",
    category: "arithmetic",
    minArgs: 2,
    maxArgs: 2,
    description: "Unsigned multiplication. Result width is the sum of input widths.",
    symbol: "×",
    signature: "MULTIPLY(a, b)",
    widthRule: "Result width = 2 x common input width; the full product is kept",
    tip: "8-bit x 8-bit gives a 16-bit result, so give the output room.",
  },
  {
    name: "DIVIDE",
    category: "arithmetic",
    minArgs: 2,
    maxArgs: 2,
    description: "Unsigned integer division at the widest input width.",
    symbol: "÷",
    signature: "DIVIDE(a, b)",
    widthRule: "Result width = common input width; unsigned floor division",
    tip: "Guard the divisor. A zero divisor is a runtime error (R500), not a silent zero.",
  },
  {
    name: "EQUAL",
    category: "compare",
    minArgs: 2,
    maxArgs: 2,
    description: "1 when all inputs are equal, otherwise 0.",
    symbol: "==",
    signature: "EQUAL(a, b)",
    widthRule: "1-bit result; operands are compared as unsigned integers",
    tip: "Literals are fitted to the bus width, so EQUAL(data, 0) checks the whole bus.",
  },
  {
    name: "LESS",
    category: "compare",
    minArgs: 2,
    maxArgs: 2,
    description: "1 when the first input is less than the second.",
    symbol: "<",
    signature: "LESS(a, b)",
    widthRule: "1-bit result; unsigned comparison",
    tip: "Unsigned comparison. Use COMPARE when you need less/equal/greater together.",
  },
  {
    name: "GREATER",
    category: "compare",
    minArgs: 2,
    maxArgs: 2,
    description: "1 when the first input is greater than the second.",
    symbol: ">",
    signature: "GREATER(a, b)",
    widthRule: "1-bit result; unsigned comparison",
    tip: "Unsigned comparison, the mirror of LESS.",
  },
  {
    name: "COMPARE",
    category: "compare",
    minArgs: 2,
    maxArgs: 2,
    description: "Two-bit compare: 00 equal, 01 less, 10 greater.",
    symbol: "≶",
    signature: "COMPARE(a, b)",
    widthRule: "2-bit result: 00 equal, 01 less, 10 greater",
    tip: "One comparison, three outcomes. Slice the bits you need.",
  },
  {
    name: "MUX",
    category: "selection",
    minArgs: 3,
    maxArgs: 3,
    description: "MUX(a, b, select): select 0 chooses a, select 1 chooses b.",
    symbol: "MUX",
    signature: "MUX(a, b, select)",
    widthRule: "Result width = common width of a and b; select must be 1 bit",
    tip: "Hardware selection. Chain MUXes for wider selects, and slice a bus for the select bit.",
  },
  {
    name: "CONCAT",
    category: "bus",
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    description: "Joins buses most-significant argument first.",
    symbol: "‖",
    signature: "CONCAT(a, b, ...)",
    widthRule: "Result width = sum of the operand widths",
    tip: "The first argument ends up in the high bits: CONCAT(hi, lo).",
  },
  {
    name: "SLICE",
    category: "bus",
    minArgs: 3,
    maxArgs: 3,
    description: "SLICE(value, hi, lo), inclusive, down to bit 0.",
    symbol: "⌁",
    signature: "SLICE(value, hi, lo)",
    widthRule: "Result width = hi - lo + 1; bounds are inclusive",
    tip: "Same as value[hi:lo]. Bounds must be plain decimal literals.",
  },
  {
    name: "SHIFT_LEFT",
    category: "bus",
    minArgs: 2,
    maxArgs: 2,
    description: "Shifts toward the MSB, filling with zeroes at the same width.",
    symbol: "<<",
    signature: "SHIFT_LEFT(value, amount)",
    widthRule: "Result width = value width; zero fill",
    tip: "Shifting by at least the width produces 0. Bits shifted out are dropped.",
  },
  {
    name: "SHIFT_RIGHT",
    category: "bus",
    minArgs: 2,
    maxArgs: 2,
    description: "Shifts toward the LSB, filling with zeroes at the same width.",
    symbol: ">>",
    signature: "SHIFT_RIGHT(value, amount)",
    widthRule: "Result width = value width; zero fill",
    tip: "Logical shift, never arithmetic. Shifting by at least the width produces 0.",
  },
  {
    name: "DECODER",
    category: "selection",
    minArgs: 1,
    maxArgs: 1,
    description: "One-hot decoder. A w-bit select produces 2^w output bits.",
    symbol: "DEC",
    signature: "DECODER(select)",
    widthRule: "Result width = 2^w for a w-bit select",
    tip: "One-hot output. A 12-bit select is the widest that fits the 4096-bit limit.",
  },
  {
    name: "ENCODER",
    category: "selection",
    minArgs: 1,
    maxArgs: 1,
    description: "Highest-set-bit encoder. Output width is ceil(log2(input width)).",
    symbol: "ENC",
    signature: "ENCODER(value)",
    widthRule: "Result width = max(1, ceil(log2(input width)))",
    tip: "Returns the index of the highest set bit. Zero encodes to zero.",
  },
];

export const BUILTIN_BY_NAME = new Map(BUILTINS.map((spec) => [spec.name, spec]));

export function lookupBuiltin(name: string): BuiltinSpec | undefined {
  return BUILTIN_BY_NAME.get(name.toUpperCase());
}

export interface IntrinsicCircuit {
  name: string;
  inputs: string[];
  outputs: string[];
  description: string;
  signature: string;
  widthRule: string;
  tip: string;
}

/** Circuit-shaped built-ins. They elaborate to primitive gates, not opaque boxes. */
export const INTRINSIC_CIRCUITS: IntrinsicCircuit[] = [
  {
    name: "HALF_ADDER",
    inputs: ["a", "b"],
    outputs: ["sum", "carry"],
    description: "One-bit half adder: sum = XOR(a, b), carry = AND(a, b).",
    signature: "HALF_ADDER(a, b) -> sum, carry",
    widthRule: "All ports are 1 bit",
    tip: "Elaborates to real gates in the graph, so you can inspect the internals.",
  },
  {
    name: "FULL_ADDER",
    inputs: ["a", "b", "carry_in"],
    outputs: ["sum", "carry_out"],
    description: "One-bit full adder built from two half adders and an OR gate.",
    signature: "FULL_ADDER(a, b, carry_in) -> sum, carry_out",
    widthRule: "All ports are 1 bit",
    tip: "Built from two half adders. Chain them for ripple-carry addition.",
  },
];

export const INTRINSIC_BY_NAME = new Map(
  INTRINSIC_CIRCUITS.map((circuit) => [circuit.name, circuit]),
);

export function lookupIntrinsic(name: string): IntrinsicCircuit | undefined {
  return INTRINSIC_BY_NAME.get(name.toUpperCase());
}

export const KEYWORDS = new Set([
  "CIRCUIT",
  "END",
  "INPUT",
  "OUTPUT",
  "STATE",
  "ON",
  "RISING_EDGE",
  "FALLING_EDGE",
  "IF",
  "ELSE",
  "TEST",
  "CASE",
  "EXPECT",
  "BUS",
  "WHEN",
  "SELECT",
]);

/** Built-in names are case-insensitive and cannot be redefined as signals. */
export function isReservedName(name: string): boolean {
  const upper = name.toUpperCase();
  return KEYWORDS.has(upper) || BUILTIN_BY_NAME.has(upper) || INTRINSIC_BY_NAME.has(upper);
}

export function builtinLabel(spec: BuiltinSpec): string {
  return spec.name;
}
