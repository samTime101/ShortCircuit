/**
 * A plain-language glossary of the words the language uses.
 *
 * Every entry gives a one-sentence definition and a small example, so the
 * studio, the documentation, and the command line can all explain a word the
 * same way.
 */

export interface GlossaryEntry {
  /** The word, as it appears in the interface. */
  term: string;
  /** One sentence. */
  short: string;
  /** A longer explanation, with an example. */
  long: string;
  /** The kind of thing it is, for grouping. */
  group: "building block" | "value" | "behaviour" | "verification";
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    term: "Signal",
    short: "A named value that carries a 0 or a 1 around the circuit.",
    long:
      "A signal is a wire with a name. Inputs, outputs, state, and every assignment create one. Signal names are case-sensitive, so sum and Sum are two different signals.",
    group: "value",
  },
  {
    term: "Bus",
    short: "A signal that carries several bits at once.",
    long:
      "A bus is written with a width, such as INPUT data : BUS(8). It holds eight bits, and you can read a single bit with data[3] or a slice with data[7:4].",
    group: "value",
  },
  {
    term: "Width",
    short: "How many bits a signal carries.",
    long:
      "A one-bit signal is a switch. An eight-bit signal is a byte. Operations need their inputs to have the same width, and the compiler says so when they do not.",
    group: "value",
  },
  {
    term: "Gate",
    short: "A building block that combines signals into one signal.",
    long:
      "AND, OR, XOR, and NOT are gates. They work on whole buses, bit by bit, so an eight-bit AND is eight AND gates in one operation.",
    group: "building block",
  },
  {
    term: "Circuit",
    short: "A named design with inputs, outputs, and the wiring between them.",
    long:
      "A CIRCUIT block is a reusable design. It can be instantiated in another circuit, and each instance is a separate copy in the compiled graph.",
    group: "building block",
  },
  {
    term: "Instance",
    short: "One copy of a circuit used inside another circuit.",
    long:
      "Writing adder = Adder(a, b) creates an instance named adder. Its outputs are read as adder.sum, and each instance is flattened into the graph on its own.",
    group: "building block",
  },
  {
    term: "State",
    short: "A value the circuit remembers between clock edges.",
    long:
      "A STATE signal holds its value until a clock edge changes it, which is how a register or a counter remembers something.",
    group: "behaviour",
  },
  {
    term: "Clock",
    short: "A one-bit signal that marks when the circuit should move on.",
    long:
      "A clock is an input the circuit watches. Changing it from 0 to 1 is a rising edge, and that is when clocked blocks update their state.",
    group: "behaviour",
  },
  {
    term: "Edge",
    short: "A change in a clock, from 0 to 1 or from 1 to 0.",
    long:
      "A rising edge is 0 to 1, and a falling edge is 1 to 0. A clocked block runs on the edge you ask for, not on the level.",
    group: "behaviour",
  },
  {
    term: "Combinational",
    short: "Logic that is decided by the inputs right now.",
    long:
      "Combinational logic has no memory. Give it the same inputs and it gives the same outputs, immediately, with no clock needed.",
    group: "behaviour",
  },
  {
    term: "Sequential",
    short: "Logic that depends on what happened before.",
    long:
      "Sequential logic uses state and clock edges, so its output depends on the history of the inputs, not only on the current ones.",
    group: "behaviour",
  },
  {
    term: "Assignment",
    short: "A line that gives a signal its value.",
    long:
      "An assignment such as sum = XOR(a, b) names a wire and says how it is computed. The order of the lines does not matter.",
    group: "building block",
  },
  {
    term: "Truth table",
    short: "Every input combination and the output it produces.",
    long:
      "A truth table lists all the rows of a circuit. The studio builds one for any combinational circuit and checks the outputs against the compiled graph.",
    group: "verification",
  },
  {
    term: "Test case",
    short: "One example of what a circuit should do.",
    long:
      "A test case sets the inputs and checks the outputs. In LogicFlow a test lives in a TEST block, with one CASE for each example.",
    group: "verification",
  },
  {
    term: "Portable IR",
    short: "The compiled graph every tool reads.",
    long:
      "The IR is plain JSON: the nodes, the wires between them, the state, and the clock events. The simulator, the graph, the tests, and the Verilog export all read it.",
    group: "building block",
  },
  {
    term: "Compile-time",
    short: "Something that is decided before the circuit runs.",
    long:
      "Constants and loops are resolved while compiling. A FOR loop is unrolled into ordinary statements, so the circuit that runs has no loops in it.",
    group: "behaviour",
  },
];

export const GLOSSARY_BY_TERM = new Map(GLOSSARY.map((entry) => [entry.term.toLowerCase(), entry]));
