export type BuiltinCategory =
  | "gate"
  | "arithmetic"
  | "compare"
  | "bus"
  | "selection";

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
    name: "ADD",
    category: "arithmetic",
    minArgs: 2,
    maxArgs: 2,
    description: "Unsigned addition at the widest input width. Carry out is discarded.",
    symbol: "+",
    signature: "ADD(a, b)",
    widthRule: "Result width = common input width; wraps modulo 2^w",
    tip: "Carry out is dropped. Widen the bus if you need the carry.",
    args: [
      { name: "a", description: "First addend." },
      { name: "b", description: "Second addend." },
    ],
    example: {
      call: "ADD(0011, 0101)",
      result: "1000",
      note: "3 + 5 = 8, written in four bits.",
    },
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
    args: [
      { name: "a", description: "The value to subtract from." },
      { name: "b", description: "The value to subtract." },
    ],
    example: {
      call: "SUBTRACT(0000, 0001)",
      result: "1111",
      note: "0 - 1 wraps around to 15 in four bits.",
    },
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
    args: [
      { name: "a", description: "First factor." },
      { name: "b", description: "Second factor." },
    ],
    example: {
      call: "MULTIPLY(0011, 0101)",
      result: "00001111",
      note: "3 x 5 = 15, written in the eight bits the result width gives.",
    },
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
    args: [
      { name: "a", description: "The value to divide." },
      { name: "b", description: "The divisor. It must not be zero." },
    ],
    example: {
      call: "DIVIDE(0011, 0010)",
      result: "0001",
      note: "3 divided by 2 is 1, with the remainder discarded.",
    },
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
    args: [
      { name: "a", description: "First value to compare." },
      { name: "b", description: "Second value to compare." },
    ],
    example: {
      call: "EQUAL(0011, 0011)",
      result: "1",
      note: "The two four-bit values are the same.",
    },
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
    args: [
      { name: "a", description: "The value on the left of the comparison." },
      { name: "b", description: "The value on the right of the comparison." },
    ],
    example: {
      call: "LESS(0010, 0011)",
      result: "1",
      note: "2 is less than 3.",
    },
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
    args: [
      { name: "a", description: "The value on the left of the comparison." },
      { name: "b", description: "The value on the right of the comparison." },
    ],
    example: {
      call: "GREATER(0011, 0010)",
      result: "1",
      note: "3 is greater than 2.",
    },
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
    args: [
      { name: "a", description: "The value on the left of the comparison." },
      { name: "b", description: "The value on the right of the comparison." },
    ],
    example: {
      call: "COMPARE(0011, 0010)",
      result: "10",
      note: "3 is greater than 2, which the two-bit code reports as 10.",
    },
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
    args: [
      { name: "a", description: "Chosen when select is 0." },
      { name: "b", description: "Chosen when select is 1." },
      { name: "select", description: "One-bit choice." },
    ],
    example: {
      call: "MUX(1, 0, 0)",
      result: "1",
      note: "select is 0, so the first input is passed through.",
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
    name: "SHIFT_LEFT",
    category: "bus",
    minArgs: 2,
    maxArgs: 2,
    description: "Shifts toward the MSB, filling with zeroes at the same width.",
    symbol: "<<",
    signature: "SHIFT_LEFT(value, amount)",
    widthRule: "Result width = value width; zero fill",
    tip: "Shifting by at least the width produces 0. Bits shifted out are dropped.",
    args: [
      { name: "value", description: "The value to shift." },
      { name: "amount", description: "How many positions to shift by." },
    ],
    example: {
      call: "SHIFT_LEFT(0001, 2)",
      result: "0100",
      note: "One shifted left twice becomes four.",
    },
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
    args: [
      { name: "value", description: "The value to shift." },
      { name: "amount", description: "How many positions to shift by." },
    ],
    example: {
      call: "SHIFT_RIGHT(0100, 1)",
      result: "0010",
      note: "Four shifted right once becomes two.",
    },
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
    args: [{ name: "select", description: "The value to decode into one-hot bits." }],
    example: {
      call: "DECODER(010)",
      result: "00100",
      note: "The value 2 sets the third of the five output bits.",
    },
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
    args: [{ name: "value", description: "The bus to encode." }],
    example: {
      call: "ENCODER(0100)",
      result: "10",
      note: "The highest set bit is bit 2, which is written 10 in two bits.",
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
    name: "POPCOUNT",
    category: "bus",
    minArgs: 1,
    maxArgs: 1,
    description: "Counts the bits that are set.",
    symbol: "∑",
    signature: "POPCOUNT(x)",
    widthRule: "Result width = ceil(log2(width + 1))",
    tip: "Counts the ones in a bus. Handy for neighbour counts and parity checks.",
    args: [{ name: "x", description: "The bus to count." }],
    example: {
      call: "POPCOUNT(00001111)",
      result: "0100",
      note: "Four bits are set, and four is written 0100 in four bits.",
    },
  },
  {
    name: "REDUCE_AND",
    category: "bus",
    minArgs: 1,
    maxArgs: 1,
    description: "1 only when every bit of the input is 1.",
    symbol: "∧",
    signature: "REDUCE_AND(x)",
    widthRule: "Result width = 1",
    tip: "Folds a bus into a single bit: all ones.",
    args: [{ name: "x", description: "The bus to fold." }],
    example: {
      call: "REDUCE_AND(1111)",
      result: "1",
      note: "Every bit is high, so the folded result is high.",
    },
  },
  {
    name: "REDUCE_OR",
    category: "bus",
    minArgs: 1,
    maxArgs: 1,
    description: "1 when any bit of the input is 1.",
    symbol: "∨",
    signature: "REDUCE_OR(x)",
    widthRule: "Result width = 1",
    tip: "Folds a bus into a single bit: any one.",
    args: [{ name: "x", description: "The bus to fold." }],
    example: {
      call: "REDUCE_OR(0001)",
      result: "1",
      note: "One bit is high, so the folded result is high.",
    },
  },
  {
    name: "REDUCE_XOR",
    category: "bus",
    minArgs: 1,
    maxArgs: 1,
    description: "Parity of the input bits.",
    symbol: "⊻",
    signature: "REDUCE_XOR(x)",
    widthRule: "Result width = 1",
    tip: "Folds a bus into a single bit: odd or even parity.",
    args: [{ name: "x", description: "The bus to fold." }],
    example: {
      call: "REDUCE_XOR(0011)",
      result: "0",
      note: "Two bits are high, which is even parity.",
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
  return KEYWORDS.has(upper) || BUILTIN_BY_NAME.has(upper);
}

export function builtinLabel(spec: BuiltinSpec): string {
  return spec.name;
}
