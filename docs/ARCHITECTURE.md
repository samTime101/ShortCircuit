# Architecture

Short Circuit is split into a framework-free compiler/simulator and a React
studio that consumes its public IR. The boundary is deliberate: the engine can
run in Node, a test runner, a CLI, or another browser host without React, and
another implementation can reproduce the same behavior from
`shortcircuit.ir/v1`.

```text
source text
    │
    ▼
lexer ── tokens ──► parser ── AST ──► analyzer ──► ProgramIR
                                                 │
                       ┌─────────────────────────┼──────────────────────┐
                       ▼             ▼           ▼          ▼           ▼
                   Simulator     Test runner  Truth table  Formatter  UI graph
                       │             │           │
                       └─────────────┴───────────┴──► snapshots / results
```

---

## 1. Package layout

```text
short-circuit/
├─ packages/engine/              # no DOM, no React, no Node APIs
│  ├─ src/lexer.ts               # tokens, comments, strings, numbers
│  ├─ src/parser.ts              # line-oriented recursive descent
│  ├─ src/ast.ts                 # source-shaped AST with spans
│  ├─ src/analyzer.ts            # validation + elaboration to flat IR
│  ├─ src/builtins.ts            # core operation metadata
│  ├─ src/packages.ts            # package catalog + .lf macro parser
│  ├─ src/snippets.ts            # language snippet library
│  ├─ src/values.ts              # bigint bit values, literal parsing, masks
│  ├─ src/diagnostics.ts         # stable codes, suggestions, ordering
│  ├─ src/simulator.ts           # graph evaluation + clock commits
│  ├─ src/testing.ts             # static TEST runner
│  ├─ src/truthTable.ts          # exhaustive enumeration
│  ├─ src/formatter.ts           # conservative source formatting
│  ├─ src/types.ts               # public IR + result types
│  └─ src/index.ts               # package API
│
├─ apps/web/                     # React 19 + Vite studio
│  ├─ src/App.tsx                # orchestration, state, keyboard, persistence
│  ├─ src/editor/                # CodeMirror language, completions, hover cards
│  ├─ src/components/            # graph, simulator dock, panels, modals
│  ├─ src/pages/DocsPage.tsx     # documentation page
│  ├─ src/lib/                   # examples + hash router
│  └─ src/styles.css             # design system and theme tokens
│
├─ vendor/ShortCircuit-Packages/ # package registry submodule
└─ tests/examples.test.ts        # cross-package example validation
```

The engine package is a workspace dependency of the web app. It has no
runtime dependency on the web app or on any UI library.

---

## 2. Compiler pipeline

### 2.1 Lexer

`lex(source, diagnostics)` produces a flat token stream:

- identifiers, numbers, strings, symbols, newlines, EOF;
- each token carries its value, raw text, 1-based line/column, byte offset and
  length;
- comments are skipped, but newlines are preserved because the grammar is
  line-oriented;
- a `//` comment runs to the end of the line, and a `/* ... */` comment may
  span lines; the lexer reports an unclosed block comment as `E003`;
- lexical errors (`E001`, `E002`, `E003`) are recoverable and recorded on a
  diagnostic sink.

Numbers are kept as raw text. Interpreting a literal depends on context
(language literal, test literal, simulation input, slice bound), so the lexer
does not commit to a numeric value.

### 2.2 Parser

`Parser` is a recursive-descent parser over the token stream. It produces a
source-shaped AST (`ProgramAst` → `CircuitAst` / `TestAst`) with spans on every
node. It never resolves names or widths.

Design points:

- **Line-oriented statements.** `finishStatement` requires a newline (or EOF)
  after a declaration or assignment, which keeps the grammar unambiguous
  without semicolons.
- **Resilient recovery.** Errors recover to the end of a line, the end of an
  expression, or the next top-level block. This prevents a missing `END` from
  cascading into unrelated diagnostics.
- **Expression grammar.** Literals, references, calls, postfix index/slice,
  and parentheses. Calls allow newlines after `(` and between arguments.
- **Line and column spans** are preserved through elaboration for diagnostics
  and graph inspection.
- **Nesting guard.** Circuit instantiation depth is capped (E320) and package
  macros are expanded with their own arity checks.

Parser diagnostics are passed into the analyzer rather than thrown away, so a
compile result always contains lexical, syntactic, and semantic errors in one
sorted list.

### 2.3 Analyzer and elaboration

`ProgramAnalyzer` is the semantic core. It performs two broad passes.

#### Pass 1 — declarations

For every circuit, `buildStructure` records:

- inputs and widths;
- state specs (width, initial value, binary initial value);
- assignments by name;
- output declarations and their full dotted names;
- clocked blocks;
- the signal table with declaration spans.

It enforces reserved names, unique names, unique outputs, valid widths, and
valid state initializers. All user circuits are registered before any circuit
is elaborated, so declaration order never matters and forward references work.

#### Pass 2 — lazy graph construction

Each top-level circuit gets a `ScopeBuilder`. The builder walks assignments on
demand:

1. `resolveEntry(name)` memoizes the graph value for each local signal.
2. `resolveExpression` compiles literals, references, calls, and slices.
3. User-circuit and package-circuit calls instantiate child `ScopeBuilder`s
   with the bindings for that instance. Package macros expand to typed NAND
   references before the operation switch is reached.
4. A recursion stack detects direct and mutual instantiation cycles (E324).
5. A dependency stack detects combinational feedback (E310) and reports the
   cycle path.
6. Outputs are resolved last, after all reachable assignments exist.

The result is **flattened**: every instantiated gate becomes a `CircuitNode`
in the top-level circuit, with `scope` identifying its instance path. There are
no call nodes and no shared subgraphs in the IR, which makes simulation,
dependency graphs, and netlist export straightforward.

The analyzer owns global serial counters for node IDs, constants, and events.
IDs are deterministic for a given source and compile order, but they are
opaque identities rather than semantic names.

#### Width checking and coercion

`commonWidth` implements the language's central rule:

- signal operands must agree on width, or E301 is reported with each width;
- constants are re-created at the target width if they fit (E305 otherwise);
- the operand list is returned with explicitly sized constants.

`coerce` handles instance ports, state updates, and structural operation
contexts. It never mutates a signal node's width; width mismatches are
diagnostics, not implicit casts. Package circuits such as `ADD4` and `ADD8`
declare their port widths, and package macros use the same common-width rule as
the kernel.

#### Clocked blocks

`compileEvents` resolves the clock reference, checks that it is one bit, and
lowers the block body:

- sequential assignments resolve against the current graph and target only
  state node IDs;
- each state receives exactly one next-state value per edge; use package `MUX`
  to choose between a computed value and the old value when a conditional
  update is needed;
- events are emitted with ordered `updates` entries.

This lowering is why every next-state expression samples pre-edge state: the
state nodes themselves only change later, during the simulator's commit step.

The analyzer also checks that no two events drive the same state on the same
edge and clock (E312), and warns about constant clocks (W301), empty clocked
blocks (W302), and duplicate assignments along one path (W303).

#### Limits and failure

Elaboration is bounded by `maxNodes`, `maxDepth`, `maxInstances`, `maxWidth`, and
`maxDiagnostics`. When a limit is reached, the analyzer reports one E320 (or
E322) instead of allowing unbounded work, and compilation fails.

If the whole compile throws unexpectedly, `compile()` catches it and returns a
single `E999` diagnostic with `ok: false` and `ir: null`. It never returns a
partial IR as if it were valid.

### 2.4 Packages

`compile()` resolves the bundled package snapshot plus any host-provided
packages. Macro exports point at real `.lf` files; `packages.ts` parses their
`MACRO` declarations, validates the exported name, and registers the resolved
body/fold. A macro body is never stored in JSON.

`resolvePackageImports` applies source-level `IMPORT` declarations to the
enabled catalog. Recommended packages are unqualified by default; an explicit
alias adds qualified access, and an explicit import without an alias adds
unqualified access. Hosts can remove packages with `disabledPackages` or
restrict the catalog with `enabledPackages`; missing and duplicate-alias cases
are `E602` and `E603`.

Package circuits are parsed from their `.lf` sources and registered as internal
structures. They can be instantiated by user circuits and by other package
circuits, but they are skipped when the result circuit list and Verilog modules
are built. That keeps package internals out of the user's project while still
elaborating them into the same flat IR.


### 2.5 Result contract

`CompileResult` contains:

```ts
{
  ok, source, diagnostics,
  circuits, tests,      // possibly partially built, for inspection
  ir,                   // ProgramIR | null; null whenever ok is false
  elapsedMs
}
```

`circuits` and `tests` are useful for diagnostics and debugging, but hosts must
treat `ir` as the only executable artifact. The UI clears its simulator and
graph when `ok` is false.

---

## 3. Portable IR

`ProgramIR` contains every circuit in source order plus compiled test suites.
A `CircuitIR` contains:

- inputs, outputs, states;
- flat nodes (`input`, `constant`, `state`, `operation`);
- clock events;
- a `sequential` flag and statistics.

The IR has no references to AST classes, parser tokens, JavaScript values, or
source text. Values are zero-padded binary strings, so the schema is
language-neutral and JSON-safe. See [IR.md](IR.md) for field-by-field contracts.

This boundary is the porting seam: a Rust or Go implementation can produce the
same JSON and reuse the visualization/export tools, or a different front end
can target the schema directly.

---

## 4. Simulation

`Simulator` is constructed from one `CircuitIR` and owns:

- input values and widths;
- current state values;
- the last evaluated node values;
- the previous clock baseline;
- the events fired by the most recent input mutation.

### 4.1 Construction and evaluation

The constructor:

1. indexes nodes by ID and inputs/outputs by name;
2. initializes state from the IR's binary initializers;
3. computes a topological order with a DFS that detects cycles (R407) and
   missing nodes (R408);
4. evaluates every node with all inputs zero;
5. captures the clock baseline.

Evaluation is a single pass over topological order. Inputs, constants, and
states are leaves; operations read operand values from the current pass and
apply `evaluateOperation`. Every result is masked to the node's declared width.

### 4.2 Input mutations

`setInput` / `setInputs` accept strings, numbers, or bigints:

- strings go through `parseSimulationInput`: binary digits, optional `0b`, or
  `0x` hex; underscores and spaces are ignored; empty means zero;
- numbers must be non-negative safe integers;
- all values are range-checked against the declared input width (R401/R402).

Multiple values in one `setInputs` call are applied before evaluation, so they
form one transition rather than a sequence of intermediate states.

After evaluation, `afterInputsChanged` compares each event clock node's new
value with its previous baseline:

```ts
rising  = previous === 0n && current === 1n
falling = previous === 1n && current === 0n
```

All triggered events evaluate their update nodes against the just-computed
graph (old state) and write into a pending map. Conflicts are detected (R405);
then all updates are committed, the graph is re-evaluated once, and the new
clock baseline is stored. This is the atomic-commit model described in the
language reference.

`reset()` restores initial state, clears fired events, re-evaluates, and
re-captures the baseline. `clearInputs()` is a normal transition to zero.

### 4.3 Snapshots

`snapshot()` projects the internal graph into a serializable
`SimulationSnapshot`:

- `inputs` / `outputs` / `states`: names to `{ width, binary, decimal }`;
- `nodes`: node IDs to binary strings (for graph inspection);
- `clockValues`: clock node IDs to binary strings;
- `firedEvents`: the edge events that fired in the last mutation.

Decimal strings are produced with `BigInt.toString(10)`, so they are exact for
4096-bit values.

### 4.4 Runtime errors

Runtime checks throw `SimulationError` with stable `R###` codes. The UI catches
them and clears the snapshot and live values rather than displaying the last
good result; a compile failure also clears the circuit graph. Input validation
is performed before any input is applied, and a thrown transition never
returns a snapshot; hosts must not present the prior snapshot as the result of
the failed transition.

Construction evaluates the all-zero input state immediately so the studio can
display outputs before the user touches anything. A malformed IR throws a
`SimulationError`; the app catches it, clears the simulator, and shows the
error instead of presenting stale values.

---

## 5. Testing and truth tables

These are thin layers over `Simulator`:

- `runTests(result)` builds a fresh simulator per test case and walks the
  case program in order: inputs, loads, steps, and clock cycles. Expectations
  are compared at the point they are reached, using the full zero-padded binary
  string, and a case stops at the first failure with the step number.
- `generateTruthTable(circuit, options)` rejects sequential circuits and
  over-limit tables with a `reason`, otherwise enumerates all rows and records
  input/output binary strings.

Because both consume only `CircuitIR`, they automatically reflect every
language feature that reaches the IR, including nested instances and intrinsic
expansion.

---

## 6. Web application

### 6.1 Data flow

`App.tsx` is the single orchestration point. It holds:

- `source` (persisted to `localStorage`);
- the latest `CompileResult`;
- the active circuit name and simulation snapshot;
- input values, runtime errors, truth table and test results;
- active inspector tab and dialog state.

The flow is one-directional:

```text
editor change
  → debounce 360 ms
  → compile(source)
  → if ok: choose circuit → new Simulator → snapshot + truth table + tests
  → if fatal: clear simulator, snapshot, truth table and tests
```

Compile requests carry a monotonically increasing sequence number. A stale
compile result (one superseded by a newer edit) is discarded, so a slow compile
cannot overwrite newer state. The editor paints immediately; compilation is
deferred by one frame and then runs synchronously.

`Run` and example loading compile immediately and bypass the debounce. The
editor's `Mod-Enter` runs; global `Mod-S` formats then compiles. Formatting
replaces the source and triggers a fresh compile. `Mod-Shift-M` maximizes the
editor over the inspection pane and `Esc` leaves it; the editor text size
steps between 12px and 22px and is stored in `localStorage`.

### 6.2 Simulator lifecycle

A simulator is recreated whenever:

- a new successful compile produces a different circuit object;
- the user switches circuits.

Recreating resets inputs and state by design. Input mutations call
`simulator.setInput`, then copy the returned snapshot and the simulator's
normalized input values into React state. Runtime errors clear the snapshot and
surface the message; reset restores initial state and shows a toast.

### 6.3 Views

All inspector views render the same compiled circuit:

- **Circuit** — `CircuitGraph` lays out the node DAG as SVG, colors live
  values, supports pan/zoom, and exposes a node inspector with operation,
  width, scope, operands, and source location. Inputs are interactive controls
  in `SimulatorDock`, which also drives clocks (step, run, and speed) and
  forces state values; state values are monitored in the same panel.
- **Truth table** — exhaustive rows from `generateTruthTable`, with reasons
  shown instead of partial tables.
- **Tests** — compiled suites and per-row results from `runTests`, including
  unsupported clocked suites and runtime errors.
- **IR** — pretty-printed JSON from `result.ir`, with download.

The editor is CodeMirror with a custom stream tokenizer and lint source.
Diagnostics are converted to CodeMirror diagnostics and clicking one jumps to
its line and column. The reference and examples modals are read from the same
source-level examples library used by tests.

### 6.4 Editor language support

Three small modules under `apps/web/src/editor/` make the editor aware of the
language:

| Module | Responsibility |
| --- | --- |
| `documentModel.ts` | Scans the source for signals, instance ports, and circuits; finds the word under the pointer |
| `completions.ts` | Builds the completion list: built-ins, keywords, snippets, and the signals in the file |
| `hover.ts` | Produces the hover card for operations, components, keywords, and signals |

The completion source is registered through the CodeMirror language-data
mechanism (`languageData.autocomplete`), so the standard completion UI and key
bindings do the rest. All descriptive text comes from the engine
(`BUILTINS`, `DEFAULT_PACKAGE_MACROS`, `DEFAULT_PACKAGE_CIRCUITS`,
`LANGUAGE_SNIPPETS`), which keeps the editor, the documentation page, and the
language reference in sync.

### 6.5 Documentation page

`apps/web/src/pages/DocsPage.tsx` renders the language reference as a separate
page. A tiny hash-aware router (`apps/web/src/lib/router.ts`) switches between
the studio and the docs at `/#/docs`; a path such as `/docs` is also accepted
when the host serves the app with a history fallback. The page is generated
from the same engine metadata, so the operation tables and the snippet library
cannot drift from the implementation.

### 6.6 Theme and typography

The palette is one set of CSS custom properties in `apps/web/src/styles.css`
(`--bg`, `--panel`, `--accent`, `--text`, ...): neutral graphite surfaces, an
electric-blue accent, and violet, amber, and red reserved for semantics. The
CodeMirror theme mirrors the same tokens.

Type is deliberately quiet:

- **Inter** for interface text, **JetBrains Mono** for code, identifiers, and
  values, with tabular numerals for anything numeric.
- One scale: 11 / 11.5 / 12.5 / 13.5 / 16 / 19 / 27 px, used consistently for
  labels, body text, panel headings, and page headings.
- Sentence case everywhere. The only tracked text is the mono wordmark.
- 1.75 line height in the editor, 1.65 in prose, 1.5 in the interface.

Surfaces are flat: hairline borders, 4-6 px radii, one accent color, and
shadows only on overlays that float above the page (modals, tooltips, the
graph inspector).

### 6.7 Waveform and trace

Every input change, clock step, and forced state appends a sample to a trace
held in the app. A sample records the inputs, outputs, states, and the edges
that fired.

- The **Waveform** tab draws one row per signal: one-bit signals as high and
  low lines, buses as labelled segments.
- Edges that fired are marked on the time axis.
- The trace exports as a Value Change Dump for GTKWave, and as JSON with the
  schema `shortcircuit.trace/v1`.
- The history is capped at 10,000 samples, and the panel states the count
  rather than truncating silently.
- A reset or a new compile clears the trace.

### 6.8 Recording a test case

The dock can record what the user does. Input flips become `INPUT` lines,
clock steps become `STEP` blocks, and the **Expect this** button captures the
value a signal holds. Stopping asks for a case name, shows the generated
source, and writes it into the file, adding the case to an existing `TEST`
block when there is one.

### 6.9 Plain-language diagnostics

The engine attaches a plain-language layer to every diagnostic it knows about
(`packages/engine/src/plainLanguage.ts`). The headline and the explanation are
written for someone new to the language, and a name mistake carries a
one-click fix: the source range, the replacement text, and the button label.
The studio applies the fix and recompiles.

### 6.10 Verilog export

The engine can write Verilog from the IR (`packages/engine/src/verilog.ts`), so
the same design that runs in the studio can be handed to a synthesis tool.

- Every circuit becomes a module, with ports taken from the inputs and outputs
  and bus widths preserved.
- Combinational nodes become continuous assignments.
- Clocked state becomes an edge-triggered `always` block with non-blocking
  assignments, which keeps the atomic commit of the simulator.
- A testbench can be generated from the TEST cases, including clocked ones.
- A division by zero has no hardware meaning, so the export guards it and says
  so in a warning.

### 6.11 Command line

`packages/cli` is a small Node front end for the same engine the studio uses.
It parses arguments, runs one command, and sets the exit code, so it behaves
like any other build tool:

| Command | What it does |
| --- | --- |
| `compile` | Compiles a file and prints the diagnostics |
| `test` | Runs the TEST blocks and reports pass or fail |
| `truth-table` | Prints the truth table of a combinational circuit |
| `format` | Formats a file, in place with `--write` |
| `export-ir` | Writes the portable IR as JSON |
| `export-verilog` | Writes Verilog modules and a testbench |

The exit code is 0 on success and 1 on a diagnostic error or a failed test, so
the tool can be used in a pipeline.

### 6.12 Glossary

`GLOSSARY` explains the words the language uses, with a one-line definition
and a longer note. The studio renders it as the first section of the
documentation, so the reference and the words are in one place.

### 6.13 Beginner mode

The studio has two modes, kept in local storage:

- **Advanced** shows everything, including the portable IR view.
- **Beginner** hides the advanced views, uses everyday wording (the stored
  state is called memory), and leaves the language reference to the parts a
  beginner needs.

The mode is a presentation choice; the engine and the IR never change.

### 6.14 Compilation in a worker

The studio compiles in a worker so a large design never blocks typing:

- Each request carries an id, and a result older than the newest request is
  dropped, so a slow compile can never overwrite a newer one.
- The client falls back to the main thread when a browser has no worker, and
  finishes any waiting request on the main thread when it is disposed.

### 6.15 Persistence and safety

- Source persists under `localStorage` key `shortcircuit.source.v1`; failures
  (private browsing, quota) are ignored.
- Compile failures keep the user's source untouched.
- No network calls; everything runs locally.
- Runtime errors never leave a stale simulator in the UI.

---

## 7. Verification strategy

The repository runs one vitest workspace with three projects: `engine`
(`packages/engine`), `web` (`apps/web`, jsdom), and `cross`
(`tests/`). `npm test` runs all of them.

- **Engine unit tests** (`packages/engine/test/engine.test.ts`) cover gates,
  buses, arithmetic widths, slices/shifts/decoders, nested instances, named
  arguments, intrinsics, clocked test sequences, the bus helpers, clocking,
  diagnostics, formatting, truth-table order, and failure behavior.
- **Studio tests** (`apps/web/src/test`) render the documentation page, the
  truth table, the test bench, the simulator dock, the waveform panel, and the
  whole app, including the docs route, the fatal-diagnostic state, and the
  one-click fix.
- **Drift guards.** A test checks that every built-in signature appears in
  `docs/LANGUAGE.md`, and the documentation page test checks that every
  built-in, argument list, and example is rendered. The reference cannot fall
  behind the implementation without a failing test.
- **Cross-package example tests** (`tests/examples.test.ts`) import the public
  engine API and the web example library, compile and format every example,
  run all declared suites, and assert that every example's focused circuit
  exists. Register and counter examples additionally assert edge behavior and
  wrap/reset behavior.
- **Type checking** covers engine and web packages separately.
- **Production build** runs `tsc --noEmit` for the web app before Vite builds
  it.

The root `npm test` runs both test files. Examples are part of the permanent
test contract, so a language change that breaks the showcase fails CI.

---

## 8. Extension points

### Adding a built-in operation

1. Add a `BuiltinSpec` to `BUILTINS` in `builtins.ts` (name, arity, category,
   description).
2. Handle it in `ScopeBuilder.compileCall` to compute result width, validate
   operands, and emit an operation node with any params.
3. Implement evaluation in `Simulator.evaluateOperation`.
4. Add tests for width, arity, and edge cases.
5. Document the width policy in `LANGUAGE.md` and the op contract in `IR.md`.

Built-ins must be primitive IR operations; opaque library calls would violate
the "graph is the program" model. Derived gates and circuit-shaped behavior
belong in packages. A package macro expands before the built-in switch, and a
package circuit elaborates to the same primitive nodes as a user circuit.

### Adding a backend

A backend consumes `ProgramIR` and emits a netlist, HDL, or another language.
It should:

- reject unknown schema or language versions;
- respect node widths and operation contracts;
- lower `NAND`, `CONCAT`, `BROADCAST`, `SLICE`, `ZEXT`, `SEXT`, `REPEAT`,
  and `REVERSE` explicitly rather than assuming a host has them;
- preserve clock event edges, update ordering, and atomic-commit semantics;
- treat `ir === null` as non-executable input.

### Adding a front end

A front end only needs to produce valid `ProgramIR`, including source spans and
stats. It can reuse the simulator, test runner, truth table, graph, and JSON
viewer. Diagnostics are host-level and need not match LogicFlow's codes, but
the IR itself is the compatibility contract.

### New UI views

Views should consume `CompileResult` / `CircuitIR` / snapshots, not parse
source. This keeps the language and the studio independently replaceable.

---

## 9. Known limits and trade-offs

- **Synchronous compilation.** The compiler runs on the UI thread. Limits keep
  the worst case bounded; heavy programs would benefit from a worker.
- **Flattened IR.** Excellent for simulation and visualization, but repeated
  instances duplicate nodes. A hierarchical IR or sharing pass would reduce
  size for very large designs.
- **Two-state logic.** No `X`/`Z`/unknown values, no tri-state buses, no
  propagation-delay modeling. These are explicit non-goals for 0.1.
- **Static tests only.** Clocked suites need multi-cycle traces, which the
  runner does not model yet.
- **Exhaustive truth tables.** The 12-bit default keeps the UI responsive;
  symbolic or grouped enumeration is future work.
- **CodeMirror-heavy bundle.** The production bundle is dominated by the
  editor; code-splitting it is a straightforward future optimization.
- **No standard library.** Every operation is primitive or intrinsic; reusable
  circuits are source-level today. A signed/import system is not implemented.

---

## 10. Design commitments

- **Static before dynamic.** Names, widths, ports, loops, recursion, and clock
  conflicts are compile-time concerns.
- **IR is the contract.** Every view and runner consumes the same serializable
  graph.
- **No plausible output after failure.** `ok: false` means no IR, and the UI
  clears live state on fatal errors.
- **No silent truncation.** Arithmetic wrapping is documented; width
  mismatches are diagnostics.
- **Predictable case rules.** Built-ins are case-insensitive; names are
  case-sensitive.
- **Portable core.** The engine has no browser or framework dependency, and
  the IR is JSON with string-encoded values.
