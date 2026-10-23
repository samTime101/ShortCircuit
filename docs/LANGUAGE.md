# LogicFlow 0.2 — Language Reference

LogicFlow describes digital circuits as named wires, structural operations, and
clocked state. It is deliberately small: the kernel knows `NAND`, structural
bus wiring, composition, state, tests, and packages. Everything else — gates
such as `AND` and `XOR`, selection, and arithmetic — comes from package source.

This guide covers the source language, the simulation and test model, package
imports, diagnostics, and the portable IR. The operation reference near the end
is generated from the engine and package catalogs, so it cannot drift from the
implementation.

---

## 1. Reading model

A circuit is a graph, not a sequence of instructions.

- An assignment names a wire and gives it an expression.
- Expressions describe how values are connected; they do not execute in source
  order.
- `INPUT`, `OUTPUT`, and `STATE` declare the boundary and memory of the graph.
- `ON` blocks describe what changes when a clock edge fires.
- A circuit can contain other circuits. Instances are flattened into one graph
  at compile time.

The compiler parses and validates the whole file before simulation. A design
with an error does not produce a partial IR.

```logicflow
IMPORT "@shortcircuit/gates"

CIRCUIT HalfAdder
  INPUT a
  INPUT b

  sum = XOR(a, b)
  carry = AND(a, b)

  OUTPUT sum
  OUTPUT carry
END
```

`XOR` and `AND` above are package macros from the imported gates package. They expand to NAND and structural
wiring during analysis; they are not extra kernel operations.

---

## 2. Lexical rules

### 2.1 Lines, whitespace, comments

Statements are line-oriented. Blank lines are ignored. Indentation is for
readability; the formatter normalizes it to two spaces per nesting level.

```logicflow
// a line comment
sum = XOR(a, b)   // also valid after a statement

/* a block comment
   may span several lines */
```

Use `//` for line comments and `/* ... */` for block comments. `#` is not a
comment; it is reported with a hint to use `//`.

### 2.2 Identifiers

Identifiers start with a letter or underscore and continue with letters,
digits, or underscores. Signal and circuit names are case-sensitive. Keywords
and operation names are case-insensitive.

```logicflow
data       // a signal
_data2     // valid
Data       // a different signal from data
```

### 2.3 Literals

Bit patterns are written without a prefix. A literal is fitted to its context
and must fit without truncation.

```logicflow
0
1010        // binary when the context is a bus
0011        // leading zeros make the binary reading explicit
```

Bit patterns can also use an explicit base. `0b` marks binary and `0x` marks
hexadecimal; underscores are ignored.

```logicflow
0b1010      // explicit binary, width 4
0x0F        // explicit hex, width 8
1_000       // decimal, underscores allowed
```

A bare number made only of `0` and `1` can be read as binary or decimal. The
compiler emits `W402` when the two readings differ. Add a `0b` prefix, leading
zeros, or a literal wide enough to make the intent clear. Test inputs and
expectations of width greater than one are always read as bit patterns.

### 2.4 Reserved words

These words cannot be used as identifiers:

`CIRCUIT`, `END`, `INPUT`, `OUTPUT`, `STATE`, `ON`, `RISING_EDGE`,
`FALLING_EDGE`, `TEST`, `CASE`, `EXPECT`, `LOAD`, `STEP`, `CYCLE`, `IMPORT`,
`AS`, `BUS`, plus every built-in and package export visible in the program.

`CONST`, `FOR`, `IN`, `IF`, and `ELSE` belonged to earlier versions. They are
rejected with a migration hint rather than silently accepted.

### 2.5 Circuit names and signal names

A circuit name and a signal name live in different namespaces. Package macro
and circuit export names are reserved while their package is enabled; disable
the package if you need that exact name for your own circuit. Within an
instance, output ports are read through the instance: `first.sum`.

---

## 3. Program structure

A file contains package imports followed by circuits and test suites.

```text
program      := import* (circuit | test)*

import       := "IMPORT" string ("AS" name)? NEWLINE

circuit      := "CIRCUIT" name NEWLINE
                circuitItem* "END" NEWLINE
circuitItem  := inputDecl | outputDecl | stateDecl
              | assignment | onBlock

inputDecl    := "INPUT" name (":" width)? NEWLINE
outputDecl   := "OUTPUT" path NEWLINE
stateDecl    := "STATE" name (":" width)? ("=" literal)? NEWLINE
assignment   := name "=" expression NEWLINE

onBlock      := "ON" ("RISING_EDGE" | "FALLING_EDGE") "(" name ")" ":" NEWLINE
                stateAssignment* "END" NEWLINE

width        := number | "BUS" "(" number ")"
```

Top-level `TEST` blocks are covered in §9. A circuit body may not contain
another `CIRCUIT` declaration.

### 3.1 Package imports

`IMPORT` names a package by its manifest name and optionally gives it an alias.

```logicflow
IMPORT "@acme/display" AS display

CIRCUIT Panel
  INPUT value : BUS(4)

  segments = display.SEVEN_SEGMENT(value)

  OUTPUT segments.a
  OUTPUT segments.g
END
```

Packages are available only when the source imports them. The web studio
bundles `@shortcircuit/gates`, `@shortcircuit/selection`,
`@shortcircuit/arithmetic`, and `@shortcircuit/comparison`, but they still need
an explicit `IMPORT` in every file that uses their exports. The CLI does not
ship that snapshot; install or link the packages a project imports.
`recommendedAutoImport` is legacy manifest metadata and does not activate a
package.

- An import with an alias adds qualified access through that alias.
- An import without an alias adds unqualified access.
- The import list is resolved before analysis. Importing a package that is not
  installed is `E602`.
- Reusing one alias for two packages is `E603`.
- Only imported packages expose exports to user circuits. Declared dependencies
  of an imported package load internally so package implementations can resolve
  their own calls, but those dependencies do not appear in user completions or
  become callable from user code.
- The studio's **Packages** button edits the source `IMPORT` lines directly.
  Checking a package adds its import and unchecking removes it. There is no
  separate enabled-package state.
- Hosts can compile against custom bundles with `packages` and omit the
  engine's default snapshot with `disableDefaultPackages`, but neither option
  bypasses the source import requirement. The CLI uses the default-free
  `@shortcircuit/engine/core` entry and supplies the project's packages.
- Package implementation files are real `.lf` sources. Manifests contain
  catalog metadata and source pointers, not embedded circuit logic.

---

## 4. Circuits and signals

### 4.1 Inputs

`INPUT` declares a port. Add `: BUS(n)` for a multi-bit port; without a width it
is one bit.

```logicflow
INPUT enable
INPUT data : BUS(8)
```

A circuit with no inputs is legal (for example, a constant driver), but the
simulator still displays its outputs.

### 4.2 State

`STATE` declares a stored value and an optional initializer. The initializer
must fit the state width and is applied when a simulator is created or reset.

```logicflow
STATE count : BUS(4) = 0000
STATE running = 0
```

State is only updated inside an `ON` block. Reading state in combinational
expressions is allowed and refers to the value before the current edge.

### 4.3 Assignments

An assignment introduces exactly one signal in its circuit scope.

```logicflow
sum = XOR(a, b)
next_count = ADD4(count, 0, 1)
```

- Assigning the same signal twice is an error.
- A signal cannot share a name with an input or state in the same scope.
- Combinational feedback is rejected (`E310`). Use state and a clock for
  intentional feedback.
- Package macro calls are expanded during analysis. A package macro may be
  variadic; its `FOLD` declaration reduces repeated arguments pairwise.

### 4.4 Outputs

`OUTPUT` exposes a signal, a bus bit, or an instance port.

```logicflow
OUTPUT sum
OUTPUT count
OUTPUT result.sum
OUTPUT data[3]
```

Outputs keep their source order in the studio and in generated Verilog. An
instance output must name a port that exists; reading an instance itself without
a port is `E213`.

---

## 5. Expressions

Expressions are built from references, calls, and bit/slice selection.

### 5.1 References

A reference names an input, state, assignment, or instance output.

```logicflow
a
first.sum
outer.inner.value
```

Bit and range indexing are structural:

```logicflow
data[0]       // one bit
data[7:4]     // bits 7, 6, 5, 4
```

Range bounds are inclusive and must be constant. `[high:low]` requires
`high >= low`. A reversed range is `E330`; an out-of-range index is `E331`.

### 5.2 Calls

Calls use `Name(argument, ...)`. Arguments are expressions or, for circuit
instances, named bindings.

```logicflow
x = NAND(a, b)
y = AND(a, b, c, d)
z = HalfAdder(a, b)
w = HalfAdder(b = b, a = a)
```

- Circuit instances bind every input exactly once.
- Positional bindings follow the target circuit's `INPUT` order.
- Named bindings may appear in any order. Unknown names, duplicates, missing
  inputs, and mixing positional with named bindings are reported.
- Package circuit calls use the same rules.
- Call parameters and circuit parameters are not part of LogicFlow 0.2. Size a
  circuit with a concrete bus width or use a package circuit with the width you
  need.

---

## 6. Width policy

Widths are checked before simulation. There is no implicit truncation or
widening.

| Situation | Behaviour |
| --- | --- |
| Two signals of different widths in an operation | `E301`, naming both widths |
| Literal too wide for the context | `E305`; literals fit but never truncate |
| NAND and package gate macros | Common input width; the result uses that width |
| Package circuit ports | Declared fixed widths, checked at the call site |
| `SLICE` / indexing | Exactly the selected bits |
| `CONCAT` | Sum of the argument widths, within the width limit |
| `BROADCAST(bit, value)` | Repeats a one-bit control to the width of `value` |
| `ZEXT(x, width)` | Zero-extension; `width` must be at least the source width |
| `SEXT(x, width)` | Sign-extension from the source's most significant bit |
| `REPEAT(x, count)` | Repeats the whole bus `count` times |
| `REVERSE(x)` | Same width, least significant bit first |

The maximum supported width defaults to 4096 bits. Exceeding it is an analysis
error.

---

## 7. Built-in operations

The kernel deliberately contains only structural operations:

- `NAND`
- `CONCAT`
- `BROADCAST`
- `SLICE`
- `ZEXT`
- `SEXT`
- `REPEAT`
- `REVERSE`

`NAND` is the primitive Boolean operator. Every other gate is a package macro
that lowers to `NAND` and structural nodes. Addition, comparison, shifts,
decoding, encoding, population count, and reductions are not kernel built-ins.
Use package circuits or add a package; the bundled arithmetic and selection
packages cover common cases.

### 7.1 Removed operations and syntax

The following are rejected with a migration diagnostic:

- `CONST` — use a literal or expose a package circuit.
- `FOR` — unroll the structure or provide a fixed-width package circuit. One
  definition per signal still applies.
- `IF` / `ELSE` — compute a next value with `MUX(zero, one, select)`.
- Circuit parameters and call parameters — declare fixed widths or provide
  width-specific package circuits such as `ADD4` and `ADD8`.
- `ADD`, `SUBTRACT`, `MULTIPLY`, `DIVIDE`, `EQUAL`, `LESS`, `GREATER`,
  `COMPARE`, `MUX`, shifts, `DECODER`, `ENCODER`, `POPCOUNT`, and reductions —
  use package circuits.

### 7.2 Packages and fixed widths

Bundled packages provide:

- `@shortcircuit/gates`: `NOT`, `AND`, `OR`, `NOR`, `XOR`, `XNOR`, `BUFFER`,
  and internal helpers. `NAND` itself is the kernel built-in.
- `@shortcircuit/selection`: `MUX(zero, one, select)`. It expands to NAND, OR,
  and `BROADCAST`, so the select bit reaches every bit of the values.
- `@shortcircuit/arithmetic`: `HALF_ADDER`, `FULL_ADDER`, `ADD4`, and `ADD8`.
  Adders expose `sum` and `carry_out`.
- `@shortcircuit/comparison`: `COMPARE1`, `COMPARE2`, `COMPARE4`, and `COMPARE8`.
  Comparators expose `eq`, `lt`, and `gt`, and exactly one of them is high.

```logicflow
IMPORT "@shortcircuit/arithmetic"
IMPORT "@shortcircuit/selection"

CIRCUIT AddAndSelect
  INPUT a : BUS(8)
  INPUT b : BUS(8)
  INPUT choose_b

  added = ADD8(a, b, 0)
  result = MUX(a, added.sum, choose_b)

  OUTPUT result
  OUTPUT added.carry_out
END
```

A package circuit is internal: it can be instantiated by user circuits, but it
is not emitted as a separate top-level result circuit or Verilog module. Its
internals appear in the owning circuit's graph.

### 7.3 Operation reference

This section is generated from the engine and package catalogs. Run
`npm run docs:generate` after changing built-ins, package exports, or manifests.

<!-- BEGIN GENERATED REFERENCE -->

This section is generated from the engine and package catalogs. Every operation lists its
arguments, the width it produces, and a call example.

### Package macros

#### `NOT(x)`

Bitwise inversion. Expands to NAND(x, x).

- **Arguments:** x
- **Result width:** Result width = input width
- **Example:** `y = NOT(a)`
- **Package:** Basic Logic Gates

#### `AND(a, b, ...)`

Bitwise AND. Expands to NOT(NAND(a, b, ...)).

- **Arguments:** a · b
- **Result width:** Result width = common input width
- **Example:** `y = AND(a, b)`
- **Package:** Basic Logic Gates

#### `OR(a, b, ...)`

Bitwise OR. Folds OR2 across the inputs.

- **Arguments:** a · b
- **Result width:** Result width = common input width
- **Example:** `y = OR(a, b)`
- **Package:** Basic Logic Gates

#### `BUFFER(x)`

Identity buffer. Expands to NOT(NOT(x)).

- **Arguments:** x
- **Result width:** Result width = input width
- **Example:** `y = BUFFER(a)`
- **Package:** Basic Logic Gates

#### `NOR(a, b, ...)`

Bitwise NOR. Expands to NOT(OR(a, b, ...)).

- **Arguments:** a · b
- **Result width:** Result width = common input width
- **Example:** `y = NOR(a, b)`
- **Package:** Universal Logic Gates

#### `XOR(a, b, ...)`

Bitwise XOR. Folds XOR2 across the inputs.

- **Arguments:** a · b
- **Result width:** Result width = common input width
- **Example:** `y = XOR(a, b)`
- **Package:** Exclusive Gates

#### `XNOR(a, b, ...)`

Bitwise XNOR. Expands to NOT(XOR(a, b, ...)).

- **Arguments:** a · b
- **Result width:** Result width = common input width
- **Example:** `y = XNOR(a, b)`
- **Package:** Exclusive Gates

#### `MUX(zero, one, select)`

Two-input multiplexer. Expands to NAND-derived gates and BROADCAST.

- **Arguments:** zero · one · select
- **Result width:** Result width = common input width; select is one bit
- **Example:** `y = MUX(low, high, select)`
- **Package:** Selection

### Logic gates

#### `NAND(a, b, ...)`

Inverse of multi-input AND.

- **Arguments:** `a` — First input. · `b` — Second input. · `...` — Further inputs, all combined into one gate. (optional)
- **Result width:** Result width = common input width
- **Example:** `NAND(1, 1)` → `0` — AND of two high bits is 1, and NAND inverts that to 0.
- **Tip:** Negates the whole multi-input AND; it is not a chain of two-input NANDs.

### Bus operations

#### `CONCAT(a, b, ...)`

Joins buses most-significant argument first.

- **Arguments:** `a` — The part that ends up in the high bits. · `b` — The part that ends up in the low bits. · `...` — Further parts, placed below the previous one. (optional)
- **Result width:** Result width = sum of the operand widths
- **Example:** `CONCAT(1010, 0101)` → `10100101` — The first argument occupies the high nibble.
- **Tip:** The first argument ends up in the high bits: CONCAT(hi, lo).

#### `BROADCAST(bit, value)`

Repeats a one-bit control to the width of another value.

- **Arguments:** `bit` — The one-bit value to repeat. · `value` — The value whose width is used.
- **Result width:** Result width = width of value; bit must be 1 bit
- **Example:** `BROADCAST(1, 0000)` → `1111` — The control bit is repeated to the four-bit width of value.
- **Tip:** Use it to apply a single control bit to every bit of a bus, as package MUX does.

#### `SLICE(value, hi, lo)`

SLICE(value, hi, lo), inclusive, down to bit 0.

- **Arguments:** `value` — The bus to read from. · `hi` — Highest bit to keep. · `lo` — Lowest bit to keep.
- **Result width:** Result width = hi - lo + 1; bounds are inclusive
- **Example:** `SLICE(10100101, 7, 4)` → `1010` — Bits 7 down to 4 are the high nibble.
- **Tip:** Same as value[hi:lo]. Bounds must be plain decimal literals.

#### `ZEXT(x, width)`

Zero-extends a value to a wider bus.

- **Arguments:** `x` — The value to widen. · `width` — The width to widen it to.
- **Result width:** Result width = the requested width, which must not be smaller than x
- **Example:** `ZEXT(1010, 8)` → `00001010` — Four zeroes are added on the left.
- **Tip:** Pads with zeroes on the left. Use it to widen a signal so it matches a wider bus.

#### `SEXT(x, width)`

Sign-extends a value by repeating its top bit.

- **Arguments:** `x` — The value to widen. · `width` — The width to widen it to.
- **Result width:** Result width = the requested width, which must not be smaller than x
- **Example:** `SEXT(1010, 8)` → `11111010` — The top bit is 1, so it is repeated across the new bits.
- **Tip:** Repeats the most significant bit, the usual two's-complement widening.

#### `REPEAT(x, count)`

Concatenates a value with itself a number of times.

- **Arguments:** `x` — The value to repeat. · `count` — How many times to repeat it.
- **Result width:** Result width = count x width of x
- **Example:** `REPEAT(1010, 2)` → `10101010` — The four-bit value is written twice.
- **Tip:** Builds a repeated pattern, such as an alternating mask.

#### `REVERSE(x)`

Reverses the bit order of a value.

- **Arguments:** `x` — The value to reverse.
- **Result width:** Result width = width of x
- **Example:** `REVERSE(00000001)` → `10000000` — The only set bit moves from the bottom to the top.
- **Tip:** Swaps the most and least significant bits. Handy for bit-reversed addressing.

### Circuit-shaped components

#### `HALF_ADDER(a, b)`

One-bit half adder: sum = XOR(a, b), carry = AND(a, b).

- **Inputs:** a, b
- **Outputs:** sum, carry
- **Package:** Arithmetic Circuits

#### `FULL_ADDER(a, b, carry_in)`

One-bit full adder built from two half adders and an OR gate.

- **Inputs:** a, b, carry_in
- **Outputs:** sum, carry_out
- **Package:** Arithmetic Circuits

#### `ADD4(a, b, carry_in)`

Four-bit ripple-carry adder with carry in and carry out.

- **Inputs:** a, b, carry_in
- **Outputs:** sum, carry_out
- **Package:** Arithmetic Circuits

#### `ADD8(a, b, carry_in)`

Eight-bit adder built from two chained ADD4 circuits.

- **Inputs:** a, b, carry_in
- **Outputs:** sum, carry_out
- **Package:** Arithmetic Circuits

#### `COMPARE1(a, b)`

One-bit comparator. Sets exactly one of eq, lt or gt.

- **Inputs:** a, b
- **Outputs:** eq, lt, gt
- **Package:** Comparison Circuits

#### `COMPARE2(a, b)`

Two-bit comparator. Sets exactly one of eq, lt or gt.

- **Inputs:** a, b
- **Outputs:** eq, lt, gt
- **Package:** Comparison Circuits

#### `COMPARE4(a, b)`

Four-bit comparator. Sets exactly one of eq, lt or gt.

- **Inputs:** a, b
- **Outputs:** eq, lt, gt
- **Package:** Comparison Circuits

#### `COMPARE8(a, b)`

Eight-bit comparator. Sets exactly one of eq, lt or gt.

- **Inputs:** a, b
- **Outputs:** eq, lt, gt
- **Package:** Comparison Circuits

<!-- END GENERATED REFERENCE -->

---

## 8. Composition

### 8.1 Defining and instantiating

```logicflow
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
```

- A circuit may be instantiated before its declaration appears in the file.
- Instances are named and create a scope in the elaborated graph.
- Positional arguments bind in `INPUT` order.
- Named arguments may appear in any order and must cover every input:
  `first = HalfAdder(b = y, a = x)`.
- Mixing positional and named arguments is `E306`.
- Missing or extra positional arguments are `E307`; unknown names are `E204`;
  duplicate connections are `E209`; unconnected inputs are `E205`.
- Every connection is width-checked with the same rules as any expression.

### 8.2 Instance outputs

- `instance.port` accesses an output whose name is the last segment of one of
  the target's `OUTPUT` declarations.
- If two outputs share a last segment, use the full dotted name.
- Nested outputs chain naturally: `outer.inner.value`.
- Reading an instance without a port is `E213`. An unknown port is `E204`,
  with a suggestion when one is close.

### 8.3 Elaboration, recursion, and limits

- Instantiation is flattened. The top-level circuit's IR contains one node per
  gate in every instantiated copy, with scope paths identifying where it came
  from.
- Recursion is rejected.
- Nesting is limited to 32 levels by default. A design may contain at most 500
  instances per top-level circuit and 20,000 graph nodes.
- Package circuits are flattened like user circuits but omitted from the
  exported top-level circuit list.

---

## 9. State and clocks

### 9.1 Edge blocks

State updates happen only in an `ON` block.

```logicflow
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
```

Supported edges are `RISING_EDGE` (0 → 1) and `FALLING_EDGE` (1 → 0). A clock
must be one bit wide; a bus clock is `E303`.

### 9.2 Edge semantics

1. Inputs change and the combinational graph is evaluated against the old
   state.
2. The clock is compared with its previous value.
3. On a matching edge, every assignment in the block samples expressions
   against the pre-edge state.
4. All updates commit together.
5. The graph is evaluated again.

Because `MUX` feeds the old state back when `enable` is 0, the register above
holds its value without needing a conditional language construct. State that is
never assigned keeps its initialized value.

Multiple `ON` blocks are allowed. An edge block may only assign state declared
in the same circuit.

### 9.3 Simulator operations

The engine exposes a `Simulator` with:

- `setInput(name, binary)` and `setInputs(record)`, which validate every value
  before applying any of them;
- `snapshot()`, returning input, output, state, and clock values;
- `setState(name, binary)` for interactive state injection;
- `reset()`, returning inputs and state to their initial values;
- edge detection through `firedEvents` in each snapshot.

Values are binary strings at the API boundary and arbitrary-precision integers
inside the simulator. A value that does not fit its signal is an error, never a
silent wrap.

---

## 10. Tests

Tests live in the source and use the same compiled graph as simulation.

```logicflow
TEST HalfAdder
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
```

A `TEST` block names the circuit it exercises. Every input must be set in every
combinational case. Expectations are checked after all inputs in the case have
been applied.

### 10.1 Clocked statements

- `CYCLE clock n` toggles a clock `n` times, committing a rising and falling
  edge each cycle.
- `STEP ... END` groups input changes so they apply together before the next
  expectation.
- `LOAD state = value` injects a state value at the start of a case.

```logicflow
TEST Counter4
  CASE "counts three ticks"
    INPUT reset = 0
    INPUT clock = 0
    EXPECT count = 0000
    CYCLE clock 3
    EXPECT count = 0011
  END
END
```

A failing expectation reports the case, the step number, and the expected and
actual binary values.

### 10.2 Truth tables

For combinational circuits, `generateTruthTable` enumerates every input
combination in binary-counting order and records every output. The studio uses
the same function for the truth-table panel.

---

## 11. Diagnostics

Diagnostics carry a stable code, a line and column, a hint, and a plain-language
explanation when one is available. Common families:

- `E0xx` — lexical and parse errors.
- `E1xx` — removed syntax and structural declaration errors.
- `E2xx` — names, calls, ports, and argument binding.
- `E3xx` — widths, indexing, slicing, shifts, and limits.
- `E6xx` — package and import problems.
- `W4xx` — non-fatal warnings such as ambiguous bare literals.
- `R4xx` / `R5xx` — simulation and runtime errors.

An error prevents IR generation. Warnings do not. The editor offers quick fixes
where a correction is unambiguous, such as a signal-name typo; it avoids blind
fixes for width mismatches.

---

## 12. Portable IR

Compilation produces a `CircuitIR` with a schema version and language version.
It contains:

- circuit metadata: name, inputs, outputs, states, events, and sequential flag;
- graph nodes: kind (`input`, `constant`, `state`, `operation`), width, label,
  scope path, operands, and operation-specific parameters;
- named output bindings;
- test suites and source spans for editor navigation.

The IR is the contract between the engine, simulator, trace viewer, truth-table
generator, and Verilog exporter. Hosts can serialize it without depending on
the parser or analyzer.

---

## 13. Verilog export

`exportVerilog(ir, options)` emits synthesizable-style modules. Package internals
are already lowered, so generated modules contain NAND expressions and explicit
structural wires. Registers become edge-triggered `always` blocks with
non-blocking assignments and an `initial` value. Pass `includeTestbenches: true`
to emit a simple testbench for each circuit with a `TEST` suite.

---

## 14. Style guide

- Name signals after meaning, not shape: `next_count` beats `n2`.
- Keep one concept per line; the graph is easier to read than a deeply nested
  call.
- Prefer named intermediates over repeated subexpressions.
- Use `BUS(n)` in declarations; use `: n` only for quick scratch work.
- Give state an explicit initial value.
- Test boundary values: zero, all ones, and the value just past the wrap point.
- Clocked blocks should update state and nothing else; compute next-state
  values as combinational signals above the `ON` block.

---

## 15. Snippets and editor assistance

The engine exports `LANGUAGE_SNIPPETS`, `BUILTINS`, `DEFAULT_PACKAGE_MACROS`,
and `DEFAULT_PACKAGE_CIRCUITS` so every host uses the same catalog. Editor
completions include structural built-ins, package gates, package circuits,
imports, and test statements. Hovering an operation shows its signature, width
rule, and a tip.

Run `npm run docs:generate` after changing any metadata. The operation reference
in §7.3 is rewritten in place between the generated markers.

---

## 16. Limits

| Limit | Default |
| --- | --- |
| Maximum width | 4096 bits |
| Maximum graph nodes | 20,000 |
| Maximum instance nesting | 32 levels |
| Maximum instances per circuit | 500 |
| Maximum diagnostics collected | 100 |

`compile(source, options)` can tighten or adjust these for a host. Hosts can
supply custom package bundles with `packages` and omit the engine's default
snapshot with `disableDefaultPackages`. Package activation still comes from the
source `IMPORT` lines. The CLI calls the default-free core entry, so its bundle
does not include the web snapshot.
