# Short Circuit: Feature Specification

> **Historical document.** This file records the original feature proposals. The
> language has since moved in a different direction: `FOR`, `CONST`, circuit and
> call parameters, `IF`/`ELSE`, infix operators, and generic word-level built-ins
> were removed. Gates, selection, and fixed-width arithmetic now live in
> packages. See [FUNDAMENTALS.md](../FUNDAMENTALS.md) for the architecture and
> [LANGUAGE.md](LANGUAGE.md) for the current language. Sections below that
> describe those removed proposals are retained only as design history.

Proposed features for LogicFlow (`logicflow/0.2`) and the Short Circuit studio. Each entry gives a summary, the expected behaviour, an example, and notes on errors or edge cases. All syntax shown is **proposed**, not necessarily implemented.

Priority key: **P1** = do first, **P2** = next, **P3** = later.

---

## Part 1: Make the simulator complete

### 1. Clocked test sequences (P1)

**What it is.** Today, `TEST` blocks only work on combinational circuits, and clocked circuits are reported as unsupported. This feature adds a time dimension to tests so registers, counters, state machines and Life-style grids can be verified in the language itself.

**Expected behaviour**

- Each `CASE` starts from a fresh simulator, with every `STATE` at its declared initial value.
- Statements inside a `CASE` run top to bottom, in order.
- `INPUT name = value` sets an input. The combinational graph re-evaluates against the current state.
- `STEP ... END` groups input changes into one simulation step. All inputs set inside a `STEP` apply together, then edges fire and state commits atomically.
- `CYCLE clock N` is shorthand for pulsing a clock 0 → 1 → 0, N times. It fires N rising edges and N falling edges.
- `EXPECT name = value` can appear anywhere. It checks the whole binary value, leading zeroes included, against the circuit at that moment. It works on outputs and on `STATE` signals.
- `LOAD state = value` forces a state to a value at the start of a case, for tests that need a specific starting condition.
- A failing `EXPECT` reports the case, the step number, the signal, the expected value and the actual value. The case stops at the first failure.

**Example: counter**

```
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
```

**Example: edge-level control with STEP**

```
CASE "holds when enable is low"
  INPUT enable = 0
  INPUT data = 11110000
  STEP
    INPUT clock = 1
  END
  EXPECT stored = 00000000
END
```

**Example: testing Life4 (blinker)**

```
TEST Life4
  CASE "blinker flips"
    LOAD grid = 0000000001110000
    CYCLE clock 1
    EXPECT grid = 0000001000100010
    CYCLE clock 1
    EXPECT grid = 0000000001110000
  END
END
```

**Failure output**

```
FAIL Counter4 / "counts three ticks"
  after CYCLE clock 3 (step 6)
  EXPECT count: expected 0011, got 0010
```

**Notes**

- Setting an input that doesn't exist is a compile error with a name suggestion, as for combinational tests.
- Unset inputs keep their last value. Combinational-only tests keep today's rule that every input must be set in every case.
- `CYCLE` on a non-1-bit signal is a compile error.
- `LOAD` on a non-state signal is a compile error.

---

### 2. Waveform and trace panel (P1)

**What it is.** A timeline view that records the simulation over time, so sequential behaviour can be seen rather than inferred from the current snapshot.

**Expected behaviour**

- A new **Waveform** tab sits beside Circuit, Truth table, Tests and IR.
- Every input, output and `STATE` signal gets a row. One-bit signals draw as high/low lines. Buses draw as labelled segments (hex, binary or decimal, switchable).
- Each clock toggle, input change or test step appends one sample to the history.
- Rising and falling edges that fired are marked on the time axis.
- Runtime errors (for example R500, divide by zero) are marked at the step where they occurred.
- Running a clocked test fills the panel with that case's full trace, so a failure can be inspected at the failing step.
- The time axis is zoomable and scrollable. **Reset** clears the history.
- **Export VCD** downloads the trace for GTKWave and similar tools. **Export JSON** downloads it in a simple structured form.

**Example.** Running the counter test above should show `clock` toggling six times and `count` stepping 0000 → 0001 → 0010 → 0011, with a marker on each rising edge.

**Notes**

- History is capped (for example 10,000 samples), and the cap is stated in the UI rather than truncating silently.

---

### 3. Simulation dock controls (P1)

**What it is.** Quality-of-life controls so sequential circuits can be driven without editing the source.

**Expected behaviour**

- **Step** button: toggles the selected clock input through one full cycle (0 → 1 → 0).
- **Run / Pause** with a speed setting (for example 1, 2, 5, 10 Hz) that auto-cycles the clock.
- **Set state:** `STATE` rows in the dock are editable. Typing a binary value and confirming forces that state and re-evaluates the graph.
- **Reset** returns every state to its declared initial value and clears the trace.
- If a circuit has more than one clock, the dock lists each separately and **Step** acts on the selected one.

**Example.** Open `Life4`, set `grid` to `0000000001110000`, press **Step** twice, and watch the blinker flip and flip back, with no source edits.

**Notes**

- A forced state value of the wrong width is rejected with a message showing the expected width.

---

## Part 2: Make the language scale

### 4. Generate loops and compile-time constants (P1)

**What it is.** `FOR` loops that stamp out repeated wiring at compile time, plus named constants. This removes the biggest pain from the Life example, where 16 instances were wired by hand.

**Expected behaviour**

- `CONST NAME = expression` defines a compile-time integer.
- `FOR i IN lo..hi ... END` repeats its body once per value of `i`, inclusive of both ends.
- Loop variables and constants can be used in bit indexes, slice bounds, widths, and instance names.
- Compile-time arithmetic supports `+ - * / %` on integers. This is allowed only in constant contexts, and does not conflict with the no-infix-operators rule for signals.
- Instances created in a loop form an indexed array, read as `cell[i].next`.
- Loops are fully unrolled before analysis, so every limit (nodes, instances) still applies to the unrolled result.
- Nested `FOR` loops are allowed up to a depth limit.

**Example: Life on any grid size**

```
CONST W = 4
CONST H = 4

CIRCUIT Life
  INPUT clock
  STATE grid : BUS(W*H) = 0

  FOR r IN 0..H-1
    FOR c IN 0..W-1
      up    = (r + H - 1) % H
      down  = (r + 1) % H
      left  = (c + W - 1) % W
      right = (c + 1) % W

      cell[r][c] = Cell(
        grid[r*W + c],
        grid[up*W + left],   grid[up*W + c],   grid[up*W + right],
        grid[r*W + left],                      grid[r*W + right],
        grid[down*W + left], grid[down*W + c], grid[down*W + right])
    END
  END

  ON RISING_EDGE(clock):
    grid = nextgrid
  END
  OUTPUT grid
END
```

Changing `W` and `H` to 8 gives an 8x8 board with no other edits.

**Errors**

- Loop bound not constant: `E4xx: FOR bounds must be constants`.
- Empty or reversed range: warning, body skipped.
- Unrolling exceeds `maxNodes` or `maxInstances`: the normal limit diagnostic, pointing at the loop line.

---

### 5. Parameterized circuits (P2)

**What it is.** Circuits that take compile-time parameters, usually a width, so one definition serves many sizes.

**Expected behaviour**

- `CIRCUIT Name(P1 = default, P2 = default)` declares parameters. Defaults are optional.
- Parameters can be used wherever a constant is allowed, including `BUS(N)`.
- An instance supplies parameters with `Name<value>(...)` or by name: `Name<N = 16>(...)`.
- Each distinct parameter set elaborates to its own flattened copy.
- Recursion remains an error, including through parameters.

**Example**

```
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
  INPUT d : BUS(16)
  INPUT clock
  r = Register<16>(d, clock)
  OUTPUT r.q
END
```

**Errors**

- Instantiating without a value for a parameter that has no default is a compile error.
- A parameter value of zero or less where a width is expected is a compile error.

---

### 6. Bus helper built-ins (P1)

**What it is.** Small operations that currently have to be built by hand, such as the `CONCAT(000, n0)` pattern used eight times in the Life cell.

| Call | Result width | Behaviour |
| --- | --- | --- |
| `ZEXT(x, w)` | w | Zero-extend `x` to `w` bits. Error if `w` is smaller than the width of `x`. |
| `SEXT(x, w)` | w | Sign-extend by repeating the top bit. |
| `POPCOUNT(x)` | ceil(log2(width+1)) | Number of set bits in `x`. |
| `REDUCE_AND(x)` | 1 | 1 only if every bit of `x` is 1. |
| `REDUCE_OR(x)` | 1 | 1 if any bit of `x` is 1. |
| `REDUCE_XOR(x)` | 1 | Parity of `x`. |
| `REPEAT(x, n)` | n \* width | Concatenates `x` with itself `n` times. |
| `REVERSE(x)` | width | Reverses bit order. |

**Example: Life cell with POPCOUNT**

```
CIRCUIT Cell
  INPUT alive
  INPUT neighbours : BUS(8)

  total = POPCOUNT(neighbours)
  next  = OR(EQUAL(total, 3), AND(alive, EQUAL(total, 2)))

  OUTPUT next
END
```

This replaces the eight widening lines and the three-level `ADD` tree.

---

### 7. Infix operators as sugar (P3)

**What it is.** Optional operator syntax that compiles to the same built-in calls, for readability.

**Expected behaviour**

- Operators: `&` AND, `|` OR, `^` XOR, `~` NOT, `+` ADD, `-` SUBTRACT, `*` MULTIPLY, `/` DIVIDE, `==` EQUAL, `<` LESS, `>` GREATER, `<<` and `>>` shifts.
- Precedence follows C conventions, and parentheses override it.
- The function-call form stays valid, and both produce identical IR.
- Width rules are unchanged: `a + b` with mismatched widths is still E301.
- The formatter never rewrites one form into the other.

**Example**

```
sum   = a ^ b ^ carry_in
carry = (a & b) | (carry_in & (a ^ b))
```

---

### 8. Spec and parser consistency fixes (P2)

**What it is.** Small mismatches found while using the language.

**Expected behaviour**

- **Multi-line expressions:** document that an expression may continue across lines inside open parentheses. The Life example already relies on this.
- **Binary literals in circuits and tests:** make the rules identical. For example, require `0b10` for binary everywhere, or document the difference clearly. Today `10` is decimal in circuits and binary in tests.
- Add a compile warning when a bare digit string could be read two ways, for example `10` or `11`.
- Keep the docs, `LANGUAGE.md`, and the in-app docs page generated from one source so they cannot drift.

---

## Part 3: Make it useful outside the browser

### 9. Web Worker compilation (P2)

**What it is.** Run compile, simulation setup, and truth-table generation off the UI thread.

**Expected behaviour**

- Typing in the editor never blocks, even with a large design.
- Each compile request carries a sequence ID. Results from an older ID are discarded, so a slow compile can never overwrite a newer one.
- Truth-table generation shows a progress indicator and a **Cancel** button.
- The existing rule holds: a failed compile clears the live values rather than showing a stale simulation.

---

### 10. Command-line interface and npm packages (P2)

**What it is.** The engine has no DOM dependency, so it can run in Node and be published.

**Expected behaviour**

```bash
shortcircuit compile circuit.lf              # diagnostics, exit code 1 on error
shortcircuit test circuit.lf                 # runs TEST blocks, prints pass/fail
shortcircuit truth-table circuit.lf --circuit HalfAdder
shortcircuit format circuit.lf --write
shortcircuit export-ir circuit.lf -o out.json
shortcircuit export-verilog circuit.lf -o out.v
```

- Exit code 0 on success and non-zero on any diagnostic error or failed test, so it works in CI.
- Output can be human-readable or `--json`.
- Publish `@shortcircuit/engine` and `@shortcircuit/cli` to npm.

---

### 11. Verilog and SystemVerilog export (P2)

**What it is.** A backend that turns the IR into synthesizable HDL.

**Expected behaviour**

- One module per circuit, with ports taken from `inputs` and `outputs` and bus widths preserved.
- Combinational nodes become `assign` statements.
- `STATE` with edge blocks becomes `always @(posedge clk)` or `negedge`, using non-blocking assignment so commits match the atomic-commit semantics.
- Option for nested module instances or a single flattened module.
- Optional generated testbench from `TEST` cases, including clocked ones.
- Wrapping arithmetic matches, since Verilog arithmetic is modular at the declared width.

**Example output (half adder)**

```verilog
module HalfAdder(input a, input b, output sum, output carry);
  assign sum   = a ^ b;
  assign carry = a & b;
endmodule
```

**Notes**

- Division by zero (R500) has no direct HDL equivalent. The export should emit a comment and a guard, and warn.

---

### 12. Imports and a standard library (P3)

**What it is.** Reuse circuits across files and ship common building blocks.

**Expected behaviour**

- `IMPORT "path" AS Alias` makes a file's circuits available as `Alias.Circuit`.
- Circular imports are an error.
- A standard library provides adders, multiplexers, registers, counters, comparators, an ALU, and later memories.
- Names are namespaced, so imported circuits cannot collide with local ones.
- A project view lists files and lets the user open, rename, and delete them.

**Example**

```
IMPORT "stdlib/arith" AS Arith

CIRCUIT Main
  INPUT a : BUS(8)
  INPUT b : BUS(8)
  s = Arith.Adder<8>(a, b)
  OUTPUT s.sum
END
```

---

## Part 4: Expand the hardware model

### 13. Latches, flip-flops and memory (P3)

**What it is.** Built-in storage primitives, so users don't have to build them from `STATE` each time.

**Expected behaviour**

- `DFF`, `LATCH`, and `REGISTER` as library components.
- `RAM(depth, width)` with address, data-in, write-enable, and clock. Reads can be asynchronous or synchronous, chosen by a parameter.
- `ROM` initialised from a literal list or a file.
- Out-of-range addresses are a runtime error, not silent wraparound.
- The dock gets a memory viewer showing contents as a table, with the last read and written addresses highlighted.
- The memory contents appear in traces and in the IR.

**Example**

```
mem = RAM<depth = 256, width = 8>(
  clock = clock, addr = addr, data_in = din, write_en = we)

OUTPUT mem.data_out
```

---

### 14. Sharing and projects (P3)

**What it is.** Move beyond a single `localStorage` source.

**Expected behaviour**

- **Share link:** the source is compressed into the URL fragment, so opening the link loads the design with no server.
- Multiple named files, with import and export as a project archive.
- Storage moves to IndexedDB for larger projects, with `localStorage` as a fallback.
- Recent projects list, and optional GitHub Gist export.

---

### 15. Equivalence checking and symbolic analysis (P3)

**What it is.** Prove two circuits equivalent, or find a counterexample, without enumerating every input.

**Expected behaviour**

- Pick two circuits with the same interface and press **Compare**.
- Result is either "equivalent" or a counterexample input, the differing output, and both values.
- Combinational circuits use a BDD or SAT backend. Sequential circuits are checked up to a bounded number of cycles, and the bound is stated.
- Symbolic truth tables group rows to go beyond the 12-bit enumeration cap, with don't-care support and a Karnaugh-map view for small circuits.

**Example.** Compare a hand-built full adder against one made from two half adders and report "equivalent" in milliseconds.

---

### 16. Timing simulation and four-state logic (P3)

**What it is.** Optional modes that model real hardware more closely. The default two-state, zero-delay simulator must stay fast and unchanged.

**Expected behaviour**

- **Timing mode:** per-gate propagation delays, a clock period, glitch detection, and setup/hold warnings, shown in the waveform panel.
- **Four-state mode:** adds `X` (unknown) and `Z` (high impedance), enabling tri-state buses and uninitialised-state detection.
- Both modes are opt-in per project.

---

## Part 5: Project hygiene

### 17. Accessibility, CI and licensing (P2)

- **Accessibility:** full keyboard navigation, screen-reader labels on graph nodes and dock controls, high-contrast and reduced-motion modes, touch support for graph pan and zoom.
- **CI:** a GitHub Actions workflow running `npm test`, `npm run typecheck` and `npm run build` on every push and pull request.
- **License:** the repo currently says "All rights reserved". Choose an explicit license (MIT, Apache-2.0, or similar) if contributions are wanted.

---

## Suggested delivery order

| Phase | Features | Outcome |
| --- | --- | --- |
| 1 | 1, 2, 3 | Sequential circuits are fully testable and visible |
| 2 | 4, 6, 5 | Language scales to larger designs |
| 3 | 9, 10, 8, 17 | Responsive, scriptable, consistent, and maintainable |
| 4 | 11, 12, 14 | Usable outside the demo |
| 5 | 13, 15, 16, 7 | Extended hardware model and polish |

**Best first target:** Feature 1 (clocked tests), then Feature 4 (generate loops). Together they let you test and scale the Game of Life circuit built earlier in this conversation.

---

## Part 6: Beginner experience

Short Circuit is also for people who don't program, such as students, hobbyists and the curious. The features above are written mostly for people comfortable with code. This part makes sure a newcomer can build, test and understand circuits without writing syntax they have never seen. Priorities use the same key as before.

### 18. Record a test from the simulator (P1)

**What it is.** Instead of typing `TEST`, `CASE`, `INPUT` and `EXPECT` by hand, the user flips switches in the simulator and the app writes the test for them. This is the beginner-friendly front door to Feature 1 (clocked tests).

**Expected behaviour**

- A **Record test** button starts a recording. The dock shows a red "recording" indicator.
- While recording, every switch flip and every **Step** press is captured in order.
- Next to each output and state value is an **Expect this** button. Clicking it adds an `EXPECT` line with the value currently shown.
- **Stop** ends the recording and asks for a case name, with a suggested default such as "3 clock ticks".
- The generated `TEST` block is inserted into the source at the end of the file, using `STEP` and `CYCLE` where they apply.
- The user can edit the generated code afterwards. The recorder never hides the code, so beginners gradually learn the syntax by reading what was written.
- Running the tests afterwards shows the new case in the Tests tab like any other.

**Example.** The user opens the counter, presses **Record test**, presses **Step** three times, clicks **Expect this** next to `count` (showing 0011), and presses **Stop**. The app inserts:

```
TEST Counter4
  CASE "3 clock ticks"
    INPUT reset = 0
    CYCLE clock 3
    EXPECT count = 0011
  END
END
```

**Notes**

- If the user records while a test block for that circuit already exists, the new case is added to it instead of creating a second block.
- Recording a circuit that doesn't compile is blocked with a clear message.

---

### 19. Plain-English error messages (P1)

**What it is.** Every diagnostic keeps its stable code, but the main message is written for someone who has never seen a compiler.

**Expected behaviour**

- Each diagnostic shows a short headline, one sentence explaining what went wrong, and a suggested fix. The code (for example E301) is shown small, as a reference.
- Wording avoids jargon where a common word works. For example "wire" or "signal" instead of "identifier", and "memory" alongside "state".
- Where possible the fix is a button. A typo suggestion becomes **Replace with `carry`**. A width mismatch offers **Insert a widening step**.
- A **What does this mean?** link opens a short explanation, and a diagram where it helps.

**Example**

Instead of:

```
E301: width mismatch in ADD (8 vs 4)
```

show:

```
These two signals are different sizes
You're adding an 8-bit signal (a) to a 4-bit signal (b). Add can only
combine signals of the same size.
Fix: widen b to 8 bits with ZEXT(b, 8).        [Apply fix]   (E301)
```

**Notes**

- The same text is used in the console, the inline squiggle hover, and the CLI, so every place a user meets an error reads the same.

---

### 20. Guided tutorials and challenges (P2)

**What it is.** A built-in learning path that teaches digital logic by doing, with each lesson checked automatically.

**Expected behaviour**

- A **Learn** page lists lessons in order: switches and wires, the AND/OR/NOT gates, XOR, half adder, full adder, multiplexer, memory (a latch), counter, and finally a small project such as a traffic light or Life.
- Each lesson has a short explanation, a starter circuit with a gap to fill, and a goal such as "make the light turn on only when both switches are on".
- The app checks the answer using hidden tests, and says what passed and what didn't in plain language.
- A **Hint** button reveals help in steps, and **Show solution** is always available.
- Progress is saved locally, and completed lessons are marked.
- Challenges ("build a 2-bit comparator using only NAND gates") are offered after the basic path for people who want more.

**Example lesson: "Both switches"**

```
CIRCUIT Both
  INPUT a
  INPUT b

  // Make 'light' turn on only when a AND b are both on.
  light = ???

  OUTPUT light
END
```

The user types `AND(a, b)`. The app runs the four combinations and shows a green tick.

---

### 21. Click-to-explain in the graph (P1)

**What it is.** Any node in the dependency graph can explain itself in one click.

**Expected behaviour**

- Clicking a gate opens a small card with its name, a one-line plain-English description ("AND: on only when every input is on"), its width rule, and its own truth table for small inputs.
- The card shows the node's current inputs and output, so the user sees why it has that value right now.
- Clicking a signal shows where it comes from and what uses it, and highlights those wires.
- Clicking an instance of a circuit offers **Open inside** to look at its contents.
- Cards use the same wording as the editor hover cards, so the two stay consistent.

**Example.** The user clicks the XOR gate in a half adder. The card reads "XOR: on when an odd number of inputs are on. Right now a=1, b=1, so the result is 0", with the four-row table below it.

---

### 22. Visual circuit builder (P3)

**What it is.** A drag-and-drop way to build a circuit without typing code. The code stays the source of truth and the visual builder edits it.

**Expected behaviour**

- A palette lists gates, inputs, outputs, muxes, adders, registers and the user's own circuits.
- Dragging a block onto the canvas inserts the matching line of LogicFlow. Drawing a wire between two ports writes the assignment.
- Editing the code updates the canvas, and editing the canvas updates the code, so both always match.
- Layout positions are stored as comments or in project metadata and don't change the compiled meaning.
- Anything the builder can't represent is left in the code, shown as an opaque block, and never lost.

**Notes**

- This is the largest item in this part. A reasonable first version supports only gates, inputs, outputs and instances.

---

### 23. Output displays: LEDs, 7-segment and grids (P2)

**What it is.** Show output values as things people recognise, not only as 0s and 1s.

**Expected behaviour**

- Per-output display modes: **number**, **LED**, **7-segment**, **bar**, and **grid**.
- **LED** shows a lit or dark circle for each bit of an output.
- **7-segment** takes a 4-bit hex value or 7 individual segment bits and draws a digit.
- **Grid** takes a bus and a width, and draws it as a board of on/off cells. This lets Life be watched as a board.
- The mode is chosen in the dock, and the choice is saved with the project. An optional `DISPLAY` hint in the source can set a default.
- Displays are read-only, update live while stepping or running, and also appear in waveform tooltips.

**Example**

```
OUTPUT grid   // DISPLAY GRID(4, 4)
```

The 16-bit `grid` output appears as a 4x4 board, and stepping the clock moves the glider across it.

---

### 24. Glossary and friendly terminology (P2)

**What it is.** A built-in dictionary so unfamiliar words never block progress.

**Expected behaviour**

- Terms such as bus, clock, edge, state, width, gate, and truth table are linked wherever they appear in the UI and the docs.
- Hover shows a one-sentence definition. Click opens a short entry with a small picture or example.
- A **Beginner mode** toggle in settings uses everyday wording in the UI (for example "memory" alongside "state") and hides advanced tabs such as IR until asked.
- The docs page gets a "New to digital logic?" section at the top, before the syntax reference.

---

### 25. Advanced labels and progressive disclosure (P2)

**What it is.** Keep the default experience simple, and let power users opt in to depth.

**Expected behaviour**

- Features that need programming or hardware knowledge are marked **Advanced** in the UI and docs: parameterized circuits (5), imports and stdlib (12), Verilog export (11), equivalence checking (15), and timing and four-state modes (16).
- Advanced features are hidden or collapsed in Beginner mode. They can be shown from settings or by a **Show advanced** switch.
- Examples shown by default use only plain gates, buses and `STATE`, with no `FOR` loops or parameters.
- Docs pages label each section Beginner, Intermediate or Advanced.

---

## Updated delivery order

This replaces the earlier order now that the beginner features are included.

| Phase | Features | Outcome |
| --- | --- | --- |
| 1 | 1, 2, 3, 18, 19, 21 | Sequential circuits are testable and visible, and a newcomer can test, read errors and understand gates without code |
| 2 | 4, 6, 23, 20, 24 | Language scales, and the app teaches and shows results in friendly ways |
| 3 | 5, 9, 10, 8, 17, 25 | Responsive, scriptable, consistent, accessible, and advanced features tucked away |
| 4 | 11, 12, 14 | Usable outside the demo |
| 5 | 13, 15, 16, 22, 7 | Extended hardware model, visual builder and polish |

**Best first targets:** Feature 1 (clocked tests) together with Feature 18 (record a test), so the same capability works for both programmers and beginners. Feature 19 (plain-English errors) is small and helps every user, so it can ship alongside.
