/** The LogicFlow keywords, with the note shown in the hover and info cards. */

export interface KeywordSpec {
  name: string;
  detail: string;
  note: string;
  apply?: string;
}

export const KEYWORDS: KeywordSpec[] = [
  {
    name: "CIRCUIT",
    detail: "block",
    note: "Starts a circuit block. Every signal inside is defined exactly once.",
    apply: "CIRCUIT ",
  },
  {
    name: "END",
    detail: "block",
    note: "Closes a CIRCUIT, TEST, CASE, or ON block.",
    apply: "END",
  },
  {
    name: "INPUT",
    detail: "declaration",
    note: "Declares an input port. Add : BUS(n) for a bus.",
    apply: "INPUT ",
  },
  {
    name: "OUTPUT",
    detail: "declaration",
    note: "Exposes a signal, or an instance port such as result.sum.",
    apply: "OUTPUT ",
  },
  {
    name: "STATE",
    detail: "declaration",
    note: "Declares stored state. Give it a width and an initial value.",
    apply: "STATE ",
  },
  {
    name: "ON",
    detail: "sequential",
    note: "Starts a clocked block: ON RISING_EDGE(clock):",
    apply: "ON ",
  },
  {
    name: "RISING_EDGE",
    detail: "clock",
    note: "Fires when the clock changes from 0 to 1.",
    apply: "RISING_EDGE",
  },
  {
    name: "FALLING_EDGE",
    detail: "clock",
    note: "Fires when the clock changes from 1 to 0.",
    apply: "FALLING_EDGE",
  },
  {
    name: "TEST",
    detail: "block",
    note: "Starts a test suite for the circuit with the same name.",
    apply: "TEST ",
  },
  {
    name: "CASE",
    detail: "block",
    note: "One test case with a label, INPUT lines, and EXPECT lines.",
    apply: "CASE ",
  },
  {
    name: "EXPECT",
    detail: "test",
    note: "Expected output value inside a test case.",
    apply: "EXPECT ",
  },
  {
    name: "BUS",
    detail: "width",
    note: "Declares a bus width: INPUT data : BUS(8)",
    apply: "BUS",
  },
  {
    name: "IMPORT",
    detail: "package",
    note: "Imports a package: IMPORT \"@scope/package\" AS Alias",
    apply: "IMPORT ",
  },
  {
    name: "AS",
    detail: "package",
    note: "Names an imported package for qualified access.",
    apply: "AS ",
  },
  {
    name: "LOAD",
    detail: "test",
    note: "Loads a state value before a test case runs.",
    apply: "LOAD ",
  },
  {
    name: "STEP",
    detail: "test",
    note: "Groups test input changes so they apply together.",
    apply: "STEP",
  },
  {
    name: "CYCLE",
    detail: "test",
    note: "Ticks a clock a number of times inside a test case.",
    apply: "CYCLE",
  },
];
