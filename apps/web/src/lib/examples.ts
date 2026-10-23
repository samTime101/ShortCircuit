export interface Example {
  id: string;
  title: string;
  tag: string;
  level: "Start here" | "Build up" | "Digital systems";
  description: string;
  focusCircuit: string;
  source: string;
}

const HALF_ADDER = `// Short Circuit: the kernel starts with NAND.
// NOT, AND, XOR and the other gates are package macros built from it.
IMPORT "@shortcircuit/gates"

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

const FULL_ADDER = `// A circuit can contain other circuits.
// HalfAdder is elaborated twice inside FullAdder.
IMPORT "@shortcircuit/gates"

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

const ADDER_8 = `// Buses carry several bits. The arithmetic package supplies a
// fixed-width ADD8 circuit; the language has no implicit + operator.
IMPORT "@shortcircuit/arithmetic"

CIRCUIT Adder8
  INPUT a : BUS(8)
  INPUT b : BUS(8)

  added = ADD8(a, b, 0)

  sum = added.sum
  carry_out = added.carry_out

  OUTPUT sum
  OUTPUT carry_out
END

TEST Adder8
  CASE "1 + 2"
    INPUT a = 00000001
    INPUT b = 00000010
    EXPECT sum = 00000011
    EXPECT carry_out = 0
  END
  CASE "carry wraps"
    INPUT a = 11111111
    INPUT b = 00000001
    EXPECT sum = 00000000
    EXPECT carry_out = 1
  END
END
`;

const MUX_4 = `// Hardware chooses with multiplexers, not control flow.
// sel = 00 chooses a, 01 chooses b, 10 chooses c, 11 chooses d.
IMPORT "@shortcircuit/selection"

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

const BUS_WIRING = `// Structural operations move wires without changing their values.
// CONCAT joins buses, slices select bits, and REVERSE flips bit order.

CIRCUIT NibbleSwap
  INPUT data : BUS(8)

  low = data[3:0]
  high = data[7:4]

  swapped = CONCAT(low, high)
  reversed = REVERSE(data)

  OUTPUT swapped
  OUTPUT reversed
END

TEST NibbleSwap
  CASE "swap nibbles"
    INPUT data = 10101100
    EXPECT swapped = 11001010
    EXPECT reversed = 00110101
  END
END
`;

const MAJORITY = `// Every package gate is variadic where that makes sense.
// Majority is true when at least two of the three inputs are true.
IMPORT "@shortcircuit/gates"

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

const BROADCAST_BUS = `// BROADCAST repeats one control bit across a bus. A package MUX
// uses it to apply a one-bit select to every bit of a value.
IMPORT "@shortcircuit/gates"

CIRCUIT GatedBus
  INPUT data : BUS(4)
  INPUT enable

  mask = BROADCAST(enable, data)
  gated = AND(data, mask)

  OUTPUT mask
  OUTPUT gated
END

TEST GatedBus
  CASE "disabled"
    INPUT data = 1010
    INPUT enable = 0
    EXPECT mask = 0000
    EXPECT gated = 0000
  END
  CASE "enabled"
    INPUT data = 1010
    INPUT enable = 1
    EXPECT mask = 1111
    EXPECT gated = 1010
  END
END
`;

const REGISTER_8 = `// State changes only on a clock edge. MUX computes the next value
// from the old state; the edge commits it.
IMPORT "@shortcircuit/selection"

CIRCUIT Register8
  INPUT data : BUS(8)
  INPUT clock
  INPUT enable

  STATE stored : BUS(8) = 0

  next = MUX(stored, data, enable)

  ON RISING_EDGE(clock):
    stored = next
  END

  OUTPUT stored
END

TEST Register8
  CASE "captures data on the rising edge"
    INPUT enable = 1
    INPUT data = 10101010
    STEP
      INPUT clock = 1
    END
    EXPECT stored = 10101010
  END
  CASE "holds the value when enable is low"
    INPUT enable = 0
    INPUT data = 11110000
    STEP
      INPUT clock = 1
    END
    EXPECT stored = 00000000
  END
END
`;

const COUNTER_4 = `// A stateful counter: combinational logic computes the next value,
// then the rising edge of clock commits it.
IMPORT "@shortcircuit/arithmetic"
IMPORT "@shortcircuit/selection"

CIRCUIT Counter4
  INPUT clock
  INPUT reset

  STATE count : BUS(4) = 0000

  incremented = ADD4(count, 0, 1)
  next = MUX(incremented.sum, 0, reset)

  ON RISING_EDGE(clock):
    count = next
  END

  OUTPUT count
END

TEST Counter4
  CASE "counts three ticks"
    INPUT reset = 0
    INPUT clock = 0
    EXPECT count = 0000
    CYCLE clock 3
    EXPECT count = 0011
  END
  CASE "reset clears the count"
    INPUT reset = 0
    CYCLE clock 5
    EXPECT count = 0101
    INPUT reset = 1
    CYCLE clock 1
    EXPECT count = 0000
  END
END
`;

export const EXAMPLES: Example[] = [
  {
    id: "half-adder",
    title: "Half adder",
    tag: "First circuit",
    level: "Start here",
    description: "NAND-derived package gates, two inputs, and exhaustive tests. The shortest path into LogicFlow.",
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
    tag: "Packages",
    level: "Build up",
    description: "A fixed-width package adder, binary literals, and an explicit carry-out.",
    focusCircuit: "Adder8",
    source: ADDER_8,
  },
  {
    id: "mux-4",
    title: "4:1 multiplexer",
    tag: "Selection",
    level: "Build up",
    description: "Compose the package MUX and select a bus bit with index syntax.",
    focusCircuit: "Mux4",
    source: MUX_4,
  },
  {
    id: "bus-wiring",
    title: "Bus wiring",
    tag: "Structure",
    level: "Build up",
    description: "Concatenate, slice, and reverse buses without using a Boolean gate.",
    focusCircuit: "NibbleSwap",
    source: BUS_WIRING,
  },
  {
    id: "majority",
    title: "Majority vote",
    tag: "Variadic gates",
    level: "Start here",
    description: "Multi-input package gates and named intermediates for readable logic.",
    focusCircuit: "MajorityVote",
    source: MAJORITY,
  },
  {
    id: "broadcast-bus",
    title: "Gated bus",
    tag: "BROADCAST",
    level: "Build up",
    description: "Repeat one control bit across a bus and use it as a structural mask.",
    focusCircuit: "GatedBus",
    source: BROADCAST_BUS,
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
    description: "State feeds package adders and MUX logic; an edge commits the new value.",
    focusCircuit: "Counter4",
    source: COUNTER_4,
  },
];

export const DEFAULT_EXAMPLE = EXAMPLES[0]!;
