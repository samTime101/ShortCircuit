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

const CELL_GRID = `# Compile-time constants and loops stamp out repeated structure.
# Changing W gives a wider grid with no other edits.

CONST W = 4

CIRCUIT Cell
  INPUT a
  OUTPUT doubled
  doubled = AND(a, a)
END

CIRCUIT CellGrid
  INPUT data : BUS(W)

  FOR i IN 0..W-1
    cell[i] = Cell(data[i])
  END

  OUTPUT cell[0].doubled
  OUTPUT cell[1].doubled
  OUTPUT cell[2].doubled
  OUTPUT cell[3].doubled
END
`;

const PARAMETERIZED = `# One definition, many sizes.
# The parameter is a compile-time number, so each copy has its own width.

CIRCUIT Register(N = 8)
  INPUT data : BUS(N)
  INPUT clock

  STATE q : BUS(N) = 0

  ON RISING_EDGE(clock):
    q = data
  END

  OUTPUT q
END

CIRCUIT RegisterPair
  INPUT wide : BUS(16)
  INPUT clock

  low = Register(data = wide[7:0], clock = clock)
  high = Register<16>(data = wide, clock = clock)

  OUTPUT low.q
  OUTPUT high.q
END
`;

const SEVEN_SEGMENT = `# A four-bit value drives a seven-segment display.
# The segments are named the way a display is: a is the top bar.

CIRCUIT SevenSegment
  INPUT value : BUS(4)

  OUTPUT a
  OUTPUT b
  OUTPUT c
  OUTPUT d
  OUTPUT e
  OUTPUT f
  OUTPUT g

  a = OR(EQUAL(value, 0), EQUAL(value, 2), EQUAL(value, 3), EQUAL(value, 5), EQUAL(value, 6), EQUAL(value, 7), EQUAL(value, 8), EQUAL(value, 9))
  b = OR(EQUAL(value, 0), EQUAL(value, 1), EQUAL(value, 2), EQUAL(value, 3), EQUAL(value, 4), EQUAL(value, 7), EQUAL(value, 8), EQUAL(value, 9))
  c = OR(EQUAL(value, 0), EQUAL(value, 1), EQUAL(value, 3), EQUAL(value, 4), EQUAL(value, 5), EQUAL(value, 6), EQUAL(value, 7), EQUAL(value, 8), EQUAL(value, 9))
  d = OR(EQUAL(value, 0), EQUAL(value, 2), EQUAL(value, 3), EQUAL(value, 5), EQUAL(value, 6), EQUAL(value, 8), EQUAL(value, 9))
  e = OR(EQUAL(value, 0), EQUAL(value, 2), EQUAL(value, 6), EQUAL(value, 8))
  f = OR(EQUAL(value, 0), EQUAL(value, 4), EQUAL(value, 5), EQUAL(value, 6), EQUAL(value, 8), EQUAL(value, 9))
  g = OR(EQUAL(value, 2), EQUAL(value, 3), EQUAL(value, 4), EQUAL(value, 5), EQUAL(value, 6), EQUAL(value, 8), EQUAL(value, 9))
END

TEST SevenSegment
CASE "zero lights six segments"
  INPUT value = 0b0000
  EXPECT a = 1
  EXPECT b = 1
  EXPECT c = 1
  EXPECT d = 1
  EXPECT e = 1
  EXPECT f = 1
  EXPECT g = 0
END

CASE "eight lights every segment"
  INPUT value = 0b1000
  EXPECT a = 1
  EXPECT b = 1
  EXPECT c = 1
  EXPECT d = 1
  EXPECT e = 1
  EXPECT f = 1
  EXPECT g = 1
END
END
`;

const TRAFFIC = `# A traffic light is a tiny state machine.
# The phase counts 0 red, 1 amber, 2 green, and wraps back to red.

CIRCUIT TrafficLight
  INPUT clock
  INPUT reset

  OUTPUT red
  OUTPUT amber
  OUTPUT green

  STATE phase : BUS(2) = 00

  stepped = ADD(phase, 1)
  wrapped = MUX(stepped, 0b00, EQUAL(stepped, 3))

  ON RISING_EDGE(clock):
    IF reset:
      phase = 0b00
    ELSE:
      phase = wrapped
    END
  END

  red = EQUAL(phase, 0)
  amber = EQUAL(phase, 1)
  green = EQUAL(phase, 2)
END

TEST TrafficLight
CASE "starts on red"
  INPUT clock = 0
  INPUT reset = 0
  EXPECT red = 1
  EXPECT amber = 0
  EXPECT green = 0
END

CASE "moves to amber"
  INPUT clock = 0
  INPUT clock = 1
  EXPECT red = 0
  EXPECT amber = 1
  EXPECT green = 0
END

CASE "moves to green"
  INPUT clock = 0
  INPUT clock = 1
  INPUT clock = 0
  INPUT clock = 1
  EXPECT red = 0
  EXPECT amber = 0
  EXPECT green = 1
END
END
`;

const LOCK = `# A four-bit keypad code opens the lock.
# The secret is 1011, and a wrong code is denied.

CIRCUIT Lock
  INPUT code : BUS(4)
  INPUT try
  OUTPUT unlocked
  OUTPUT denied

  unlocked = AND(try, EQUAL(code, 0b1011))
  denied = AND(try, NOT(unlocked))
END

TEST Lock
CASE "the right code opens it"
  INPUT code = 0b1011
  INPUT try = 1
  EXPECT unlocked = 1
  EXPECT denied = 0
END

CASE "a wrong code is denied"
  INPUT code = 0b0101
  INPUT try = 1
  EXPECT unlocked = 0
  EXPECT denied = 1
END

CASE "nothing happens without trying"
  INPUT code = 0b1011
  INPUT try = 0
  EXPECT unlocked = 0
  EXPECT denied = 0
END
END
`;

const SEQUENCE = `# A shift register that spots the pattern 1011.
# The state remembers how much of the pattern has matched so far.

CIRCUIT SequenceDetector
  INPUT bit
  INPUT clock
  OUTPUT found

  STATE matched : BUS(3) = 0b000

  ON RISING_EDGE(clock):
    IF EQUAL(matched, 0b000):
      IF EQUAL(bit, 1):
        matched = 0b001
      ELSE:
        matched = 0b000
      END
    ELSE:
      IF EQUAL(matched, 0b001):
        IF EQUAL(bit, 0):
          matched = 0b010
        ELSE:
          matched = 0b001
        END
      ELSE:
        IF EQUAL(matched, 0b010):
          IF EQUAL(bit, 1):
            matched = 0b011
          ELSE:
            matched = 0b000
          END
        ELSE:
          IF EQUAL(matched, 0b011):
            IF EQUAL(bit, 1):
              matched = 0b100
            ELSE:
              matched = 0b000
            END
          ELSE:
            IF EQUAL(bit, 1):
              matched = 0b001
            ELSE:
              matched = 0b000
            END
          END
        END
      END
    END
  END

  found = EQUAL(matched, 0b100)
END

TEST SequenceDetector
CASE "the pattern is spotted"
  INPUT bit = 1
  CYCLE clock 1
  INPUT bit = 0
  CYCLE clock 1
  INPUT bit = 1
  CYCLE clock 1
  INPUT bit = 1
  CYCLE clock 1
  EXPECT found = 1
END

CASE "a different pattern is not"
  INPUT bit = 1
  CYCLE clock 1
  INPUT bit = 0
  CYCLE clock 1
  INPUT bit = 0
  CYCLE clock 1
  EXPECT found = 0
END
END
`;

const TALLY = `# A tally counter that shows its count on a seven-segment display.
# The count runs from zero to nine and then starts over.

CIRCUIT SevenSegment
  INPUT value : BUS(4)

  OUTPUT a
  OUTPUT b
  OUTPUT c
  OUTPUT d
  OUTPUT e
  OUTPUT f
  OUTPUT g

  a = OR(EQUAL(value, 0), EQUAL(value, 2), EQUAL(value, 3), EQUAL(value, 5), EQUAL(value, 6), EQUAL(value, 7), EQUAL(value, 8), EQUAL(value, 9))
  b = OR(EQUAL(value, 0), EQUAL(value, 1), EQUAL(value, 2), EQUAL(value, 3), EQUAL(value, 4), EQUAL(value, 7), EQUAL(value, 8), EQUAL(value, 9))
  c = OR(EQUAL(value, 0), EQUAL(value, 1), EQUAL(value, 3), EQUAL(value, 4), EQUAL(value, 5), EQUAL(value, 6), EQUAL(value, 7), EQUAL(value, 8), EQUAL(value, 9))
  d = OR(EQUAL(value, 0), EQUAL(value, 2), EQUAL(value, 3), EQUAL(value, 5), EQUAL(value, 6), EQUAL(value, 8), EQUAL(value, 9))
  e = OR(EQUAL(value, 0), EQUAL(value, 2), EQUAL(value, 6), EQUAL(value, 8))
  f = OR(EQUAL(value, 0), EQUAL(value, 4), EQUAL(value, 5), EQUAL(value, 6), EQUAL(value, 8), EQUAL(value, 9))
  g = OR(EQUAL(value, 2), EQUAL(value, 3), EQUAL(value, 4), EQUAL(value, 5), EQUAL(value, 6), EQUAL(value, 8), EQUAL(value, 9))
END

CIRCUIT Tally
  INPUT clock
  INPUT reset

  OUTPUT count
  OUTPUT a
  OUTPUT b
  OUTPUT c
  OUTPUT d
  OUTPUT e
  OUTPUT f
  OUTPUT g

  STATE ticks : BUS(4) = 0

  stepped = ADD(ticks, 1)
  wrapped = MUX(stepped, 0b0000, EQUAL(stepped, 0b1010))

  ON RISING_EDGE(clock):
    IF reset:
      ticks = 0b0000
    ELSE:
      ticks = wrapped
    END
  END

  count = ticks

  digit = SevenSegment(value = ticks)
  a = digit.a
  b = digit.b
  c = digit.c
  d = digit.d
  e = digit.e
  f = digit.f
  g = digit.g
END

TEST Tally
CASE "counts to one"
  INPUT clock = 0
  INPUT reset = 0
  CYCLE clock 1
  EXPECT count = 0b0001
END

CASE "counts to two"
  INPUT clock = 0
  CYCLE clock 1
  CYCLE clock 1
  EXPECT count = 0b0010
END

CASE "reset clears the count"
  INPUT clock = 0
  CYCLE clock 1
  INPUT reset = 1
  CYCLE clock 1
  EXPECT count = 0b0000
END
END
`;

const MULTIPLY = `# A two-by-two multiplier, stamped out with a loop.
# Every partial product is one bit, widened before the sums.

CIRCUIT Multiply2x2
  INPUT a : BUS(2)
  INPUT b : BUS(2)
  OUTPUT product

  FOR i IN 0..1
    FOR j IN 0..1
      partial[i][j] = ZEXT(AND(a[i], b[j]), 4)
    END
  END

  low = ADD(partial[0][0], SHIFT_LEFT(partial[0][1], 1))
  high = ADD(SHIFT_LEFT(partial[1][0], 1), SHIFT_LEFT(partial[1][1], 2))
  product = ADD(low, high)
END

TEST Multiply2x2
CASE "two times two"
  INPUT a = 0b10
  INPUT b = 0b10
  EXPECT product = 0b0100
END

CASE "three times three"
  INPUT a = 0b11
  INPUT b = 0b11
  EXPECT product = 0b1001
END

CASE "one times three"
  INPUT a = 0b01
  INPUT b = 0b11
  EXPECT product = 0b0011
END
END
`;

const LIFE = `# Conway's Life on a strip of four cells.
# The strip wraps around, so the left of the first cell is the last one.

CONST N = 4

CIRCUIT LifeCell
  INPUT alive
  INPUT neighbours : BUS(2)
  OUTPUT next

  total = POPCOUNT(neighbours)
  next = OR(EQUAL(total, 3), AND(alive, EQUAL(total, 2)))
END

CIRCUIT LifeStrip
  INPUT clock
  OUTPUT row

  STATE cells : BUS(N) = 0

  FOR i IN 0..N-1
    cell[i] = LifeCell(cells[i], CONCAT(cells[(i + N - 1) % N], cells[(i + 1) % N]))
  END

  # The first cell is the most significant bit, so the pieces are joined in reverse.
  nextrow = CONCAT(cell[3].next, cell[2].next, cell[1].next, cell[0].next)

  ON RISING_EDGE(clock):
    cells = nextrow
  END

  row = cells
END

TEST LifeStrip
CASE "a lonely cell dies"
  LOAD cells = 0b0010
  CYCLE clock 1
  EXPECT cells = 0b0000
END

CASE "a full ring survives"
  LOAD cells = 0b1111
  CYCLE clock 1
  EXPECT cells = 0b1111
END

CASE "a pair dies"
  LOAD cells = 0b0110
  CYCLE clock 1
  EXPECT cells = 0b0000
END
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
    id: "cell-grid",
    title: "Cell grid",
    tag: "Compile time",
    level: "Digital systems",
    description: "A constant and a loop stamp out four identical cells, so a wider grid is one edit.",
    focusCircuit: "CellGrid",
    source: CELL_GRID,
  },
  {
    id: "parameterized",
    title: "Parameterized register",
    tag: "Compile time",
    level: "Digital systems",
    description: "One register definition, two instances, each with the width it was given.",
    focusCircuit: "RegisterPair",
    source: PARAMETERIZED,
  },
  {
    id: "seven-segment",
    title: "Seven-segment display",
    tag: "Display",
    level: "Digital systems",
    description: "A four-bit number drives the seven bars of a display, the way a real counter does.",
    focusCircuit: "SevenSegment",
    source: SEVEN_SEGMENT,
  },
  {
    id: "traffic-light",
    title: "Traffic light",
    tag: "State machine",
    level: "Digital systems",
    description: "Red, amber, green: a small state machine that counts its way around the cycle.",
    focusCircuit: "TrafficLight",
    source: TRAFFIC,
  },
  {
    id: "lock",
    title: "Combination lock",
    tag: "Everyday logic",
    level: "Start here",
    description: "A four-bit keypad code opens the lock, and a wrong code is denied.",
    focusCircuit: "Lock",
    source: LOCK,
  },
  {
    id: "sequence-detector",
    title: "Sequence detector",
    tag: "State machine",
    level: "Digital systems",
    description: "A shift register that spots the pattern 1011 in a stream of bits.",
    focusCircuit: "SequenceDetector",
    source: SEQUENCE,
  },
  {
    id: "tally",
    title: "Tally counter",
    tag: "Display",
    level: "Digital systems",
    description: "A counter that runs from zero to nine and shows its count on a display.",
    focusCircuit: "Tally",
    source: TALLY,
  },
  {
    id: "multiply",
    title: "Array multiplier",
    tag: "Compile time",
    level: "Digital systems",
    description: "A two-by-two multiplier whose partial products are stamped out by a loop.",
    focusCircuit: "Multiply2x2",
    source: MULTIPLY,
  },
  {
    id: "life",
    title: "Game of Life",
    tag: "Game of Life",
    level: "Digital systems",
    description: "Conway's Life on a wrapping strip of four cells, with neighbours counted for you.",
    focusCircuit: "LifeStrip",
    source: LIFE,
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
