/**
 * Guided lessons.
 *
 * Each lesson gives a short explanation, a starter circuit with a gap, a goal
 * in plain language, a few hidden checks, hints, and a solution the student can
 * always look at.
 */

export interface LessonCheck {
  /** The inputs to apply before checking. */
  inputs: Record<string, string>;
  /** The outputs that must match, by name. */
  expect: Record<string, string>;
  /** What this row is testing, shown when it fails. */
  note: string;
}

export interface Lesson {
  id: string;
  title: string;
  /** One line for the lesson list. */
  summary: string;
  /** The explanation, in a few paragraphs. */
  body: string[];
  /** The circuit the student starts from. */
  starter: string;
  /** The circuit the checks run against. */
  circuit: string;
  /** What the student is asked to achieve. */
  goal: string;
  /** Hints, revealed one at a time. */
  hints: string[];
  /** A complete, working circuit. */
  solution: string;
  /** The hidden checks. */
  checks: LessonCheck[];
}

export const LESSONS: Lesson[] = [
  {
    id: "wires",
    title: "Switches and wires",
    summary: "Carry a value from an input to an output.",
    body: [
      "A circuit is made of named signals. An INPUT is a switch the outside world controls, an OUTPUT is a light the outside world can read, and an assignment connects them.",
      "Start by giving the output the same value as the input. The name of the signal does not matter, but it has to exist.",
    ],
    starter: `CIRCUIT Wire
  INPUT a
  OUTPUT light

  # Give the light the value of the switch.
  light = ???
END`,
    circuit: "Wire",
    goal: "Make the light follow the switch.",
    hints: [
      "An assignment copies a value: light = a.",
      "The right-hand side is the name of another signal.",
    ],
    solution: `CIRCUIT Wire
  INPUT a
  OUTPUT light

  light = a
END`,
    checks: [
      { inputs: { a: "1" }, expect: { light: "1" }, note: "With the switch on, the light is on." },
      { inputs: { a: "0" }, expect: { light: "0" }, note: "With the switch off, the light is off." },
    ],
  },
  {
    id: "and",
    title: "The AND gate",
    summary: "Light the output only when both switches are on.",
    body: [
      "AND is 1 only when every input is 1. It is the gate you use for \"both\".",
      "The AND operation takes the signals it should combine: AND(a, b).",
    ],
    starter: `CIRCUIT Both
  INPUT a
  INPUT b
  OUTPUT light

  # light = AND(a, b)
  light = ???
END`,
    circuit: "Both",
    goal: "Make the light on only when both switches are on.",
    hints: [
      "AND needs at least two inputs.",
      "Write light = AND(a, b).",
    ],
    solution: `CIRCUIT Both
  INPUT a
  INPUT b
  OUTPUT light

  light = AND(a, b)
END`,
    checks: [
      { inputs: { a: "1", b: "1" }, expect: { light: "1" }, note: "Both on means the light is on." },
      { inputs: { a: "1", b: "0" }, expect: { light: "0" }, note: "One switch off means the light is off." },
      { inputs: { a: "0", b: "0" }, expect: { light: "0" }, note: "Both off means the light is off." },
    ],
  },
  {
    id: "not",
    title: "The NOT gate",
    summary: "Invert a signal.",
    body: [
      "NOT flips a bit: 0 becomes 1, and 1 becomes 0. It takes exactly one input.",
      "NOT is how you build an opposite: for example, a light that is on when a switch is off.",
    ],
    starter: `CIRCUIT Opposite
  INPUT a
  OUTPUT light

  light = ???
END`,
    circuit: "Opposite",
    goal: "Make the light the opposite of the switch.",
    hints: ["NOT takes one input: NOT(a).", "Write light = NOT(a)."],
    solution: `CIRCUIT Opposite
  INPUT a
  OUTPUT light

  light = NOT(a)
END`,
    checks: [
      { inputs: { a: "0" }, expect: { light: "1" }, note: "A switch that is off lights the lamp." },
      { inputs: { a: "1" }, expect: { light: "0" }, note: "A switch that is on puts the lamp out." },
    ],
  },
  {
    id: "xor",
    title: "The XOR gate",
    summary: "Detect that two signals differ.",
    body: [
      "XOR is 1 when an odd number of its inputs are 1. With two inputs that means: the inputs are different.",
      "XOR is the gate behind a half adder, and the way you spot a mismatch between two values.",
    ],
    starter: `CIRCUIT Different
  INPUT a
  INPUT b
  OUTPUT different

  different = ???
END`,
    circuit: "Different",
    goal: "Make the output on when the two switches differ.",
    hints: ["XOR takes two inputs: XOR(a, b).", "Write different = XOR(a, b)."],
    solution: `CIRCUIT Different
  INPUT a
  INPUT b
  OUTPUT different

  different = XOR(a, b)
END`,
    checks: [
      { inputs: { a: "1", b: "0" }, expect: { different: "1" }, note: "One on and one off is different." },
      { inputs: { a: "1", b: "1" }, expect: { different: "0" }, note: "Two on is the same." },
      { inputs: { a: "0", b: "0" }, expect: { different: "0" }, note: "Two off is the same." },
    ],
  },
  {
    id: "half-adder",
    title: "The half adder",
    summary: "Add two bits and report the sum and the carry.",
    body: [
      "A half adder adds two one-bit numbers. It gives two answers: the sum bit, and a carry when both bits are on.",
      "The sum is XOR(a, b) and the carry is AND(a, b). Two assignments, two outputs.",
    ],
    starter: `CIRCUIT HalfAdder
  INPUT a
  INPUT b

  sum = ???
  carry = ???

  OUTPUT sum
  OUTPUT carry
END`,
    circuit: "HalfAdder",
    goal: "Add one bit to another bit.",
    hints: [
      "The sum of two bits is XOR(a, b).",
      "The carry is AND(a, b).",
    ],
    solution: `CIRCUIT HalfAdder
  INPUT a
  INPUT b

  sum = XOR(a, b)
  carry = AND(a, b)

  OUTPUT sum
  OUTPUT carry
END`,
    checks: [
      { inputs: { a: "1", b: "1" }, expect: { sum: "0", carry: "1" }, note: "One plus one is two: the sum is 0 and the carry is 1." },
      { inputs: { a: "1", b: "0" }, expect: { sum: "1", carry: "0" }, note: "One plus zero is one." },
      { inputs: { a: "0", b: "0" }, expect: { sum: "0", carry: "0" }, note: "Zero plus zero is zero." },
    ],
  },
  {
    id: "full-adder",
    title: "The full adder",
    summary: "Add two bits and a carry from the previous step.",
    body: [
      "A full adder adds three bits: two numbers and the carry from the step before. Its sum is the XOR of all three, and its carry is 1 when at least two of them are on.",
      "You can build it from two half adders, which is exactly what a real chip does.",
    ],
    starter: `CIRCUIT FullAdder
  INPUT a
  INPUT b
  INPUT carry_in

  sum = ???
  carry_out = ???

  OUTPUT sum
  OUTPUT carry_out
END`,
    circuit: "FullAdder",
    goal: "Add three one-bit numbers.",
    hints: [
      "The sum of three bits is XOR(a, b, carry_in).",
      "The carry is on when at least two of the three bits are on: OR(AND(a, b), AND(a, carry_in), AND(b, carry_in)).",
    ],
    solution: `CIRCUIT FullAdder
  INPUT a
  INPUT b
  INPUT carry_in

  sum = XOR(a, b, carry_in)
  carry_out = OR(AND(a, b), AND(a, carry_in), AND(b, carry_in))

  OUTPUT sum
  OUTPUT carry_out
END`,
    checks: [
      { inputs: { a: "1", b: "1", carry_in: "1" }, expect: { sum: "1", carry_out: "1" }, note: "One plus one plus one is three." },
      { inputs: { a: "1", b: "1", carry_in: "0" }, expect: { sum: "0", carry_out: "1" }, note: "One plus one is two." },
      { inputs: { a: "1", b: "0", carry_in: "0" }, expect: { sum: "1", carry_out: "0" }, note: "One plus zero is one." },
    ],
  },
  {
    id: "mux",
    title: "The multiplexer",
    summary: "Choose between two values with a switch.",
    body: [
      "A multiplexer picks one of two values. The third argument is the choice: 0 picks the first value, 1 picks the second.",
      "MUX(a, b, sel) is a two-way switch built from gates.",
    ],
    starter: `CIRCUIT Choose
  INPUT a
  INPUT b
  INPUT sel
  OUTPUT result

  result = ???
END`,
    circuit: "Choose",
    goal: "Make the result follow a when sel is 0, and b when sel is 1.",
    hints: ["The choice comes last: MUX(a, b, sel).", "Write result = MUX(a, b, sel)."],
    solution: `CIRCUIT Choose
  INPUT a
  INPUT b
  INPUT sel
  OUTPUT result

  result = MUX(a, b, sel)
END`,
    checks: [
      { inputs: { a: "1", b: "0", sel: "0" }, expect: { result: "1" }, note: "With sel low, the first value is chosen." },
      { inputs: { a: "1", b: "0", sel: "1" }, expect: { result: "0" }, note: "With sel high, the second value is chosen." },
    ],
  },
  {
    id: "latch",
    title: "Memory",
    summary: "Keep a value after the clock goes by.",
    body: [
      "So far everything has been combinational: the output depends only on the inputs right now. A latch remembers instead.",
      "Declare a STATE signal, and update it inside a clocked block. The value stays until the next clock edge changes it.",
    ],
    starter: `CIRCUIT Latch
  INPUT data
  INPUT clock
  OUTPUT held

  STATE held : BUS(8) = 0

  ON RISING_EDGE(clock):
    ???
  END
END`,
    circuit: "Latch",
    goal: "Store the data value on a rising clock edge.",
    hints: [
      "Inside a clocked block you assign to the state signal.",
      "Write held = data between ON RISING_EDGE(clock): and END.",
    ],
    solution: `CIRCUIT Latch
  INPUT data
  INPUT clock
  OUTPUT held

  STATE held : BUS(8) = 0

  ON RISING_EDGE(clock):
    held = data
  END
END`,
    checks: [
      { inputs: { data: "10110010", clock: "1" }, expect: { held: "10110010" }, note: "The latch takes the value on the clock edge." },
    ],
  },
  {
    id: "counter",
    title: "A counter",
    summary: "Count clock edges and remember the count.",
    body: [
      "A counter adds one on every clock edge. The count is a state signal, and the next value is computed with ordinary combinational logic.",
      "The value you add to the state is the same on every edge, so the counter counts up by one each time.",
    ],
    starter: `CIRCUIT Counter
  INPUT clock
  OUTPUT count

  STATE count : BUS(4) = 0000

  next = ???

  ON RISING_EDGE(clock):
    count = ???
  END
END`,
    circuit: "Counter",
    goal: "Count from 0 to 3 and wrap around.",
    hints: [
      "The next value is one more than the current count: ADD(count, 1).",
      "On the clock edge, assign the state the next value: count = next.",
    ],
    solution: `CIRCUIT Counter
  INPUT clock
  OUTPUT count

  STATE count : BUS(4) = 0000

  next = ADD(count, 1)

  ON RISING_EDGE(clock):
    count = next
  END
END`,
    checks: [
      { inputs: { clock: "1" }, expect: { count: "0001" }, note: "One edge counts to one." },
      { inputs: { clock: "0" }, expect: { count: "0001" }, note: "Without a rising edge the count holds." },
    ],
  },
];

export const LESSON_BY_ID = new Map(LESSONS.map((lesson) => [lesson.id, lesson]));
