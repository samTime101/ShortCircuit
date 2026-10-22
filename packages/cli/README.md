# @shortcircuitcli/cli

The command line compiler, simulator, tester, formatter, and exporter for the
Short Circuit LogicFlow language.

## Requirements

Node.js 22.19 or newer.

## Install

```bash
npm install -g @shortcircuitcli/cli
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

## Packages

`package list` shows the bundled packages and any local packages you load,
along with their export counts, enabled state, and origin:

```bash
shortcircuit package list
shortcircuit package list --json
shortcircuit package list --package /path/to/package
```

Change the active packages on any compile command:

```bash
shortcircuit compile circuit.lf --disable-package @shortcircuit/arithmetic
shortcircuit compile circuit.lf --only-packages @shortcircuit/gates
shortcircuit compile circuit.lf --package /path/to/package --no-default-packages
```

`--package`, `--disable-package`, and `--only-packages` are repeatable.
`--disable-package` and `--only-packages` also accept comma-separated names.
`--only-packages` is an allowlist, so list a package's dependencies too.
`--package` accepts a package directory or a `manifest.json` path. Local
packages must use a name that is not already bundled. The loader inlines the
package source, docs, and tests.

## Source

[github.com/samTime101/ShortCircuit](https://github.com/samTime101/ShortCircuit)
