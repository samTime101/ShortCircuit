# LogicFlow 0.1 — Language Reference

LogicFlow is the small, declarative language used by Short Circuit. A program
describes **wires in a graph**, not steps in a program. Every named signal is a
value that is derived from other values, and the compiler resolves the
dependency graph before anything runs.

```logicflow
CIRCUIT HalfAdder
  INPUT a
  INPUT b

  sum = XOR(a, b)
  carry = AND(a, b)

  OUTPUT sum
  OUTPUT carry
END
```

Version identifiers:

| Constant | Value |
| --- | --- |
| Language | `logicflow/0.1` |
| IR schema | `shortcircuit.ir/v1` |
| Engine | `0.1.0` |

This document specifies the surface language. The compiled contract is
described in [IR.md](IR.md); the compiler pipeline is described in
[ARCHITECTURE.md](ARCHITECTURE.md).

---

## 1. Reading model

- A program is a set of `CIRCUIT` and `TEST` blocks.
- A circuit is a set of **signal definitions**: inputs, state, and named
  assignments. Every signal has exactly one definition.
- Assignments are order-independent. `sum = XOR(a, b)` may appear before `a`
  is used anywhere; the analyzer walks references and builds the graph.
- There is no control flow in combinational logic. Selection is `MUX`,
  arithmetic is built-in operations, and repetition is instantiation.
- The only sequential construct is a clocked block, and it updates explicit
  `STATE` signals atomically.
- Operators are **function-style calls**: `AND(a, b, c)`, not `a & b & c`.
  Parentheses are grouping only; there is no infix arithmetic.

---

## 2. Lexical rules

### 2.1 Lines, whitespace, comments

- Statements are **line-oriented**. One declaration or assignment per line.
- Leading and trailing whitespace is insignificant; tabs and spaces are
  interchangeable.
- Comments start with `#` and run to the end of the line. They may appear on
  their own line or after a statement, including after an argument list. A
  `#` inside a quoted string is just a character, not a comment.
- Blank lines are ignored everywhere.
- `\r\n` and `\r` line endings are accepted; the formatter normalizes them.

```logicflow
# Full-line comment
INPUT a          # trailing comment
sum = XOR(a, b)  # comments never change semantics
```

### 2.2 Identifiers

```text
identifier := [A-Za-z_][A-Za-z0-9_]*
```

- **Signal and circuit names are case-sensitive.** `data`, `Data`, and `DATA`
  are three different names.
- **Keywords and built-in operations are case-insensitive.** `INPUT`,
  `input`, and `Input` are the same keyword; `xor(a, b)` calls `XOR`.
- Names may not be any reserved word (Section 2.4).
- Dot-paths select instance outputs: `adder.sum`. A path is written
  `name.name.name...` and is only valid where the first segment is a circuit
  instance.

### 2.3 Literals

| Form | Example | Width | Notes |
| --- | --- | --- | --- |
| Decimal | `0`, `1`, `42` | bits needed by the value | `1` is one bit, `42` is six bits |
| Prefixed binary | `0b1010` | number of digits (4) | case-insensitive marker |
| Prefixed hex | `0xF`, `0x0F` | 4 bits per digit (4, 8) | leading zeroes are preserved |
| Binary string | `00000011` | string length (8) | multi-character, starts with `0`, only `0`/`1` |
| Underscores | `0b1010_1010`, `1_000` | digits only | separators are ignored |

Important details:

- `10` is **decimal ten**, not binary. Only a multi-character literal in which
  *every* character is `0` or `1` **and** which starts with `0` is treated as a
  binary string: `00000010` is binary two, `010` is binary two, `10` is ten.
- `0` and `1` are one-bit values; their width rarely matters because literals
  are fitted to context (Section 6).
- Negative literals do not exist. All arithmetic is unsigned.
- A literal that is too wide for the context is a compile error, never a
  silent truncation.
- Test values use a slightly different rule (Section 10.3).

### 2.4 Reserved words

Reserved words may not be used as circuit or signal names, in any
capitalization. The list is deliberately kept small.

**Keywords**

```text
CIRCUIT  END  INPUT  OUTPUT  STATE  ON  RISING_EDGE  FALLING_EDGE
IF  ELSE  TEST  CASE  EXPECT  BUS  WHEN  SELECT
```

`WHEN` and `SELECT` are reserved for future syntax and are not used in 0.1.
`CLOCK` is **not** reserved, so `INPUT clock` is the recommended spelling.

**Built-in operations**

```text
AND  OR  XOR  NAND  NOR  XNOR  NOT  BUFFER
ADD  SUBTRACT  MULTIPLY  DIVIDE
EQUAL  LESS  GREATER  COMPARE
MUX  CONCAT  SLICE  SHIFT_LEFT  SHIFT_RIGHT  DECODER  ENCODER
```

**Circuit-shaped built-ins**

```text
HALF_ADDER  FULL_ADDER
```

Names such as `data`, `clock`, `reset`, `enable`, `sel`, `sum`, and `carry`
are all available. When a name is rejected, the diagnostic suggests a nearby
valid name when it can.

### 2.5 Strings

Strings are used for test-case labels. Single and double quotes are
equivalent, and `\\`, `\"`, and `\'` escapes are supported. Strings may not
span lines.

---

## 3. Program structure

```text
program      := (circuit | test)*

circuit      := "CIRCUIT" name NEWLINE circuitItem* "END" NEWLINE
circuitItem  := inputDecl | outputDecl | stateDecl | assignment | onBlock

inputDecl    := "INPUT" name (":" width)? NEWLINE
outputDecl   := "OUTPUT" path NEWLINE
stateDecl    := "STATE" name (":" width)? ("=" literal)? NEWLINE
assignment   := name "=" expression NEWLINE

width        := number | "BUS" "(" number ")"

onBlock      := "ON" edge "(" reference ")" ":" NEWLINE
                sequentialStatement*
                "END" NEWLINE
edge         := "RISING_EDGE" | "FALLING_EDGE"

sequentialStatement := sequentialAssignment | ifBlock
sequentialAssignment := path "=" expression NEWLINE
ifBlock      := "IF" expression ":" NEWLINE
                sequentialStatement*
                ("ELSE" ":" NEWLINE sequentialStatement*)?
                "END" NEWLINE

test         := "TEST" name NEWLINE testCase* "END" NEWLINE
testCase     := "CASE" (string | name)? NEWLINE testStatement* "END" NEWLINE
testStatement:= "INPUT" name "=" literal NEWLINE
              | "EXPECT" path "=" literal NEWLINE

expression   := literal | reference | call | expression "[" number "]"
              | expression "[" number ":" number "]" | "(" expression ")"
call         := name "(" (argument ("," argument)*)? ")"
argument     := (name "=")? expression
reference    := name ("." name)*
path         := name ("." name)*
```

The parser is resilient: an error in one line usually recovers to the next
line so a single typo does not produce hundreds of diagnostics. Recovery can
produce placeholder nodes such as `_invalid_`, but a failed program never
returns an IR (Section 12).

---

## 4. Circuits and signals

### 4.1 Inputs

```logicflow
INPUT a              # 1 bit
INPUT data : BUS(8)  # 8 bits (canonical spelling)
INPUT flags : 4      # 4 bits (shorthand)
```

Widths must be positive whole numbers no greater than 4096. An input with no
width is one bit. Inputs cannot have a default value; every top-level input is
supplied by the simulator, and every nested input is connected by the
instantiation that contains it.

### 4.2 State

```logicflow
STATE count : BUS(4) = 0000
STATE stored : BUS(8) = 0
STATE flag = 1
STATE armed : BUS(8)   # initial value 0
```

- A state declaration needs a width, an initial value, or both. `STATE x`
  alone is an error (E304).
- When the width is omitted it is taken from the initial value.
- The initial value must fit the declared width, otherwise E305.
- The default initial value is zero.
- State signals can be read anywhere a signal can be read. They may be
  referenced by combinational assignments to build next-state logic.
- State changes **only** inside `ON` blocks via `state = expression`.
  Assigning to state anywhere else is not what it looks like: a plain
  `count = ...` line defines a new combinational signal named `count`, which
  collides with the existing state name and produces E202.

### 4.3 Assignments

```logicflow
sum  = XOR(a, b)
high = CONCAT(upper, lower)
bit  = data[3]
```
 
- The target must be a **single name**. Dotted targets such as
  `instance.port = ...` are rejected (E207); instantiate a circuit, then read
  `instance.port` on the right-hand side.
- Every name is defined once. A second definition is E202 with a `related`
  diagnostic pointing at the first.
- Assignment order does not matter and does not imply evaluation order.
- A signal may be used by many consumers; fan-out is unlimited.
- Unused signals are allowed. The graph shows them but they do not affect
  outputs.

### 4.4 Outputs

```logicflow
OUTPUT sum
OUTPUT result.zero
```

- An output names any visible signal or instance output.
- A dotted output such as `OUTPUT result.zero` is exposed with the full name
  `result.zero` and the short port name `zero`.
- Duplicate output names are E208.
- An output that does not resolve to a signal is E201 (with a suggestion), and
  a dotted path through a scalar signal is E212.
- Outputs keep the source signal's width exactly.

---

## 5. Expressions

Expressions are literals, references, calls, and postfix bit selections.

```logicflow
x = 1
y = enable
z = AND(a, b)
w = data[7:4]
v = CONCAT(data[7:4], data[3:0])
u = (data[7:4])
```

- Postfix selection uses **square brackets**: `a[3]` for one bit,
  `a[7:4]` for an inclusive slice. Slices require constant decimal indexes.
- Bit 0 is the least-significant bit. `data[7:4]` is an 8-bit value's top
  nibble; `data[3]` is its fourth bit.
- `SLICE(data, 7, 4)` is the functional equivalent of `data[7:4]`. Both forms
  require constant, decimal, compile-time indexes; `SLICE` is useful when a
  bound is computed by tooling that generates source.
- `(expr)` groups an expression. Because there are no infix operators,
  grouping mainly improves readability.
- A parenthesized expression can still take a slice: `(a)[3]`.

### 5.1 References

A reference is a name path:

```logicflow
raw
clock
first.sum          # output of instance "first"
outer.inner.value  # nested instance output
```

Using a circuit instance where a value is expected (for example
`x = HalfAdder(a, b)`) is E217. Assign instances to a name first.

### 5.2 Calls

```logicflow
sum   = XOR(a, b, carry_in)
data  = CONCAT(high_nibble, low_nibble)
pick  = MUX(a, b, sel)
```

- Built-in operations accept **positional arguments only**. `AND(x = a, y = b)`
  is E218.
- Instantiating a user circuit accepts either all positional argument or all
  `port = value` arguments, never a mix (E306).
- An empty call is an arity error (E302). No built-in has default arguments.
- Calls can span lines inside the parentheses; newlines and trailing commas
  are permitted in an argument list.

---

## 6. Width policy

Width rules are static and explicit. The compiler never silently truncates a
**signal** to fit a wider one; it either fits a **literal** into context, or it
reports E301/E308.

### 6.1 The common-width rule

Operations that consume same-width operands (all gates, arithmetic, and
comparisons) use the **common width**:

1. Collect the non-constant operands and take the largest of their widths.
2. If two non-constant operands have *different* widths, report E301 with each
   operand's width in the message.
3. Coerce each **literal** constant to the common width if its value fits;
   otherwise report E305.
4. The result has the common width (except `MULTIPLY` and comparisons, below).

```logicflow
INPUT a : BUS(8)
INPUT b

good = AND(a, 0)      # literal 0 fits 8 bits → 8-bit result
bad  = AND(a, b)      # E301: a is 8 bits, b is 1 bit
```

### 6.2 Result widths

| Operation | Input width | Result width | Overflow behavior |
| --- | --- | --- | --- |
| `AND` `OR` `XOR` `NAND` `NOR` `XNOR` | common width w | w | bitwise, no overflow |
| `NOT` `BUFFER` | operand width w | w | bitwise |
| `MUX(a, b, select)` | data common width w, select 1 bit | w | none |
| `ADD` `SUBTRACT` | common width w | w | wraps modulo 2^w (carry/borrow discarded) |
| `MULTIPLY` | common width w | 2w | exact; every product bit fits in 2w |
| `DIVIDE` | common width w | w | unsigned floor; divide by zero is a runtime error |
| `EQUAL` `LESS` `GREATER` | common width w | 1 | none |
| `COMPARE` | common width w | 2 | `00` equal, `01` less, `10` greater |
| `CONCAT` | any widths | sum of widths | none up to the width limit |
| `SLICE` / `data[hi:lo]` | operand width w | hi − lo + 1 | none |
| `SHIFT_LEFT` `SHIFT_RIGHT` | value width w | w | zero fill; shift ≥ w produces 0 |
| `DECODER` | select width w | 2^w | one-hot |
| `ENCODER` | input width w | max(1, ceil(log2 w)) | index of highest set bit; 0 → 0 |

A result width above the width limit (default 4096) is E320. In particular,
`MULTIPLY` on two 4096-bit buses would need 8192 bits and is rejected rather
than narrowed.

### 6.3 Rules that never surprise

- **Signals are not coerced to each other.** An 8-bit signal used where a
  4-bit signal is required is E308 unless it is explicitly sliced.
- **Literals are fitted, not truncated.** `AND(a, 3)` with an 8-bit `a` uses
  an 8-bit literal three; a literal whose value needs more bits than the
  context is E305.
- **Arithmetic wrapping is documented behavior**, not an accident. `Adder8`
  computes modulo 256 by design.
- **Constant expressions use their own widths.** In `x = ADD(1, 2)` the widest
  literal is 2 bits, so `x` is `11` (three, two bits). Use explicit literals
  such as `0b0011` when a specific width matters.
- **Comparisons compare unsigned values.** A bus is interpreted as an
  unsigned binary number from its most-significant to least-significant bit.

---

## 7. Built-in operations

All built-ins are case-insensitive. Every operation is a real graph node in
the IR; none is simulated as an opaque shortcut. Slices and constant fitting
are visible in the elaborated graph.

### 7.1 Logic gates

| Call | Args | Description |
| --- | --- | --- |
| `AND(a, b, ...)` | ≥ 2 | Bitwise AND across every operand |
| `OR(a, b, ...)` | ≥ 2 | Bitwise OR across every operand |
| `XOR(a, b, ...)` | ≥ 2 | Bitwise XOR; a result bit is 1 when an odd number of operand bits are 1 |
| `NAND`, `NOR`, `XNOR` | ≥ 2 | Inverted variadic forms |
| `NOT(x)` | 1 | Bitwise inversion |
| `BUFFER(x)` | 1 | Identity; useful for explicitly naming a wire |

All gate operands are bitwise over the common width. `AND`, `OR`, and `XOR`
are associative, so a multi-input call is equivalent to folding the two-input
form; in particular `XOR(a, b, c)` is parity. The inverted forms negate the
result of the corresponding multi-input gate: `NAND(a, b, c)` is
`NOT(AND(a, b, c))`, not a chain of two-input `NAND`s.

### 7.2 Arithmetic

| Call | Description |
| --- | --- |
| `ADD(a, b)` | Unsigned addition, result width w, modulo 2^w |
| `SUBTRACT(a, b)` | Unsigned subtraction, result width w, modulo 2^w |
| `MULTIPLY(a, b)` | Unsigned product, result width 2w; the full product is retained |
| `DIVIDE(a, b)` | Unsigned floor division; divisor zero is a **runtime** error (R500) |

Arithmetic is always 2-ary. A constant-zero divisor is rejected at compile
time (E309); a divisor that can become zero at runtime raises a
`SimulationError` with code `R500` instead of returning a plausible value.

A simulator starts with every input at zero. If that initial graph divides by
zero, the simulator remains openable, exposes `runtimeError`, and the studio
shows the error with the input controls still available. No initial output
snapshot is presented; supplying a safe divisor clears the error and resumes
normal evaluation.

### 7.3 Comparison

```logicflow
equal   = EQUAL(a, b)      # 1 when a == b
less    = LESS(a, b)       # 1 when a < b
greater = GREATER(a, b)    # 1 when a > b
order   = COMPARE(a, b)    # 00 equal, 01 less, 10 greater
```

Comparisons compare the unsigned integer values after literals are fitted to
the common width. The result is 1 bit (`COMPARE` is 2 bits), regardless of the
operand width.

### 7.4 Buses and selection

| Call | Description |
| --- | --- |
| `MUX(a, b, select)` | 1-bit `select`: 0 chooses `a`, 1 chooses `b` |
| `CONCAT(a, b, ...)` | Joins operands most-significant first: `CONCAT(hi, lo)` puts `hi` in the high bits |
| `SLICE(value, hi, lo)` | Inclusive slice; bounds are decimal literals |
| `SHIFT_LEFT(value, amount)` | Shifts toward the MSB, zero fill, same width |
| `SHIFT_RIGHT(value, amount)` | Shifts toward the LSB, zero fill, same width |
| `DECODER(select)` | One-hot decoder: w-bit select produces a 2^w-bit output |
| `ENCODER(value)` | Index of the highest set bit; 0 produces 0 |

`MUX` data inputs share a common width; the select is exactly one bit.
A multi-bit select is E303. Build wider selectors with nested `MUX`es or by
slicing a bus, exactly as `Mux4` does with `sel[0]` and `sel[1]`.

`SHIFT_LEFT(x, n)` and `SHIFT_RIGHT(x, n)` keep the width of `x`. Shifting by
at least the width produces zero. There is no rotate and no arithmetic shift
in 0.1. Shift amounts may be up to 32 bits wide.

`DECODER` output width is 2^w, so a 12-bit select is the largest that fits the
4096-bit limit. `ENCODER` of a 0 value is defined as 0, and ties do not exist
because it returns one index (the highest set bit).

### 7.5 Bus helpers

| Call | Result width | Behaviour |
| --- | --- | --- |
| `ZEXT(x, width)` | `width` | Zero-extends `x`. The width must not be smaller than `x` |
| `SEXT(x, width)` | `width` | Extends `x` by repeating its top bit |
| `POPCOUNT(x)` | `ceil(log2(width + 1))` | Counts the bits that are set |
| `REDUCE_AND(x)` | 1 | 1 only when every bit of `x` is 1 |
| `REDUCE_OR(x)` | 1 | 1 when any bit of `x` is 1 |
| `REDUCE_XOR(x)` | 1 | Parity of `x` |
| `REPEAT(x, count)` | `count x width` | Concatenates `x` with itself |
| `REVERSE(x)` | width of `x` | Reverses the bit order |

The width argument of `ZEXT` and `SEXT` and the count of `REPEAT` must be
decimal literals. Narrowing with `ZEXT` or `SEXT` is E332: use
`SLICE(value, 3, 0)` to narrow instead.

`POPCOUNT` is the usual way to count neighbours in a grid, and the reduce
operations fold a bus into a single bit without a tree of gates.

### 7.6 Operation reference

Every built-in, with its arguments, the width it produces, and a worked
example.

<!-- BEGIN GENERATED REFERENCE -->

This section is generated from the engine's operation registry. Every built-in lists its
arguments, the width it produces, and a worked example with the value it returns.

### Logic gates

#### `AND(a, b, ...)`

Bitwise AND. Result is 1 where every input bit is 1.

- **Arguments:** `a` — First input. · `b` — Second input. · `...` — Further inputs, all combined into one gate. (optional)
- **Result width:** Result width = common input width
- **Example:** `AND(1, 1, 0)` → `0` — The third bit is 0, so the whole result is 0.
- **Tip:** Variadic: AND(a, b, c) is one three-input gate, not a chain of two-input gates.

#### `OR(a, b, ...)`

Bitwise OR. Result is 1 where any input bit is 1.

- **Arguments:** `a` — First input. · `b` — Second input. · `...` — Further inputs, all combined into one gate. (optional)
- **Result width:** Result width = common input width
- **Example:** `OR(0, 1, 0)` → `1` — One input is high, so the result is high.
- **Tip:** Variadic. Useful for summing several conditions into one signal.

#### `XOR(a, b, ...)`

Bitwise XOR. Result is 1 where an odd number of inputs are 1.

- **Arguments:** `a` — First input. · `b` — Second input. · `...` — Further inputs, all combined into one gate. (optional)
- **Result width:** Result width = common input width
- **Example:** `XOR(1, 1, 0)` → `0` — Two of the three bits are high, which is even, so the result is 0.
- **Tip:** Parity: XOR(a, b, c) is 1 when an odd number of the bits are set.

#### `NAND(a, b, ...)`

Inverse of multi-input AND.

- **Arguments:** `a` — First input. · `b` — Second input. · `...` — Further inputs, all combined into one gate. (optional)
- **Result width:** Result width = common input width
- **Example:** `NAND(1, 1)` → `0` — AND of two high bits is 1, and NAND inverts that to 0.
- **Tip:** Negates the whole multi-input AND; it is not a chain of two-input NANDs.

#### `NOR(a, b, ...)`

Inverse of multi-input OR.

- **Arguments:** `a` — First input. · `b` — Second input. · `...` — Further inputs, all combined into one gate. (optional)
- **Result width:** Result width = common input width
- **Example:** `NOR(0, 0)` → `1` — Nothing is high, so the OR is 0 and NOR inverts that to 1.
- **Tip:** Negates the whole multi-input OR. Handy for "none of these" conditions.

#### `XNOR(a, b, ...)`

Inverse of multi-input XOR.

- **Arguments:** `a` — First input. · `b` — Second input. · `...` — Further inputs, all combined into one gate. (optional)
- **Result width:** Result width = common input width
- **Example:** `XNOR(1, 0)` → `0` — The bits differ, so the equality output is low.
- **Tip:** Equality per bit. Two inputs gives an equality check.

#### `NOT(x)`

Bitwise inversion of one input.

- **Arguments:** `x` — The value to invert.
- **Result width:** Result width = input width
- **Example:** `NOT(0)` → `1` — Inverting a low bit gives a high bit.
- **Tip:** Exactly one input. NOT(a) inverts every bit of a bus.

#### `BUFFER(x)`

Passes its input through unchanged.

- **Arguments:** `x` — The value to pass through.
- **Result width:** Result width = input width
- **Example:** `BUFFER(1)` → `1` — The value arrives unchanged.
- **Tip:** Names a wire explicitly. Keeps a graph readable when a signal is only a rename.

### Arithmetic

#### `ADD(a, b)`

Unsigned addition at the widest input width. Carry out is discarded.

- **Arguments:** `a` — First addend. · `b` — Second addend.
- **Result width:** Result width = common input width; wraps modulo 2^w
- **Example:** `ADD(0011, 0101)` → `1000` — 3 + 5 = 8, written in four bits.
- **Tip:** Carry out is dropped. Widen the bus if you need the carry.

#### `SUBTRACT(a, b)`

Unsigned modulo subtraction at the widest input width.

- **Arguments:** `a` — The value to subtract from. · `b` — The value to subtract.
- **Result width:** Result width = common input width; wraps modulo 2^w
- **Example:** `SUBTRACT(0000, 0001)` → `1111` — 0 - 1 wraps around to 15 in four bits.
- **Tip:** Borrow is dropped, so 0 - 1 wraps to the largest value.

#### `MULTIPLY(a, b)`

Unsigned multiplication. Result width is the sum of input widths.

- **Arguments:** `a` — First factor. · `b` — Second factor.
- **Result width:** Result width = 2 x common input width; the full product is kept
- **Example:** `MULTIPLY(0011, 0101)` → `00001111` — 3 x 5 = 15, written in the eight bits the result width gives.
- **Tip:** 8-bit x 8-bit gives a 16-bit result, so give the output room.

#### `DIVIDE(a, b)`

Unsigned integer division at the widest input width.

- **Arguments:** `a` — The value to divide. · `b` — The divisor. It must not be zero.
- **Result width:** Result width = common input width; unsigned floor division
- **Example:** `DIVIDE(0011, 0010)` → `0001` — 3 divided by 2 is 1, with the remainder discarded.
- **Tip:** Guard the divisor. A zero divisor is a runtime error (R500), not a silent zero.

### Comparison

#### `EQUAL(a, b)`

1 when all inputs are equal, otherwise 0.

- **Arguments:** `a` — First value to compare. · `b` — Second value to compare.
- **Result width:** 1-bit result; operands are compared as unsigned integers
- **Example:** `EQUAL(0011, 0011)` → `1` — The two four-bit values are the same.
- **Tip:** Literals are fitted to the bus width, so EQUAL(data, 0) checks the whole bus.

#### `LESS(a, b)`

1 when the first input is less than the second.

- **Arguments:** `a` — The value on the left of the comparison. · `b` — The value on the right of the comparison.
- **Result width:** 1-bit result; unsigned comparison
- **Example:** `LESS(0010, 0011)` → `1` — 2 is less than 3.
- **Tip:** Unsigned comparison. Use COMPARE when you need less/equal/greater together.

#### `GREATER(a, b)`

1 when the first input is greater than the second.

- **Arguments:** `a` — The value on the left of the comparison. · `b` — The value on the right of the comparison.
- **Result width:** 1-bit result; unsigned comparison
- **Example:** `GREATER(0011, 0010)` → `1` — 3 is greater than 2.
- **Tip:** Unsigned comparison, the mirror of LESS.

#### `COMPARE(a, b)`

Two-bit compare: 00 equal, 01 less, 10 greater.

- **Arguments:** `a` — The value on the left of the comparison. · `b` — The value on the right of the comparison.
- **Result width:** 2-bit result: 00 equal, 01 less, 10 greater
- **Example:** `COMPARE(0011, 0010)` → `10` — 3 is greater than 2, which the two-bit code reports as 10.
- **Tip:** One comparison, three outcomes. Slice the bits you need.

### Selection

#### `MUX(a, b, select)`

MUX(a, b, select): select 0 chooses a, select 1 chooses b.

- **Arguments:** `a` — Chosen when select is 0. · `b` — Chosen when select is 1. · `select` — One-bit choice.
- **Result width:** Result width = common width of a and b; select must be 1 bit
- **Example:** `MUX(1, 0, 0)` → `1` — select is 0, so the first input is passed through.
- **Tip:** Hardware selection. Chain MUXes for wider selects, and slice a bus for the select bit.

#### `DECODER(select)`

One-hot decoder. A w-bit select produces 2^w output bits.

- **Arguments:** `select` — The value to decode into one-hot bits.
- **Result width:** Result width = 2^w for a w-bit select
- **Example:** `DECODER(010)` → `00100` — The value 2 sets the third of the five output bits.
- **Tip:** One-hot output. A 12-bit select is the widest that fits the 4096-bit limit.

#### `ENCODER(value)`

Highest-set-bit encoder. Output width is ceil(log2(input width)).

- **Arguments:** `value` — The bus to encode.
- **Result width:** Result width = max(1, ceil(log2(input width)))
- **Example:** `ENCODER(0100)` → `10` — The highest set bit is bit 2, which is written 10 in two bits.
- **Tip:** Returns the index of the highest set bit. Zero encodes to zero.

### Bus operations

#### `CONCAT(a, b, ...)`

Joins buses most-significant argument first.

- **Arguments:** `a` — The part that ends up in the high bits. · `b` — The part that ends up in the low bits. · `...` — Further parts, placed below the previous one. (optional)
- **Result width:** Result width = sum of the operand widths
- **Example:** `CONCAT(1010, 0101)` → `10100101` — The first argument occupies the high nibble.
- **Tip:** The first argument ends up in the high bits: CONCAT(hi, lo).

#### `SLICE(value, hi, lo)`

SLICE(value, hi, lo), inclusive, down to bit 0.

- **Arguments:** `value` — The bus to read from. · `hi` — Highest bit to keep. · `lo` — Lowest bit to keep.
- **Result width:** Result width = hi - lo + 1; bounds are inclusive
- **Example:** `SLICE(10100101, 7, 4)` → `1010` — Bits 7 down to 4 are the high nibble.
- **Tip:** Same as value[hi:lo]. Bounds must be plain decimal literals.

#### `SHIFT_LEFT(value, amount)`

Shifts toward the MSB, filling with zeroes at the same width.

- **Arguments:** `value` — The value to shift. · `amount` — How many positions to shift by.
- **Result width:** Result width = value width; zero fill
- **Example:** `SHIFT_LEFT(0001, 2)` → `0100` — One shifted left twice becomes four.
- **Tip:** Shifting by at least the width produces 0. Bits shifted out are dropped.

#### `SHIFT_RIGHT(value, amount)`

Shifts toward the LSB, filling with zeroes at the same width.

- **Arguments:** `value` — The value to shift. · `amount` — How many positions to shift by.
- **Result width:** Result width = value width; zero fill
- **Example:** `SHIFT_RIGHT(0100, 1)` → `0010` — Four shifted right once becomes two.
- **Tip:** Logical shift, never arithmetic. Shifting by at least the width produces 0.

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

#### `POPCOUNT(x)`

Counts the bits that are set.

- **Arguments:** `x` — The bus to count.
- **Result width:** Result width = ceil(log2(width + 1))
- **Example:** `POPCOUNT(00001111)` → `0100` — Four bits are set, and four is written 0100 in four bits.
- **Tip:** Counts the ones in a bus. Handy for neighbour counts and parity checks.

#### `REDUCE_AND(x)`

1 only when every bit of the input is 1.

- **Arguments:** `x` — The bus to fold.
- **Result width:** Result width = 1
- **Example:** `REDUCE_AND(1111)` → `1` — Every bit is high, so the folded result is high.
- **Tip:** Folds a bus into a single bit: all ones.

#### `REDUCE_OR(x)`

1 when any bit of the input is 1.

- **Arguments:** `x` — The bus to fold.
- **Result width:** Result width = 1
- **Example:** `REDUCE_OR(0001)` → `1` — One bit is high, so the folded result is high.
- **Tip:** Folds a bus into a single bit: any one.

#### `REDUCE_XOR(x)`

Parity of the input bits.

- **Arguments:** `x` — The bus to fold.
- **Result width:** Result width = 1
- **Example:** `REDUCE_XOR(0011)` → `0` — Two bits are high, which is even parity.
- **Tip:** Folds a bus into a single bit: odd or even parity.

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

#### `HALF_ADDER(a, b) -> sum, carry`

One-bit half adder: sum = XOR(a, b), carry = AND(a, b).

- **Arguments:** `a` — First bit to add. · `b` — Second bit to add.
- **Outputs:** sum, carry
- **Result width:** All ports are 1 bit
- **Example:** `HALF_ADDER(1, 1)` → `sum = 0, carry = 1` — One plus one is two: the sum bit is 0 and the carry is 1.
- **Tip:** Elaborates to real gates in the graph, so you can inspect the internals.

#### `FULL_ADDER(a, b, carry_in) -> sum, carry_out`

One-bit full adder built from two half adders and an OR gate.

- **Arguments:** `a` — First bit to add. · `b` — Second bit to add. · `carry_in` — Carry from the previous stage.
- **Outputs:** sum, carry_out
- **Result width:** All ports are 1 bit
- **Example:** `FULL_ADDER(1, 1, 1)` → `sum = 1, carry_out = 1` — One plus one plus a carry in is three.
- **Tip:** Built from two half adders. Chain them for ripple-carry addition.

<!-- END GENERATED REFERENCE -->

### 7.7 Circuit-shaped built-ins

`HALF_ADDER(a, b) -> {sum, carry}` and
`FULL_ADDER(a, b, carry_in) -> {sum, carry_out}` are ordinary circuits that
elaborate to primitive gates in the same IR. They are not opaque library
cells; their internals appear in the graph.

```logicflow
first = FULL_ADDER(a, b, carry_in)
sum = first.sum
OUTPUT sum
OUTPUT first.carry_out
```

---

## 8. Composition

### 8.1 Defining and instantiating

```logicflow
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

  first  = HalfAdder(a, b)
  second = HalfAdder(first.sum, carry_in)

  sum = second.sum
  carry_out = OR(first.carry, second.carry)

  OUTPUT sum
  OUTPUT carry_out
END
```

- A circuit must be declared at the top level; it may be instantiated before
  its definition appears in the file.
- Instances are named. The name creates a scope in the elaborated graph, and
  its outputs are read with dotted paths.
- Positional arguments bind in the order of the circuit's `INPUT`
  declarations.
- Named arguments may appear in any order and must cover every input:
  `first = HalfAdder(b = y, a = x)`.
- Mixing positional and named arguments is E306.
- Missing or extra positional arguments are E307; unknown names are E204;
  duplicate connections are E209; unconnected inputs are E205.
- Every input connection is width-checked with the same rules as any other
  expression (literals fit; signals must match).

### 8.2 Instance outputs

- `instance.port` accesses a port whose name is the *last segment* of one of
  the target's `OUTPUT` declarations.
- If two outputs share a last segment, the short form is ambiguous and the
  full dotted name must be used.
- Nested outputs chain naturally: `outer.inner.value`.
- Reading an instance itself, without a port, is E213. Reading a port that
  does not exist is E204, with a suggestion when one is close.

### 8.3 Elaboration and recursion

- Instantiation is **flattened**. The IR for a top-level circuit contains one
  node per gate in every instantiated copy, with scope paths identifying where
  each node came from. Two uses of `HalfAdder` become two scopes, not one
  shared circuit.
- Recursion is rejected at compile time with E324, including mutual recursion.
  Feedback must go through `STATE`, never through instantiation.
- Nesting depth is capped at 32 and instances per top-level circuit at 500,
  keeping elaboration and the graph view predictable.

---

## 8b. Constants and loops

Some structure is easier to write than to draw. `CONST` names a compile-time
whole number, and `FOR` repeats a block once per value. Both are resolved
before the design is analysed, so every limit still applies to the finished
circuit.

### 8b.1 Constants

```logicflow
CONST W = 4
CONST H = W + 1

CIRCUIT Sized
  INPUT data : BUS(W * 2)

  OUTPUT value
  value = data[H - 1]
END
```

- `CONST` is declared at the top level, before the circuits.
- A constant is a whole number. Compile-time arithmetic supports `+`, `-`,
  `*`, `/`, and `%`, with parentheses for grouping.
- Constants can be used in widths, bit indexes, slice bounds, loop bounds, and
  other constants.
- A name that is not a constant or a loop variable is E401.

### 8b.2 Loops

```logicflow
CIRCUIT Bits
  INPUT data : BUS(4)

  FOR i IN 0..3
    bit[i] = data[i]
  END

  OUTPUT bit[0]
  OUTPUT bit[3]
END
```

- The range is inclusive at both ends: `0..3` runs four times.
- The loop variable is a compile-time value. It can be used in bit indexes,
  slice bounds, widths, and names.
- An assignment inside a loop needs an index, such as `bit[i]`, so each
  iteration gets its own signal. A plain name is E406.
- An indexed name becomes a plain one: `bit[0]` is written `bit_0`, and
  `cell[0].out` is written `cell_0.out`.
- Instances made in a loop are read back with the same indexed form, for
  example `cell[0].next`.
- A reversed or empty range is skipped with a warning (W401).
- Loops can be nested up to four deep (E404), and a loop that expands to more
  than 20,000 statements is E405.

---

## 8c. Parameterized circuits

A circuit can take compile-time parameters, usually a width, so one definition
serves many sizes.

```logicflow
CIRCUIT Register(N = 8)
  INPUT data : BUS(N)
  INPUT clock

  STATE q : BUS(N) = 0

  ON RISING_EDGE(clock):
    q = data
  END

  OUTPUT q
END

CIRCUIT Main
  INPUT wide : BUS(16)
  INPUT clock

  small = Register(data = wide[7:0], clock = clock)
  big = Register<16>(data = wide, clock = clock)

  OUTPUT small.q
  OUTPUT big.q
END
```

- Parameters are whole numbers with an optional default, declared in the
  circuit's parentheses: `CIRCUIT Register(N = 8)`.
- A parameter is used like a constant inside the circuit: in widths, indexes,
  and slice bounds.
- An instance gives values with `Name<16>(...)` or by name,
  `Name<N = 16>(...)`. A value that is not given uses the default.
- Each parameter set elaborates to its own copy of the circuit, so two
  instances with different widths stay independent.
- A parameter that does not exist is E408, and parameters on a circuit that
  has none is E409.

---

## 9. State and clocking

### 9.1 Edge blocks

```logicflow
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
```

An `ON` block has three parts:

1. An edge kind — `RISING_EDGE` or `FALLING_EDGE`.
2. A clock reference in parentheses. The reference must be 1 bit.
3. A body of state assignments and nested `IF` blocks, closed by `END`.

Inside the body:

- Only `STATE` signals of the enclosing circuit may be assigned (E220).
- A sequential assignment target is a single state name (E207).
- `IF condition:` requires a 1-bit condition. `ELSE:` is optional and closes
  with the same `END` that closes the `IF`.
- Conditions may reference inputs, state, combinational signals, and instance
  outputs.
- A nested `IF` chain deeper than 64 levels is E107.

### 9.2 Next-state semantics

Inside a clocked block, every expression is evaluated against the **old**
state and the **new** inputs. The updates are collected and committed
together; no assignment inside a block can observe another update from the
same edge.

```logicflow
CIRCUIT Swap
  INPUT clock

  STATE a = 1
  STATE b = 0

  ON RISING_EDGE(clock):
    a = b
    b = a
  END

  OUTPUT a
  OUTPUT b
END
```

After a rising edge, `a` is 0 and `b` is 1: both right-hand sides saw the
pre-edge values. This atomic-commit rule is what makes register banks,
counters, and pipelines deterministic.

`IF` is lowered to a `MUX` over hold and update values. A state that is not
assigned along a path **holds** its current value:

```logicflow
ON RISING_EDGE(clock):
  IF enable:
    stored = data
  END
END
```

is exactly `stored_next = MUX(stored, data, enable)` in graph terms.

Consequences:

- Assigning the same state twice along one path keeps the last assignment
  (W303 warns).
- Assigning the same state in both `IF` branches is fine; it lowers to a
  single mux.
- The analyzer rejects two `ON` blocks that drive the same state on the same
  edge and clock (E312). Two blocks on different clocks can fire in the same
  step; if both write the same state with different values the simulator
  raises R405 rather than picking a winner.

### 9.3 Simulation timeline

The simulator is event-driven around input mutations:

1. Apply every input change in one call as a single transition.
2. Evaluate all combinational nodes against the new inputs and the **old**
   state.
3. Compare each event clock's value to its previous value and fire events on
   0 → 1 (rising) or 1 → 0 (falling) transitions.
4. Evaluate every fired event's update expressions against the graph built in
   step 2, then commit all state updates at once.
5. Re-evaluate combinational nodes with the new state and record the new clock
   baseline.

`setInputs({ clock: "0", data: "10101010" })` is one transition; a later
`setInput("clock", "1")` is the edge. Mutating several inputs at once cannot
manufacture an intermediate edge that never appeared in the graph.

`Simulator.reset()` restores every state to its declared initial value and
re-captures the clock baseline, so a reset never fires an edge by itself.
`clearInputs()` drives every input to zero as a transition (and can therefore
fire falling-edge events).

A clock that is a constant produces W301 at compile time; a block that updates
nothing produces W302 and is omitted from the IR.

### 9.4 Clocked circuits and the tooling

- Interactive simulation supports clocked circuits fully: input toggles are
  transitions, and `firedEvents` in the snapshot lists the events that fired.
- The static test runner does **not** run clocked circuits. Such suites are
  reported as unsupported rather than assumed to pass (Section 10.4).
- Truth tables are only meaningful for combinational circuits and report a
  reason instead of enumerating clocked designs (Section 11).

---

## 10. Tests

### 10.1 Shape

```logicflow
TEST HalfAdder
  CASE "0 + 1"
    INPUT a = 0
    INPUT b = 1
    EXPECT sum = 1
    EXPECT carry = 0
  END
END
```

- `TEST` names a circuit. The suite runs against that circuit's compiled IR.
- A suite contains one or more `CASE` blocks and ends with `END`.
- A `CASE` label is optional. When present it may be a quoted string or a bare
  name. Defaults are `Case 1`, `Case 2`, …
- An empty test suite is E211; a case with no `EXPECT` is E221.

### 10.2 Input requirements

For a combinational case, every input of the target circuit must be assigned
(E205). Assignments are checked for duplicates (E209) and unknown names (E201,
with a suggestion). This strictness is intentional: an unset input would
silently be zero, and a test that appears to pass could be testing the wrong
thing.

A case that uses `STEP`, `CYCLE`, or `LOAD` is sequential. In a sequential
case an input may be set more than once, and an input that is never set keeps
its last value, starting from zero.

### 10.3 Test value literals

Test values containing only `0` and `1` characters are **binary**, even
without a leading zero:

```logicflow
INPUT flags = 10       # "10" is binary two in a test
INPUT flags = 0b1010   # binary ten → value 10
INPUT flags = 0x0A     # hexadecimal ten → value 10
INPUT count = 12       # decimal twelve (the digit 2 forces decimal)
```

Decimal values can always be written with a `0x` or `0b` prefix, or
underscores for grouping. A test value that does not fit the port width is
E305.

### 10.4 Expectations and running

- `EXPECT port = value` compares the **full binary value** of the output,
  including leading zeroes. `EXPECT sum = 00000011` and `EXPECT sum = 11` are
  different literals: the first is 8 bits, the second is binary two.
- Expectations may use dotted instance paths (`EXPECT result.sum = 1`) or the
  short port name when unambiguous. A `STATE` signal can be checked too:
  `EXPECT count = 0011`.
- An expectation is checked at the point where it appears, against the
  circuit at that moment.
- A runtime error inside a case (for example division by zero) fails that case
  with the error message recorded in its result rows.

### 10.5 Recording a case

The studio can write the test for you. **Record test** captures what you do in
the simulator, and **Expect this** captures the value a signal holds right
now. Stopping asks for a case name, shows the generated code, and writes it
into the source — adding the case to an existing `TEST` block when the circuit
already has one.

The result is ordinary LogicFlow, using the statements above. The recorder
never hides the code, so reading what it wrote is a good way to learn the
syntax.

### 10.6 Clocked test sequences

A case may drive a circuit through time. Each case starts from a fresh
simulator, with every `STATE` at its declared initial value.

| Statement | Meaning |
| --- | --- |
| `INPUT name = value` | Sets an input. The combinational graph is re-evaluated against the current state |
| `STEP ... END` | Groups input changes into one simulation step. Every input set inside the step applies together, then edges fire and state commits atomically |
| `CYCLE clock N` | Pulses a clock 0 → 1 → 0, N times. It fires N rising edges and N falling edges |
| `LOAD state = value` | Forces a state to a value, for tests that need a specific starting point |
| `EXPECT name = value` | Checks an output or a state against the circuit at that moment |

Statements run top to bottom, in order. A failing expectation reports the
case, the step number, the signal, the expected value, and the actual value,
and the case stops at the first failure.

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

Rules:

- `CYCLE` needs a one-bit input; anything else is E303.
- `LOAD` needs a `STATE` signal; anything else is E230. It may not appear
  inside a `STEP` (E232).
- `CYCLE` closes a high clock phase first, so every cycle contains a rising
  edge even when the clock started high.
- The step counter advances for every input change, step, and cycle, which is
  what the failure message reports.

---

## 11. Truth tables

`generateTruthTable(circuit)` enumerates **every input combination** for a
combinational circuit:

- Inputs are enumerated in declaration order. Row *n* is the binary
  representation of *n*, most-significant input first; with inputs `a` and `b`,
  the rows are `00`, `01`, `10`, `11`.
- Bus inputs are enumerated as bit groups; an 8-bit input contributes 256 rows.
- Outputs use the circuit's declared widths and are reported as zero-padded
  binary strings.

```text
a b | sum carry
0 0 |  0    0
0 1 |  1    0
1 0 |  1    0
1 1 |  0    1
```

Limits and reasons (the table returns `rows: []` plus a human-readable
`reason` instead of partial data):

- Clocked circuits: truth tables apply to combinational logic only.
- More than 12 input bits by default (configurable up to 20 through
  `TruthTableOptions.maxInputBits`, at 2^n rows).
- More rows than `maxRows` (default 2^maxInputBits).

---

## 12. Diagnostics and failure behavior

### 12.1 Shape of a diagnostic

Every diagnostic carries:

| Field | Meaning |
| --- | --- |
| `code` | Stable identifier such as `E301` (errors), `W301` (warnings), `R500` (runtime) |
| `severity` | `error`, `warning`, or `info` |
| `message` | What happened, in plain language |
| `line`, `column`, `length` | 1-based source location |
| `hint` | How to fix it, often with a concrete snippet |
| `related` | Additional locations, such as the first definition of a duplicate |

Diagnostics are sorted by line, then column, then code. Compilation stops
collecting after `maxDiagnostics` (default 100) and reports what it has.

### 12.2 Plain-language messages

Every diagnostic keeps its stable code, but the headline and the explanation
are written for someone who has never used a compiler:

> **These two signals are different sizes**
> You're adding an 8-bit signal (a) to a 4-bit signal (b). Add can only
> combine signals of the same size.

When the mistake is a name, the diagnostic also offers a one-click fix:

> **There is no signal with that name**
> Check the spelling, or declare the signal before using it.
> [Replace with \`carry\`]

The fix rewrites that range in the source and recompiles. The same plain text
is used by the studio, the editor hover, and any other host, so an error never
reads differently depending on where you meet it.

### 12.3 Diagnostic families

**Lexical (E0xx)**

| Code | Meaning |
| --- | --- |
| `E001` | Unterminated string literal |
| `E002` | Unexpected character |

**Syntax (E1xx)**

| Code | Meaning |
| --- | --- |
| `E100` | Expected `CIRCUIT` or `TEST` at top level |
| `E101` | Missing `END` for a circuit |
| `E102` | Keyword in a position where it is not valid |
| `E103` | Expected a declaration or assignment |
| `E104` | Input declaration with a value |
| `E105` | Expected `RISING_EDGE`/`FALLING_EDGE` after `ON` |
| `E106` | Expected `IF` or a state assignment inside a clocked block |
| `E107` | `IF` nesting exceeds the supported depth |
| `E108` | Expected `CASE` or `END` inside a test |
| `E109` | Missing `END` for a test |
| `E110` | Expected `INPUT`, `EXPECT`, or `END` in a case |
| `E111` | Missing `END` for a case |
| `E112` | Invalid width (not a positive whole number) |
| `E113` | Expected a width such as `8` or `BUS(8)` |
| `E114` | Expected a value or expression |
| `E115` | Expected a comma or closing parenthesis |
| `E116` | Positional argument after a named argument |
| `E117` | Expected a number literal |
| `E118` | Invalid number literal |
| `E119` | Expected end of line |
| `E120`–`E123` | Expected symbol, keyword, identifier, or token |
| `E124` | `STEP` is missing its `END` |
| `E125` | Invalid cycle count |
| `E126` | Unexpected statement inside a `STEP` block |

**Names, wiring, and ports (E2xx)**

| Code | Meaning |
| --- | --- |
| `E200` | Reserved word used as a name |
| `E201` | Unknown signal, input, or output (with suggestion and available names) |
| `E202` | Duplicate circuit or signal definition |
| `E203` | `TEST` refers to an unknown circuit |
| `E204` | Unknown circuit port or instance output |
| `E205` | Missing input connection (test case or instance) |
| `E207` | Assignment target is not a single name |
| `E208` | Duplicate output declaration |
| `E209` | Duplicate connection, assignment, or expectation |
| `E210` | Unknown component or function |
| `E211` | Test suite has no cases |
| `E212` | Port access on a scalar signal |
| `E213` | Circuit instance used as a value |
| `E214` | Slice index is not a non-negative integer |
| `E215` | Slice `hi` smaller than `lo` |
| `E216` | Bit index outside the signal width |
| `E217` | Instance call used inside an expression |
| `E218` | Named arguments passed to a built-in |
| `E219` | Slice bound is not a decimal literal |
| `E220` | Non-state signal assigned in a clocked block |
| `E221` | Test case has no expectations |
| `E230` | `LOAD` target is not a state signal |
| `E231` | `CYCLE` clock is not an input of the circuit |
| `E232` | `LOAD` used inside a `STEP` block |

**Widths, elaboration, and clocking (E3xx)**

| Code | Meaning |
| --- | --- |
| `E301` | Operands have incompatible widths |
| `E302` | Wrong number of arguments |
| `E303` | Invalid width, or a signal that must be 1 bit is not |
| `E304` | State has neither width nor initial value |
| `E305` | Value or literal does not fit the target width |
| `E306` | Mixed positional and named instance arguments |
| `E307` | Wrong number of instance inputs |
| `E308` | Signal width does not match context |
| `E309` | Division by a constant zero |
| `E310` | Combinational feedback cycle |
| `E312` | Same state driven by two blocks on one edge |
| `E320` | Expansion or width limit exceeded |
| `E332` | `ZEXT` or `SEXT` would narrow the value |
| `E321` | Duplicate node ID (internal graph consistency) |
| `E322` | Instance-expansion limit exceeded |
| `E323` | Internal instance-binding error |
| `E324` | Recursive instantiation |
| `E999` | Internal compiler failure (source is left untouched) |

**Warnings**

| Code | Meaning |
| --- | --- |
| `W301` | A clock is a constant and can never trigger |
| `W302` | A clocked block updates no state |
| `W303` | A state is assigned more than once along one clock path |

### 12.4 Runtime errors

Simulation raises `SimulationError` with a stable code and fails the
transition rather than returning a plausible value:

| Code | Meaning |
| --- | --- |
| `R400` | Unknown input name |
| `R401` | Input value out of range for its width |
| `R402` | Input string is neither binary nor `0x` hexadecimal |
| `R403` | Bit toggle outside the input width |
| `R404` | IR references a node that could not be evaluated |
| `R405` | Two clock events wrote conflicting values to one state |
| `R406` | Unsupported operation in the IR |
| `R407` | Combinational loop found while ordering the graph |
| `R408` | IR references a missing node |
| `R500` | `DIVIDE` by zero |

The studio clears live values, the snapshot, and stored-state monitors whenever
a fatal compile or runtime error occurs; a compile failure also clears the
circuit graph. A stale, plausible output is never left on screen. A
divide-by-zero in the initial all-zero input state is shown the same way, but
the input controls remain available so a safe divisor can be entered.

### 12.5 Suggestions

Unknown names are matched against the actual candidates with a bounded
edit distance, including case-insensitive matches. Diagnostics prefer telling
you the exact fix over merely stating what failed:

```text
E201 Unknown signal "cary".
     Did you mean "carry"? Available signals: a, b, sum, carry.
```

---

## 13. Limits

All limits are compile options (`CompileOptions`) with defaults; the numbers
below are the shipped values.

| Limit | Default | Option | Notes |
| --- | --- | --- | --- |
| Maximum signal width | 4096 bits | `maxWidth` | Applies to declarations, literals, slices, CONCAT |
| Maximum graph nodes | 20 000 | `maxNodes` | Across the whole compiled program |
| Maximum nesting depth | 32 | `maxDepth` | Circuit instantiation chain |
| Maximum instances | 500 | `maxInstances` | Per top-level circuit |
| Maximum diagnostics | 100 | `maxDiagnostics` | Extra diagnostics are dropped, not truncated |
| `IF` nesting depth | 64 | — | Parser limit |
| Truth-table input bits | 12 (up to 20) | `TruthTableOptions.maxInputBits` | Row count is 2^bits |

---

## 14. Formatting

`formatSource(source)` is a conservative formatter:

- Normalizes line endings to `\n`.
- Trims trailing whitespace and collapses runs of blank lines.
- Re-indents nested `CIRCUIT`/`TEST`/`CASE`/`IF`/`ELSE`/`ON` blocks with two
  spaces.
- Uppercases the leading keyword of a line, for example `on` → `ON` and
  `circuit` → `CIRCUIT`.
- **Does not** touch comments, signal case, literal spelling, inline keywords
  such as `RISING_EDGE`, or expression contents.

Formatting runs on text, not on the AST, so it is safe to use while a program
is temporarily broken. In the web app, `Mod-S` formats and recompiles.

---

## 15. Worked examples

### 15.1 Half adder with tests

```logicflow
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
  CASE "1 + 1"
    INPUT a = 1
    INPUT b = 1
    EXPECT sum = 0
    EXPECT carry = 1
  END
END
```

### 15.2 8-bit adder: documented modular width

```logicflow
CIRCUIT Adder8
  INPUT a : BUS(8)
  INPUT b : BUS(8)

  sum = ADD(a, b)

  OUTPUT sum
END

TEST Adder8
  CASE "carry wraps"
    INPUT a = 11111111
    INPUT b = 00000001
    EXPECT sum = 00000000
  END
END
```

### 15.3 Register with enable

```logicflow
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
```

### 15.4 Counter with synchronous reset

```logicflow
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
```

### 15.5 Reusable ALU slice with selection

```logicflow
CIRCUIT LogicUnit
  INPUT a : BUS(8)
  INPUT b : BUS(8)
  INPUT mode : BUS(2)

  band = AND(a, b)
  bor = OR(a, b)
  bxor = XOR(a, b)
  bnot = NOT(a)

  low = MUX(band, bor, mode[0])
  high = MUX(bxor, bnot, mode[0])
  result = MUX(low, high, mode[1])

  OUTPUT result
END
```

---

## 16. Style guide

- Name signals after meaning, not shape: `next_count` beats `n2`.
- Keep one concept per line; the graph is easier to read than a deeply nested
  call.
- Prefer named intermediates over repeating subexpressions; the compiler
  deduplicates nothing, and readability is the point.
- Use `BUS(n)` in declarations; use `: n` only for quick scratch work.
- Give state an explicit initial value. A reset that depends on today's
  default is tomorrow's surprise.
- Test boundary values: zero, all ones, and the value just past the wrap
  point.
- Clocked blocks should update state and nothing else; compute next-state
  values as combinational signals above the `ON` block.

---

## 17. Snippets and editor assistance

The language ships with a snippet library and per-operation documentation.
Both live in the engine (`LANGUAGE_SNIPPETS`, `BUILTINS`), so any host can reuse
them.

### 17.1 Operation metadata

Every built-in carries, in addition to its arity and description:

| Field | Example (`XOR`) | Meaning |
| --- | --- | --- |
| `signature` | `XOR(a, b, ...)` | The exact call shape |
| `widthRule` | `Result width = common input width` | How the result width is decided |
| `tip` | `Parity: XOR(a, b, c) is 1 when an odd number of the bits are set.` | A practical usage note |

The studio shows this metadata in two places: the hover card that appears when
the pointer rests on an operation, and the information panel of the completion
list. The same data generates the operation tables in the built-in
documentation page.

### 17.2 Snippets

A snippet is a template with placeholder fields. The editor inserts the
template and moves through the placeholders with `Tab`.

| Category | Examples |
| --- | --- |
| `structure` | Circuit |
| `signal` | Scalar input, bus input, output, state, assignment, bus slice, concatenate |
| `sequential` | Rising-edge block, falling-edge block, conditional update, conditional update with else |
| `test` | Test suite, test case |
| `pattern` | Multiplexer, half adder, 4:1 multiplexer, register with enable, counter with reset |

The library is exposed as `LANGUAGE_SNIPPETS` and rendered in the
documentation page with copy buttons.

### 17.3 Editor assistance

The studio editor is context aware:

- **Completions** offer built-ins, keywords, snippets, and the signals that
  exist in the current file. After `instance.` only the ports that instance
  exposes are offered.
- **Hover cards** explain an operation (signature, width rule, tip), a keyword,
  or one of your own signals.
- **Diagnostics** stay in sync with the editor, and clicking one jumps to its
  line.
