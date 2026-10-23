# @shortcircuitcli/cli

The command line compiler, simulator, tester, formatter, and exporter for the
Short Circuit LogicFlow language.

## Requirements

Node.js 22.19 or newer.

## Install

```bash
npm install -g @shortcircuitcli/cli
```

To update an existing global install:

```bash
npm install -g @shortcircuitcli/cli@latest
```

or:

```bash
npm update -g @shortcircuitcli/cli
```

The explicit `@latest` install is the most reliable.

## Commands

```bash
shortcircuit compile circuit.lf
shortcircuit test circuit.lf
shortcircuit truth-table circuit.lf --circuit HalfAdder
shortcircuit format circuit.lf --write
shortcircuit export-ir circuit.lf --out out.json
shortcircuit export-verilog circuit.lf --out out.v
```

Every command exits with 0 on success and 1 on a diagnostic error or a failed
test, so it works in a pipeline. `--json` prints machine-readable output where
it is available.

The CLI bundles the compiler, simulator, and default LogicFlow package snapshot,
so it runs offline after installation.

## Packages

`package list` shows the bundled packages and any local packages you load,
along with their export counts and origin:

```bash
shortcircuit package list
shortcircuit package list --json
shortcircuit package list --package /path/to/package
```

Activate a package by adding an `IMPORT` line to the source:

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

The CLI, studio, and engine API all read the same imports. Load a local package
directory or a `manifest.json` path with `--package`:

```bash
shortcircuit compile circuit.lf --package /path/to/package
```

`--package` is repeatable. Local packages must use a name that is not already
bundled. The loader inlines the package source, docs, and tests.

### Authoring packages

The CLI can drive the package registry from a Short Circuit checkout:

```bash
shortcircuit package init
shortcircuit package init --name @acme/parity --export PARITY3 --kind macro
shortcircuit package build
shortcircuit package test
shortcircuit package check
shortcircuit package registry
```

`init` prompts for the package fields, then writes the package directory,
source, docs, tests, and registry entry. Use `shortcircuit package init --help`
for every flag.

The commands find `vendor/ShortCircuit-Packages` from the current directory, or
accept `--root`:

```bash
shortcircuit package build --root /path/to/ShortCircuit-Packages
```

`package test` and `package check` run the main repository tests. Use `--main`
when the package registry is outside the main checkout:

```bash
shortcircuit package test --root /path/to/ShortCircuit-Packages \
  --main /path/to/ShortCircuit
```

`package list` shows packages available to the compiler. `package registry`
shows packages registered for authoring.

## Source

[github.com/samTime101/ShortCircuit](https://github.com/samTime101/ShortCircuit)
