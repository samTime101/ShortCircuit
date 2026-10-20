export interface Example {
  id: string;
  title: string;
  tag: string;
  level: "Start here" | "Build up" | "Digital systems";
  description: string;
  focusCircuit: string;
  source: string;
}

const HALF_ADDER = `# Short Circuit — LogicFlow 0.1
# Assignments describe wires in a graph, not steps in a program.

CIRCUIT HalfAdder

INPUT a
INPUT b

sum = XOR(a, b)
carry = AND(a, b)

OUTPUT sum
OUTPUT carry

END

TEST HalfAdder

CASE "0 + 0"
  INPUT a = 0
  INPUT b = 0
  EXPECT sum = 0
  EXPECT carry = 0
END

CASE "0 + 1"
  INPUT a = 0
  INPUT b = 1
  EXPECT sum = 1
  EXPECT carry = 0
END

CASE "1 + 1"
  INPUT a = 1
  INPUT b = 1
  EXPECT sum = 0
  EXPECT carry = 1
END

END
`;

const FULL_ADDER = `# A circuit can contain other circuits.
# HalfAdder is elaborated twice inside FullAdder.

CIRCUIT HalfAdder

INPUT a
INPUT b

sum = XOR(a, b)
carry = AND(a, b)

OUTPUT sum
OUTPUT carry

END


CIRCUIT FullAdder

INPUT a
INPUT b
INPUT carry_in

first = HalfAdder(a, b)
second = HalfAdder(first.sum, carry_in)

sum = second.sum
carry_out = OR(first.carry, second.carry)

OUTPUT sum
OUTPUT carry_out

END


TEST FullAdder

CASE "0 + 1 + 0"
  INPUT a = 0
  INPUT b = 1
  INPUT carry_in = 0
  EXPECT sum = 1
  EXPECT carry_out = 0
END

CASE "1 + 1 + 0"
  INPUT a = 1
  INPUT b = 1
  INPUT carry_in = 0
  EXPECT sum = 0
  EXPECT carry_out = 1
END

CASE "1 + 1 + 1"
  INPUT a = 1
  INPUT b = 1
  INPUT carry_in = 1
  EXPECT sum = 1
  EXPECT carry_out = 1
END

END
`;

const ADDER_8 = `# Buses carry several bits. ADD uses the widest input width;
# overflow beyond bit 7 wraps by the documented width policy.

CIRCUIT Adder8

INPUT a : BUS(8)
INPUT b : BUS(8)

sum = ADD(a, b)

OUTPUT sum

END


TEST Adder8

CASE "1 + 2"
  INPUT a = 00000001
  INPUT b = 00000010
  EXPECT sum = 00000011
END

CASE "carry wraps"
  INPUT a = 11111111
  INPUT b = 00000001
  EXPECT sum = 00000000
END

CASE "150 + 100"
  INPUT a = 10010110
  INPUT b = 01100100
  EXPECT sum = 11111010
END

END
`;

const MUX_4 = `# Hardware chooses with multiplexers, not IF statements.
# sel = 00 → a, 01 → b, 10 → c, 11 → d

CIRCUIT Mux4

INPUT a
INPUT b
INPUT c
INPUT d
INPUT sel : BUS(2)

low = MUX(a, b, sel[0])
high = MUX(c, d, sel[0])
result = MUX(low, high, sel[1])

OUTPUT result

END


TEST Mux4

CASE "select a"
  INPUT a = 1
  INPUT b = 0
  INPUT c = 0
  INPUT d = 0
  INPUT sel = 00
  EXPECT result = 1
END

CASE "select b"
  INPUT a = 0
  INPUT b = 1
  INPUT c = 0
  INPUT d = 0
  INPUT sel = 01
  EXPECT result = 1
END

CASE "select c"
  INPUT a = 0
  INPUT b = 0
  INPUT c = 1
  INPUT d = 0
  INPUT sel = 10
  EXPECT result = 1
END

CASE "select d"
  INPUT a = 0
  INPUT b = 0
  INPUT c = 0
  INPUT d = 1
  INPUT sel = 11
  EXPECT result = 1
END

END
`;

const MAJORITY = `# Every logic gate is variadic where that makes mathematical sense.
# Majority is true when at least two of the three inputs are true.

CIRCUIT MajorityVote

INPUT a
INPUT b
INPUT c

pair_ab = AND(a, b)
pair_bc = AND(b, c)
pair_ac = AND(a, c)

majority = OR(pair_ab, pair_bc, pair_ac)

OUTPUT majority

END


TEST MajorityVote

CASE "no votes"
  INPUT a = 0
  INPUT b = 0
  INPUT c = 0
  EXPECT majority = 0
END

CASE "two votes"
  INPUT a = 1
  INPUT b = 0
  INPUT c = 1
  EXPECT majority = 1
END

CASE "three votes"
  INPUT a = 1
  INPUT b = 1
  INPUT c = 1
  EXPECT majority = 1
END

END
`;

const ALU_8 = `# An ALU built from arithmetic, gates, comparisons and MUXes.
# op = 00 AND · 01 OR · 10 ADD · 11 SUBTRACT

CIRCUIT ALU8

INPUT a : BUS(8)
INPUT b : BUS(8)
INPUT op : BUS(2)

sum = ADD(a, b)
difference = SUBTRACT(a, b)
band = AND(a, b)
bor = OR(a, b)

logic_result = MUX(band, bor, op[0])
math_result = MUX(sum, difference, op[0])
result = MUX(logic_result, math_result, op[1])

zero = EQUAL(result, 0)

OUTPUT result
OUTPUT zero

END


TEST ALU8

CASE "bitwise AND"
  INPUT a = 00001111
  INPUT b = 00110000
  INPUT op = 00
  EXPECT result = 00000000
  EXPECT zero = 1
END

CASE "bitwise OR"
  INPUT a = 00001111
  INPUT b = 00110000
  INPUT op = 01
  EXPECT result = 00111111
END

CASE "addition"
  INPUT a = 00000101
  INPUT b = 00000011
  INPUT op = 10
  EXPECT result = 00001000
END

CASE "subtraction"
  INPUT a = 00001000
  INPUT b = 00000011
  INPUT op = 11
  EXPECT result = 00000101
END

END
`;

const REGISTER_8 = `# State changes only on a clock edge. Everything inside the
# IF is sampled against the old state, then committed together.

CIRCUIT Register8

INPUT data : BUS(8)
INPUT clock
INPUT enable

STATE stored : BUS(8) = 0

ON RISING_EDGE(clock):
  IF enable:
    stored = data
  END
END

OUTPUT stored

END
`;

const COUNTER_4 = `# A stateful counter: combinational logic computes next,
# then the rising edge of clock commits it.

CIRCUIT Counter4

INPUT clock
INPUT reset

STATE count : BUS(4) = 0000

next = ADD(count, 1)

ON RISING_EDGE(clock):
  IF reset:
    count = 0
  ELSE:
    count = next
  END
END

OUTPUT count

END
`;

export const EXAMPLES: Example[] = [
  {
    id: "half-adder",
    title: "Half adder",
    tag: "First circuit",
    level: "Start here",
    description: "Two gates, two inputs, four exhaustive tests. The shortest path into LogicFlow.",
    focusCircuit: "HalfAdder",
    source: HALF_ADDER,
  },
  {
    id: "full-adder",
    title: "Full adder",
    tag: "Composition",
    level: "Build up",
    description: "Instantiates a half adder twice and exposes named instance outputs.",
    focusCircuit: "FullAdder",
    source: FULL_ADDER,
  },
  {
    id: "adder-8",
    title: "8-bit adder",
    tag: "Buses",
    level: "Build up",
    description: "A documented modular width policy, binary literals, and overflow tests.",
    focusCircuit: "Adder8",
    source: ADDER_8,
  },
  {
    id: "mux-4",
    title: "4:1 multiplexer",
    tag: "Selection",
    level: "Build up",
    description: "Compose MUX components and select a bus bit with index syntax.",
    focusCircuit: "Mux4",
    source: MUX_4,
  },
  {
    id: "majority",
    title: "Majority vote",
    tag: "Variadic gates",
    level: "Start here",
    description: "Multi-input operations and named intermediate signals for readable logic.",
    focusCircuit: "MajorityVote",
    source: MAJORITY,
  },
  {
    id: "alu-8",
    title: "ALU8",
    tag: "Digital system",
    level: "Digital systems",
    description: "Arithmetic, bitwise logic, comparison, and nested MUXes in one component.",
    focusCircuit: "ALU8",
    source: ALU_8,
  },
  {
    id: "register-8",
    title: "Register 8",
    tag: "Sequential",
    level: "Digital systems",
    description: "A rising-edge register with enable, stored state, and live clock simulation.",
    focusCircuit: "Register8",
    source: REGISTER_8,
  },
  {
    id: "counter-4",
    title: "Counter 4",
    tag: "Clocked",
    level: "Digital systems",
    description: "State feeds combinational next-state logic; an edge commits the new value.",
    focusCircuit: "Counter4",
    source: COUNTER_4,
  },
];

export const DEFAULT_EXAMPLE = EXAMPLES[0]!;
