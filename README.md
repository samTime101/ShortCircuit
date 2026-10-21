# Short Circuit

**Short Circuit** is a text-first digital logic language and simulation studio. Describe a circuit as a graph of named signals, then compile, simulate, test, enumerate and inspect the exact same design.

The language is called **LogicFlow** (`logicflow/0.2`). It is deliberately small and declarative:

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
  CASE "1 + 1"
    INPUT a = 1
    INPUT b = 1
    EXPECT sum = 0
    EXPECT carry = 1
  END
END
```

Assignments describe wires, not steps. The compiler validates names, widths, wiring, composition and clocking before it produces a portable IR. Every view in the app — live simulation, dependency graph, truth table, tests, and JSON — consumes that IR rather than reparsing source.

Comments use `//` for a line and `/* ... */` for a block that may span lines. LogicFlow 0.2 dropped the old `#` marker; the studio rewrites a source saved by an older version when it loads it.

## What works in v0.1

- **Readable hardware expressions** — function-style gates, named signals, comments, no semicolons or braces.
- **Default packages** — the kernel provides `NAND`; bundled packages add `NOT`, `AND`, `OR`, `BUFFER`, `NOR`, `XOR`, `XNOR`, `MUX`, `HALF_ADDER`, `FULL_ADDER`, `ADD4`, and `ADD8`. Gates, selection, and arithmetic are package source; the compiler kernel keeps `NAND` and structural wiring.
- **Static validation first** — undeclared/duplicate signals, width mismatches, missing ports, illegal recursion, combinational loops and clock conflicts are diagnosed before simulation.
- **Buses** — `BUS(8)` declarations, indexing (`data[3]`), inclusive slices (`data[7:4]`), concatenation, broadcast, sign/zero extension, repetition and reversal.
- **Composition** — reusable `CIRCUIT` blocks, positional or named instance ports, nested scopes and flattened IR.
- **Packages and imports** — `IMPORT "@scope/package" AS Alias`, auto-imported recommended packages, and package toggles in the studio. Package implementations are real `.lf` source files.
- **Sequential logic** — explicit `STATE`, rising/falling edge blocks, MUX-based next-state logic, atomic edge commits.
- **Verification** — in-source `TEST` cases, clocked sequences with `STEP`, `CYCLE`, and `LOAD`, plus exhaustive truth-table generation for combinational circuits.
- **Live studio** — CodeMirror editor with diagnostics, interactive input controls, dependency graph with values, stored-state monitors, test results, and downloadable IR.
- **Editor that knows the language** — completions for built-ins, keywords, snippets and your own signals, plus hover cards with signatures, width rules and usage tips.
- **Room to work** — the editor can be maximized over the inspector with `Mod-Shift-M` or `Esc`, and its text size steps up and down and is remembered between visits.
- **Built-in documentation** — a full language reference page in the app (`/#/docs`) with the syntax, width policy, every operation with its arguments and a worked example, diagnostics, and a copyable snippet library. The examples are syntax highlighted, and the same reference is generated into `docs/LANGUAGE.md` so the two cannot drift.
- **Plain-language errors** — every diagnostic explains itself in everyday words, and a name mistake can be fixed with one click.
- **Visible sequential behaviour** — a waveform panel records every step, marks the edges that fired, and exports VCD or JSON.
- **Beginner-friendly** — record what you do in the simulator and the studio writes the test case for you; clicking a gate explains it and shows its truth table.
- **Plain glossary** — every word the language uses, explained in everyday language, right in the documentation.
- **Beginner mode** — hides the advanced views and uses everyday wording, so the studio grows with you.
- **Never blocks** — compilation runs in a worker, so typing stays smooth on a large design.
- **Readable outputs** — every output can be shown as a number, LEDs, a seven-segment digit, a bar, or a grid of cells.
- **Verilog export** — the portable IR writes Verilog modules, and a testbench from the test cases.
- **Dark workbench** — neutral graphite surfaces with an electric-blue accent, readable in a dim room.

## Run it

Requires **Node.js 22.19+** (or 24) and npm. The studio tests run in jsdom, which needs a Node with zstd support, so older releases cannot start the test workers.

```bash
npm install
npm run dev
```

Vite prints the local URL (usually <http://localhost:5173>). If that port is occupied it picks the next available one.

```bash
npm test              # engine, studio, and cross-package tests
npm run typecheck
npm run build
npm run docs:generate # regenerate the operation reference in docs/LANGUAGE.md
```

To create and publish your own package, follow the step-by-step guide in
[`docs/PACKAGES.md`](docs/PACKAGES.md). It covers the source layout, manifest,
registry entry, bundle build, package tests, imports, and submodule commit.

## Repository layout

```text
short-circuit/
├─ packages/engine/        Framework-free compiler + simulator
│  ├─ src/lexer.ts         Tokens
│  ├─ src/parser.ts        Line-oriented AST parser
│  ├─ src/analyzer.ts      Validation, elaboration, diagnostics
│  ├─ src/simulator.ts     Combinational + clocked evaluation
│  ├─ src/testing.ts       In-source test runner
│  ├─ src/truthTable.ts    Exhaustive enumeration
│  ├─ src/formatter.ts     Canonical source formatting
│  ├─ src/builtins.ts      Core operation metadata: signatures, widths, examples
│  ├─ src/packages.ts      Package catalog, .lf macro parser, offline bundle
│  ├─ src/snippets.ts      Language snippet library
│  ├─ src/plainLanguage.ts Plain-language layer for diagnostics
│  └─ src/types.ts         Portable IR + public API types
├─ apps/web/               React 19 + Vite studio
│  ├─ src/editor/          CodeMirror language, completions, hover cards
│  ├─ src/components/      Graph, dock, panels, waveform, modals
│  ├─ src/pages/           Documentation page
│  ├─ src/lib/             Examples, hash router, recorder, trace
│  ├─ src/test/            Studio test suite
│  └─ src/styles.css       Design system and theme tokens
├─ vendor/ShortCircuit-Packages/  Package registry submodule
├─ tests/                  Cross-package example and documentation checks
├─ scripts/                 Documentation generator
└─ docs/
   ├─ LANGUAGE.md          Syntax, semantics, widths, diagnostics
   ├─ PACKAGES.md          Step-by-step package authoring guide
   ├─ ARCHITECTURE.md      Compiler pipeline and extension points
   └─ IR.md                Portable IR schema and porting guide
```

The engine has no DOM, React, or browser dependency. Another implementation can target the same `shortcircuit.ir/v1` schema and reproduce its semantics.

## Design commitments

- **No plausible output after a fatal error.** If compilation fails, the UI clears the live graph rather than showing a stale simulation.
- **No silent width truncation.** Width behavior is documented and validated. Wrapping arithmetic is an explicit modular policy, not an accident.
- **Static before dynamic.** Graph and clocking errors are compile-time diagnostics.
- **IR is the contract.** Graph layout, simulation, tests, truth tables, and export all read the same serializable object.
- **Case rules are predictable.** Built-ins are case-insensitive; signal names are case-sensitive.

## Example library highlights

| Example | Focus |
| --- | --- |
| Half adder | First circuit; NAND-derived package gates and exhaustive tests |
| Full adder | Nested circuit instances and named ports |
| 8-bit adder | Fixed-width package arithmetic, binary literals, overflow |
| 4:1 multiplexer | Package MUX and bus-bit indexing |
| Bus wiring | CONCAT, SLICE, and REVERSE without Boolean gates |
| Majority vote | Variadic gates and readable intermediates |
| Gated bus | BROADCAST as a structural mask |
| Register 8 | Rising-edge state with enable |
| Counter 4 | ADD4/MUX next-state logic and edge commits |

## Roadmap

- Built-in latches, registers, RAM primitives and timed delays
- More package circuits for wider arithmetic, comparison, and shifts
- HDL / Verilog export from the IR
- Faster truth tables for wider buses and symbolic input grouping
- Clocked test sequences and multi-cycle traces
- More backends: alternate language hosts, WASM, hardware description generators

## Command line

The engine has no browser dependency, so the same tools run from a terminal.

```bash
npm run cli:build            # bundle the command line tool

node packages/cli/dist/cli.js compile circuit.lf
node packages/cli/dist/cli.js test circuit.lf
node packages/cli/dist/cli.js truth-table circuit.lf --circuit HalfAdder
node packages/cli/dist/cli.js format circuit.lf --write
node packages/cli/dist/cli.js export-ir circuit.lf --out out.json
node packages/cli/dist/cli.js export-verilog circuit.lf --out out.v
```

Every command exits with 0 on success and 1 on a diagnostic error or a failed
test, so it works in a pipeline. `--json` prints machine-readable output where
it is available.

---

## Contributing

The project is MIT licensed (see [LICENSE](LICENSE)). Every change should keep
the three promises the engine makes: static validation before simulation, no
silent width truncation, and no plausible output after a fatal error.

```bash
npm test        # engine, studio, and cross-package tests
npm run typecheck
npm run build
```

A GitHub Actions workflow runs the same three commands on every push and pull
request.

---

## Documentation

- [Fundamentals and package plan](FUNDAMENTALS.md)
- [Language reference](docs/LANGUAGE.md)
- [Architecture and pipeline](docs/ARCHITECTURE.md)
- [Portable IR](docs/IR.md)

Short Circuit is an independent project. “Short Circuit” and “LogicFlow” are working names for the studio and language.
