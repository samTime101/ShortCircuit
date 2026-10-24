# Short Circuit

[![npm version](https://img.shields.io/npm/v/@shortcircuitcli/cli.svg)](https://www.npmjs.com/package/@shortcircuitcli/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.19-brightgreen.svg)](https://nodejs.org/)

**Short Circuit** is a text-first digital logic language and simulation studio. Describe circuits as graphs of named signals using the **LogicFlow** language, then compile, simulate, test, and export — all from the same source.

```logicflow
IMPORT "@shortcircuit/gates"

CIRCUIT HalfAdder
  INPUT a
  INPUT b

  sum   = XOR(a, b)
  carry = AND(a, b)

  OUTPUT sum
  OUTPUT carry
END

TEST HalfAdder
  CASE "1 + 1"
    INPUT a = 1
    INPUT b = 1
    EXPECT sum   = 0
    EXPECT carry = 1
  END
END
```

> **Live demo**: Open the web studio at [shortcircuit-eight.vercel.app](https://shortcircuit-eight.vercel.app) (or run locally — see [Quick Start](#quick-start)).

---

## Features

- **Declarative language (LogicFlow)** — Function-style gates, named signals, buses, and composition. No semicolons or braces.
- **Static validation first** — Undeclared signals, width mismatches, missing ports, illegal recursion, combinational loops, and clock conflicts caught before simulation.
- **Packages as source** — Gates, arithmetic, selection, and comparison are real `.lf` files. The kernel provides only `NAND`; everything else is composable.
- **Built-in testing** — In-source `TEST` cases with `CASE`, `STEP`, `CYCLE`, and exhaustive truth-table generation.
- **Live studio** — CodeMirror editor with diagnostics, interactive inputs, dependency graph with live values, waveform viewer, and test runner.
- **Multiple outputs** — Values, LEDs, 7-segment, bars, grids. Bus values shown in decimal alongside bits.
- **Verilog export** — Portable IR compiles to Verilog modules + testbenches.
- **CLI & API** — Same compiler/simulator runs in terminal, CI, or embedded via `@shortcircuit/engine`.

---

## Quick Start

### Web Studio (Recommended for New Users)

```bash
# Requires Node.js 22.19+
git clone --recurse-submodules https://github.com/samTime101/ShortCircuit.git
cd ShortCircuit
npm ci
npm run dev
```

Open the printed URL (typically `http://localhost:5173`). The studio loads with examples, documentation, and a package manager.

### Command Line

```bash
# Global install (published releases)
npm install -g @shortcircuitcli/cli

# Or build from source
git clone --recurse-submodules https://github.com/samTime101/ShortCircuit.git
cd ShortCircuit
npm ci
npm run cli:build
npx shortcircuit help
```

Create a project and compile a circuit:

```bash
shortcircuit init my-project
cd my-project
shortcircuit package install @shortcircuit/gates
shortcircuit compile src/main.lf
shortcircuit test src/main.lf
```

---

## Documentation

| Topic | Description |
|-------|-------------|
| [Language Reference](docs/LANGUAGE.md) | Complete syntax, semantics, width rules, operations, diagnostics |
| [Package Authoring](docs/PACKAGES.md) | Step-by-step guide to creating and publishing packages |
| [Architecture](docs/ARCHITECTURE.md) | Compiler pipeline, IR schema, extension points |
| [Portable IR](docs/IR.md) | IR specification and porting guide |
| [Releasing](docs/RELEASING.md) | CLI release workflow and trusted publishing setup |
| [Fundamentals](FUNDAMENTALS.md) | Design principles and package roadmap |

---

## Repository Structure

```
short-circuit/
├─ packages/
│  ├─ engine/          # Framework-free compiler + simulator (core)
│  │  ├─ src/          # Lexer, parser, analyzer, simulator, testing, IR
│  │  └─ test/         # Engine unit & integration tests
│  └─ cli/             # @shortcircuitcli/cli — command line interface
├─ apps/web/           # React 19 + Vite studio (editor, graph, waveform, docs)
├─ vendor/
│  └─ ShortCircuit-Packages/  # Package registry (git submodule)
├─ tests/              # Cross-package and documentation tests
├─ scripts/            # Documentation generator
└─ docs/               # Generated and hand-written documentation
```

The engine (`packages/engine`) has **zero dependencies** on DOM, React, or browser APIs. It can be embedded in any JS/TS environment or ported to other languages via the `shortcircuit.ir/v1` schema.

---

## Design Principles

1. **No plausible output after a fatal error** — Compilation failure clears the live graph; no stale simulation.
2. **No silent width truncation** — Width behavior is explicit, documented, and validated.
3. **Static before dynamic** — Graph and clocking errors are compile-time diagnostics.
4. **IR is the contract** — Graph, simulation, tests, truth tables, and export all consume the same serializable IR.
5. **Predictable case rules** — Built-ins are case-insensitive; signal names are case-sensitive.

---

## Example Circuits

| Example | Concepts |
|---------|----------|
| Half Adder | First circuit; NAND-derived gates, exhaustive tests |
| Full Adder | Nested circuits, named ports |
| 8-bit Adder | Fixed-width arithmetic, binary literals, overflow |
| 4:1 Mux | Package `MUX`, bus indexing |
| Bus Wiring | `CONCAT`, `SLICE`, `REVERSE` without Boolean gates |
| Register 8 | Rising-edge `STATE` with enable |
| Counter 4 | `ADD4`/`MUX` next-state logic, edge commits |

All examples are available in the studio (**File → Open Example**) and in `apps/web/src/lib/examples/`.

---

## Commands Reference

### Project Commands

| Command | Description |
|---------|-------------|
| `shortcircuit init [dir] [--registry <url>]` | Scaffold a new project |
| `shortcircuit compile <file.lf> [--package <dir>] [--json]` | Compile to IR |
| `shortcircuit test <file.lf> [--json]` | Run in-source tests |
| `shortcircuit truth-table <file.lf> --circuit <name> [--json]` | Exhaustive enumeration |
| `shortcircuit format <file.lf> [--write]` | Canonical formatting |
| `shortcircuit export-ir <file.lf> --out <file.json>` | Write portable IR |
| `shortcircuit export-verilog <file.lf> --out <file.v>` | Write Verilog + testbench |

All commands exit `0` on success, `1` on diagnostic error or failed test. Use `--json` for machine-readable output.

### Package Commands

| Command | Description |
|---------|-------------|
| `shortcircuit package list [--json] [upstream] [--refresh]` | List installed/available packages |
| `shortcircuit package install [<name>[@<version>]] [--save-exact] [--offline] [--frozen]` | Install registry packages |
| `shortcircuit package update [<name>] [--latest]` | Update installed packages |
| `shortcircuit package uninstall <name>` | Remove a dependency |
| `shortcircuit package link <name\|path>` | Link a local package (path: dependency) |
| `shortcircuit package init [dir] [--name @scope/name] [--export NAME] [--kind macro\|circuit] [--yes]` | Scaffold a new package |
| `shortcircuit package add-export --export NAME --kind macro\|circuit` | Add export to existing package |
| `shortcircuit package build` | Validate and write `dist/packages.json` |
| `shortcircuit package test` | Run package tests |
| `shortcircuit package check` | Build + test |
| `shortcircuit package register --dry-run` | Validate and create registry submission bundle |

---

## Package Ecosystem

The CLI does **not** ship the default package snapshot used by the web studio. Install what you need:

```bash
# Core gates (NOT, AND, OR, XOR, NOR, XNOR, BUFFER)
shortcircuit package install @shortcircuit/gates

# Arithmetic (HALF_ADDER, FULL_ADDER, ADD4, ADD8)
shortcircuit package install @shortcircuit/arithmetic

# Selection (MUX)
shortcircuit package install @shortcircuit/selection
```

Then import in your source:

```logicflow
IMPORT "@shortcircuit/gates"
IMPORT "@shortcircuit/arithmetic"

CIRCUIT Add8Demo
  INPUT a[8]
  INPUT b[8]
  sum[8] = ADD8(a, b)
  OUTPUT sum
END
```

See [Package Authoring Guide](docs/PACKAGES.md) for creating your own packages.

---

## Development

```bash
# Install dependencies
npm ci

# Run all tests (engine, studio, cross-package)
npm test

# Type-check
npm run typecheck

# Build all packages
npm run build

# Regenerate language reference (docs/LANGUAGE.md)
npm run docs:generate

# Development studio with HMR
npm run dev
```

### Testing the CLI Package Locally

```bash
npm run test:cli-packed   # Tests the exact tarball that will be published
```

---

## Contributing

Short Circuit is MIT licensed. Every change must preserve the three engine guarantees:

1. Static validation before simulation
2. No silent width truncation
3. No plausible output after a fatal error

```bash
npm test        # Run full test suite
npm run typecheck
npm run build
```

A GitHub Actions workflow runs these on every push and PR.

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

## Links

- **Website / Studio**: [shortcircuit.dev](https://shortcircuit.dev)
- **CLI on npm**: [@shortcircuitcli/cli](https://www.npmjs.com/package/@shortcircuitcli/cli)
- **Package Registry**: [github.com/samTime101/ShortCircuit-Packages](https://github.com/samTime101/ShortCircuit-Packages)
- **Issues**: [GitHub Issues](https://github.com/samTime101/ShortCircuit/issues)