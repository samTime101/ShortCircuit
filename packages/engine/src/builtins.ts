export type BuiltinCategory = "gate" | "bus";

/** One argument of a built-in operation. */
export interface BuiltinArgument {
  name: string;
  description: string;
  optional?: boolean;
}

/** A worked example with the value the operation produces. */
export interface BuiltinExample {
  /** The call, written the way it appears in source. */
  call: string;
  /** The result, in binary, with the width it is produced at. */
  result: string;
  /** A short sentence explaining the example. */
  note: string;
}

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
  /** Every argument, in order. */
  args: BuiltinArgument[];
  /** A worked example with its expected value. */
  example: BuiltinExample;
}

export const BUILTINS: BuiltinSpec[] = [
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
    args: [
      { name: "a", description: "First input." },
      { name: "b", description: "Second input." },
      { name: "...", description: "Further inputs, all combined into one gate.", optional: true },
    ],
    example: {
      call: "NAND(1, 1)",
      result: "0",
      note: "AND of two high bits is 1, and NAND inverts that to 0.",
    },
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
    args: [
      { name: "a", description: "The part that ends up in the high bits." },
      { name: "b", description: "The part that ends up in the low bits." },
      { name: "...", description: "Further parts, placed below the previous one.", optional: true },
    ],
    example: {
      call: "CONCAT(1010, 0101)",
      result: "10100101",
      note: "The first argument occupies the high nibble.",
    },
  },
  {
    name: "BROADCAST",
    category: "bus",
    minArgs: 2,
    maxArgs: 2,
    description: "Repeats a one-bit control to the width of another value.",
    symbol: "⇉",
    signature: "BROADCAST(bit, value)",
    widthRule: "Result width = width of value; bit must be 1 bit",
    tip: "Use it to apply a single control bit to every bit of a bus, as package MUX does.",
    args: [
      { name: "bit", description: "The one-bit value to repeat." },
      { name: "value", description: "The value whose width is used." },
    ],
    example: {
      call: "BROADCAST(1, 0000)",
      result: "1111",
      note: "The control bit is repeated to the four-bit width of value.",
    },
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
    args: [
      { name: "value", description: "The bus to read from." },
      { name: "hi", description: "Highest bit to keep." },
      { name: "lo", description: "Lowest bit to keep." },
    ],
    example: {
      call: "SLICE(10100101, 7, 4)",
      result: "1010",
      note: "Bits 7 down to 4 are the high nibble.",
    },
  },
  {
    name: "ZEXT",
    category: "bus",
    minArgs: 2,
    maxArgs: 2,
    description: "Zero-extends a value to a wider bus.",
    symbol: "⇈",
    signature: "ZEXT(x, width)",
    widthRule: "Result width = the requested width, which must not be smaller than x",
    tip: "Pads with zeroes on the left. Use it to widen a signal so it matches a wider bus.",
    args: [
      { name: "x", description: "The value to widen." },
      { name: "width", description: "The width to widen it to." },
    ],
    example: {
      call: "ZEXT(1010, 8)",
      result: "00001010",
      note: "Four zeroes are added on the left.",
    },
  },
  {
    name: "SEXT",
    category: "bus",
    minArgs: 2,
    maxArgs: 2,
    description: "Sign-extends a value by repeating its top bit.",
    symbol: "⇈s",
    signature: "SEXT(x, width)",
    widthRule: "Result width = the requested width, which must not be smaller than x",
    tip: "Repeats the most significant bit, the usual two's-complement widening.",
    args: [
      { name: "x", description: "The value to widen." },
      { name: "width", description: "The width to widen it to." },
    ],
    example: {
      call: "SEXT(1010, 8)",
      result: "11111010",
      note: "The top bit is 1, so it is repeated across the new bits.",
    },
  },
  {
    name: "REPEAT",
    category: "bus",
    minArgs: 2,
    maxArgs: 2,
    description: "Concatenates a value with itself a number of times.",
    symbol: "×n",
    signature: "REPEAT(x, count)",
    widthRule: "Result width = count x width of x",
    tip: "Builds a repeated pattern, such as an alternating mask.",
    args: [
      { name: "x", description: "The value to repeat." },
      { name: "count", description: "How many times to repeat it." },
    ],
    example: {
      call: "REPEAT(1010, 2)",
      result: "10101010",
      note: "The four-bit value is written twice.",
    },
  },
  {
    name: "REVERSE",
    category: "bus",
    minArgs: 1,
    maxArgs: 1,
    description: "Reverses the bit order of a value.",
    symbol: "↔",
    signature: "REVERSE(x)",
    widthRule: "Result width = width of x",
    tip: "Swaps the most and least significant bits. Handy for bit-reversed addressing.",
    args: [{ name: "x", description: "The value to reverse." }],
    example: {
      call: "REVERSE(00000001)",
      result: "10000000",
      note: "The only set bit moves from the bottom to the top.",
    },
  },
];

export const BUILTIN_BY_NAME = new Map(BUILTINS.map((spec) => [spec.name, spec]));

export function lookupBuiltin(name: string): BuiltinSpec | undefined {
  return BUILTIN_BY_NAME.get(name.toUpperCase());
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
  "TEST",
  "CASE",
  "EXPECT",
  "LOAD",
  "STEP",
  "CYCLE",
  "IMPORT",
  "AS",
  "BUS",
]);

/** Built-in names are case-insensitive and cannot be redefined as signals. */
export function isReservedName(name: string): boolean {
  const upper = name.toUpperCase();
  return KEYWORDS.has(upper) || BUILTIN_BY_NAME.has(upper);
}

export function builtinLabel(spec: BuiltinSpec): string {
  return spec.name;
}
