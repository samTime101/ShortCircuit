# @shortcircuitcli/cli

[![npm version](https://img.shields.io/npm/v/@shortcircuitcli/cli.svg)](https://www.npmjs.com/package/@shortcircuitcli/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/samTime101/ShortCircuit/blob/main/LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.19-brightgreen.svg)](https://nodejs.org/)

> **Command-line compiler, simulator, tester, formatter, and exporter for the Short Circuit LogicFlow language.**

## Overview

The CLI bundles the framework-free `@shortcircuit/engine` — a standalone TypeScript compiler and simulator with zero browser dependencies. It reads `.lf` (LogicFlow) source files and can:

- **Compile** to portable IR (`shortcircuit.ir/v1`)
- **Simulate** combinational and sequential circuits
- **Test** in-source test cases and generate truth tables
- **Format** source canonically
- **Export** Verilog modules and testbenches
- **Manage packages** (install, link, author, publish)

---

## Install

```bash
# Global install (recommended)
npm install -g @shortcircuitcli/cli

# Update to latest
npm install -g @shortcircuitcli/cli@latest
# or
npm update -g @shortcircuitcli/cli
```

**Requires Node.js 22.19+**

---

## Quick Start

```bash
# 1. Create a project
shortcircuit init my-adder
cd my-adder

# 2. Install the gates package (provides AND, XOR, etc.)
shortcircuit package install @shortcircuit/gates

# 3. Write a circuit (src/main.lf created by init)
cat > src/main.lf << 'EOF'
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
EOF

# 4. Compile and test
shortcircuit compile src/main.lf
shortcircuit test src/main.lf
```

---

## Commands

### Core Commands

| Command | Description |
|---------|-------------|
| `shortcircuit compile <file.lf> [options]` | Compile to IR, validate, print diagnostics |
| `shortcircuit test <file.lf> [options]` | Run all `TEST` blocks in the file |
| `shortcircuit truth-table <file.lf> --circuit <name> [options]` | Exhaustive enumeration for combinational circuits |
| `shortcircuit format <file.lf> [--write]` | Canonical formatting (like Prettier for LogicFlow) |
| `shortcircuit export-ir <file.lf> --out <file.json>` | Write portable IR (`shortcircuit.ir/v1`) |
| `shortcircuit export-verilog <file.lf> --out <file.v>` | Write Verilog module + testbench |

**Common options:**
- `--json` — Machine-readable output (where available)
- `--package <dir>` — Load additional local package (repeatable)
- `--help` — Command-specific help

### Project Management

| Command | Description |
|---------|-------------|
| `shortcircuit init [dir] [--registry <url>]` | Scaffold project (`shortcircuit.json`, `shortcircuit.lock.json`, `src/main.lf`, `.gitignore`) |
| `shortcircuit package list [--json] [upstream] [--refresh]` | List installed or available registry packages |
| `shortcircuit package install [<name>[@<version>]] [options]` | Install registry packages to `.shortcircuit/packages` |
| `shortcircuit package update [<name>] [--latest]` | Update installed packages |
| `shortcircuit package uninstall <name>` | Remove dependency from project |
| `shortcircuit package link <name\|path>` | Link local package (stores `path:` dependency, no symlinks) |

### Package Authoring

| Command | Description |
|---------|-------------|
| `shortcircuit package init [dir] [options]` | Scaffold new package (interactive or `--yes` for non-interactive) |
| `shortcircuit package add-export --export <NAME> --kind <macro\|circuit>` | Add export to existing package |
| `shortcircuit package build` | Validate manifests and write `dist/packages.json` |
| `shortcircuit package test` | Run package tests |
| `shortcircuit package check` | Build + test in one command |
| `shortcircuit package register --dry-run` | Validate and create registry submission bundle |

---

## Package Management

### Installing Registry Packages

```bash
# Install latest compatible version
shortcircuit package install @shortcircuit/gates

# Install specific version/range
shortcircuit package install @shortcircuit/gates@^0.1.0
shortcircuit package install @shortcircuit/gates --save-exact

# Install all from shortcircuit.json
shortcircuit package install
```

**Useful flags:**
| Flag | Purpose |
|------|---------|
| `--registry <url>` | Override registry index (supports `file://`) |
| `--offline` | Use only cached data |
| `--refresh` | Ignore cache, fetch fresh |
| `--frozen` | Fail if lockfile/store incomplete (CI) |
| `--force` | Replace conflicting dependency |
| `--save-exact` | Pin exact version |
| `--latest` | Save latest version as range |

Default registry: `https://raw.githubusercontent.com/samTime101/ShortCircuit-Packages/main/registry.json`  
Override with `SHORTCIRCUIT_REGISTRY_URL` env var or project `registry` field.

### Linking Local Packages

```bash
# Link by short name (from project root)
shortcircuit package link com16bit

# Link by scoped name
shortcircuit package link @samip101/com16bit

# Link by path
shortcircuit package link packages/com16bit
shortcircuit package link /absolute/path/to/com16bit
```

Linked packages are read in-place — no files copied, no symlinks created.  
`package uninstall` removes the dependency entry but **never deletes** the linked package.

### One-off Compilation with Local Packages

```bash
shortcircuit compile circuit.lf --package packages/com16bit
shortcircuit compile circuit.lf --package /path/to/pkg/manifest.json
```

`--package` is repeatable. The loader inlines source, docs, and tests — same layout works with the engine API.

---

## Creating a Package

Package authoring works **anywhere** — no registry checkout needed.

### From an Empty Directory

```bash
shortcircuit package init \
  --name @acme/parity \
  --export PARITY3 \
  --kind macro \
  --description "Three-input parity built from NAND." \
  --dependencies @shortcircuit/gates \
  --yes
```

### From a Project Root (Monorepo Style)

```bash
# Create package in subdirectory
shortcircuit package init packages/com1bit \
  --name @shortcircuit/com1bit \
  --export COM1BIT \
  --kind circuit \
  --yes

# Link it into the project
shortcircuit package link @shortcircuit/com1bit
```

### Export Kinds

| Kind | Description | Example |
|------|-------------|---------|
| `macro` | Reusable expression, expands at use site | `AND(a, b)` |
| `circuit` | Reusable block with named ports, instantiated as node | `HALF_ADDER(a, b)` |

The scaffold creates:
- `package.json` / `manifest.json` (catalog metadata)
- `.lf` source file (implementation)
- `docs/` (markdown documentation)
- `tests/` (package test suite)
- `.gitignore`

### Build, Test, and Register

```bash
shortcircuit package build   # Validate + write dist/packages.json
shortcircuit package test    # Run package tests
shortcircuit package check   # Build + test
shortcircuit package register --dry-run  # Create submission bundle
```

`package register` writes a validated bundle to `.shortcircuit/register/<pkg>-<version>/`. Opening the registry PR is manual. See [Package Authoring Guide](../docs/PACKAGES.md) for complete workflow.

---

## Configuration

### Project: `shortcircuit.json`

```json
{
  "name": "my-project",
  "version": "0.1.0",
  "registry": "https://custom.registry/registry.json",
  "dependencies": {
    "@shortcircuit/gates": "^0.1.0"
  }
}
```

### Lockfile: `shortcircuit.lock.json`

Records exact versions, URLs, and SHA-256 integrity for reproducible builds. Commit this file.

### Cache Location

```
SHORTCIRCUIT_CACHE
→ $XDG_CACHE_HOME/shortcircuit
→ ~/.cache/shortcircuit
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Diagnostic error or test failure |

All commands respect this for pipeline/CI usage.

---

## Using the Engine API Directly

For embedding in tools, scripts, or other languages:

```bash
npm install @shortcircuit/engine
```

```ts
import { compile, simulate, test, format, exportVerilog } from "@shortcircuit/engine";

const result = compile(source, {
  packages: bundle,           // PackageBundle or manifest[]
  disableDefaultPackages: false,
});

if (!result.ok) {
  console.error(result.diagnostics);
  process.exit(1);
}

const sim = simulate(result.ir, { inputs: { a: 1, b: 0 } });
console.log(sim.values);  // { sum: 1, carry: 0 }
```

See [IR.md](../docs/IR.md) for the portable IR schema and [ARCHITECTURE.md](../docs/ARCHITECTURE.md) for extension points.

---

## Development

```bash
# From ShortCircuit repo root
npm ci
npm run cli:build       # Build CLI to packages/cli/dist/cli.js
npx shortcircuit help   # Test local build
npm run test:cli-packed # Test exact publish tarball
```

---

## License

MIT — see [LICENSE](../../LICENSE) in the main repository.

---

## Links

- **Main Repository**: [github.com/samTime101/ShortCircuit](https://github.com/samTime101/ShortCircuit)
- **Package Registry**: [github.com/samTime101/ShortCircuit-Packages](https://github.com/samTime101/ShortCircuit-Packages)
- **Language Reference**: [docs/LANGUAGE.md](../docs/LANGUAGE.md)
- **Package Authoring**: [docs/PACKAGES.md](../docs/PACKAGES.md)