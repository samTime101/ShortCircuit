# @shortcircuit/cli

The command line compiler, simulator, tester, formatter, and exporter for the
Short Circuit LogicFlow language.

## Requirements

Node.js 22.19 or newer.

## Install

```bash
npm install -g @shortcircuit/cli
```

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

## Source

[github.com/samTime101/ShortCircuit](https://github.com/samTime101/ShortCircuit)
