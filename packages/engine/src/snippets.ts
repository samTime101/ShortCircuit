/**
 * Language snippets: ready-made LogicFlow fragments.
 *
 * Templates are plain text with `${field}` placeholders. Editors can map those
 * fields onto their own snippet mechanism, and documentation can show the
 * filled-in result.
 */

export type SnippetCategory = "structure" | "signal" | "sequential" | "test" | "pattern";

export interface LanguageSnippet {
  id: string;
  title: string;
  category: SnippetCategory;
  description: string;
  /** Template text with `${field}` placeholders. */
  template: string;
  /** How the snippet looks once the placeholders are filled in. */
  preview: string;
}

export const LANGUAGE_SNIPPETS: LanguageSnippet[] = [
  {
    id: "circuit",
    title: "Circuit",
    category: "structure",
    description: "A complete circuit with one input, one assignment, and one output.",
    template: "CIRCUIT ${name}\n  INPUT ${signal}\n\n  ${signal} = ${expression}\n\n  OUTPUT ${signal}\nEND",
    preview: "CIRCUIT Blink\n  INPUT enable\n\n  blink = AND(enable, enable)\n\n  OUTPUT blink\nEND",
  },
  {
    id: "input",
    title: "Scalar input",
    category: "signal",
    description: "A one-bit input.",
    template: "INPUT ${name}",
    preview: "INPUT enable",
  },
  {
    id: "input-bus",
    title: "Bus input",
    category: "signal",
    description: "An n-bit bus input.",
    template: "INPUT ${name} : BUS(${width})",
    preview: "INPUT data : BUS(8)",
  },
  {
    id: "output",
    title: "Output",
    category: "signal",
    description: "Expose a signal on the circuit output.",
    template: "OUTPUT ${name}",
    preview: "OUTPUT sum",
  },
  {
    id: "state",
    title: "State",
    category: "sequential",
    description: "A stored value with an explicit width and initial value.",
    template: "STATE ${name} : BUS(${width}) = ${init}",
    preview: "STATE count : BUS(4) = 0000",
  },
  {
    id: "assignment",
    title: "Assignment",
    category: "signal",
    description: "Name a wire and its expression.",
    template: "${name} = ${expression}",
    preview: "sum = XOR(a, b)",
  },
  {
    id: "bus-slice",
    title: "Bus slice",
    category: "signal",
    description: "Take an inclusive slice or a single bit of a bus.",
    template: "${name} = ${bus}[${hi}:${lo}]",
    preview: "nibble = data[7:4]",
  },
  {
    id: "concat",
    title: "Concatenate",
    category: "signal",
    description: "Join buses, most-significant argument first.",
    template: "${name} = CONCAT(${high}, ${low})",
    preview: "word = CONCAT(high_byte, low_byte)",
  },
  {
    id: "mux",
    title: "Multiplexer",
    category: "pattern",
    description: "Select between two values with a one-bit control.",
    template: "${name} = MUX(${when_zero}, ${when_one}, ${select})",
    preview: "chosen = MUX(a, b, sel)",
  },
  {
    id: "on-rising",
    title: "Rising-edge block",
    category: "sequential",
    description: "Update state when a clock goes from 0 to 1.",
    template: "ON RISING_EDGE(${clock}):\n  ${state} = ${value}\nEND",
    preview: "ON RISING_EDGE(clock):\n  stored = data\nEND",
  },
  {
    id: "on-falling",
    title: "Falling-edge block",
    category: "sequential",
    description: "Update state when a clock goes from 1 to 0.",
    template: "ON FALLING_EDGE(${clock}):\n  ${state} = ${value}\nEND",
    preview: "ON FALLING_EDGE(clock):\n  stored = data\nEND",
  },
  {
    id: "if",
    title: "Conditional update",
    category: "sequential",
    description: "Update state only when a condition holds; otherwise it holds.",
    template: "IF ${condition}:\n  ${state} = ${value}\nEND",
    preview: "IF enable:\n  stored = data\nEND",
  },
  {
    id: "if-else",
    title: "Conditional update with else",
    category: "sequential",
    description: "Choose between two next-state values.",
    template: "IF ${condition}:\n  ${state} = ${when_true}\nELSE:\n  ${state} = ${when_false}\nEND",
    preview: "IF reset:\n  count = 0\nELSE:\n  count = next\nEND",
  },
  {
    id: "test",
    title: "Test suite",
    category: "test",
    description: "A test block with one case.",
    template:
      "TEST ${circuit}\n  CASE \"${label}\"\n    INPUT ${signal} = 0\n    EXPECT ${output} = 0\n  END\nEND",
    preview:
      "TEST HalfAdder\n  CASE \"0 + 0\"\n    INPUT a = 0\n    EXPECT sum = 0\n  END\nEND",
  },
  {
    id: "case",
    title: "Test case",
    category: "test",
    description: "One case inside an existing test block.",
    template:
      "CASE \"${label}\"\n  INPUT ${signal} = 0\n  EXPECT ${output} = 0\nEND",
    preview: "CASE \"1 + 1\"\n  INPUT a = 1\n  EXPECT sum = 0\nEND",
  },
  {
    id: "half-adder",
    title: "Half adder",
    category: "pattern",
    description: "One-bit adder built from two gates.",
    template:
      "CIRCUIT HalfAdder\n  INPUT a\n  INPUT b\n\n  sum = XOR(a, b)\n  carry = AND(a, b)\n\n  OUTPUT sum\n  OUTPUT carry\nEND",
    preview: "CIRCUIT HalfAdder\n  INPUT a\n  INPUT b\n\n  sum = XOR(a, b)\n  carry = AND(a, b)\n\n  OUTPUT sum\n  OUTPUT carry\nEND",
  },
  {
    id: "mux4",
    title: "4:1 multiplexer",
    category: "pattern",
    description: "Select one of four values with a two-bit selector.",
    template:
      "CIRCUIT Mux4\n  INPUT a\n  INPUT b\n  INPUT c\n  INPUT d\n  INPUT sel : BUS(2)\n\n  low = MUX(a, b, sel[0])\n  high = MUX(c, d, sel[0])\n  result = MUX(low, high, sel[1])\n\n  OUTPUT result\nEND",
    preview:
      "CIRCUIT Mux4\n  INPUT a\n  INPUT b\n  INPUT c\n  INPUT d\n  INPUT sel : BUS(2)\n\n  low = MUX(a, b, sel[0])\n  high = MUX(c, d, sel[0])\n  result = MUX(low, high, sel[1])\n\n  OUTPUT result\nEND",
  },
  {
    id: "register",
    title: "Register with enable",
    category: "pattern",
    description: "An 8-bit register that latches data on a rising edge.",
    template:
      "CIRCUIT Register8\n  INPUT data : BUS(8)\n  INPUT clock\n  INPUT enable\n\n  STATE stored : BUS(8) = 0\n\n  ON RISING_EDGE(clock):\n    IF enable:\n      stored = data\n    END\n  END\n\n  OUTPUT stored\nEND",
    preview:
      "CIRCUIT Register8\n  INPUT data : BUS(8)\n  INPUT clock\n  INPUT enable\n\n  STATE stored : BUS(8) = 0\n\n  ON RISING_EDGE(clock):\n    IF enable:\n      stored = data\n    END\n  END\n\n  OUTPUT stored\nEND",
  },
  {
    id: "counter",
    title: "Counter with reset",
    category: "pattern",
    description: "A 4-bit counter with a synchronous reset.",
    template:
      "CIRCUIT Counter4\n  INPUT clock\n  INPUT reset\n\n  STATE count : BUS(4) = 0000\n\n  next = ADD(count, 1)\n\n  ON RISING_EDGE(clock):\n    IF reset:\n      count = 0\n    ELSE:\n      count = next\n    END\n  END\n\n  OUTPUT count\nEND",
    preview:
      "CIRCUIT Counter4\n  INPUT clock\n  INPUT reset\n\n  STATE count : BUS(4) = 0000\n\n  next = ADD(count, 1)\n\n  ON RISING_EDGE(clock):\n    IF reset:\n      count = 0\n    ELSE:\n      count = next\n    END\n  END\n\n  OUTPUT count\nEND",
  },
];

export const SNIPPET_BY_ID = new Map(LANGUAGE_SNIPPETS.map((snippet) => [snippet.id, snippet]));
