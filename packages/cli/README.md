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

## Create a project

```bash
shortcircuit init
shortcircuit init my-project --registry https://example.com/registry.json
cd my-project
shortcircuit compile src/main.lf
shortcircuit test src/main.lf
```

`init` creates `shortcircuit.json`, `shortcircuit.lock.json`, `src/main.lf`,
and a `.gitignore` entry for `.shortcircuit/` and `dist/`.

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

The CLI bundles the compiler and simulator. It does **not** ship the default
package snapshot used by the web studio. Install or link the packages a project
imports before compiling it.

## Packages

Packages are scoped npm-style names. The package name is separate from the
export it provides, for example package `@samip101/com16bit` exports
`COM16BIT`.

The compiler kernel provides `NAND`. Everything else comes from packages:

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

### Project commands

```bash
shortcircuit package list
shortcircuit package list --json
shortcircuit package list upstream
shortcircuit package list upstream --refresh

shortcircuit package install
shortcircuit package install @shortcircuit/gates
shortcircuit package install @shortcircuit/gates@^0.1.0
shortcircuit package install @shortcircuit/gates --save-exact

shortcircuit package update
shortcircuit package update @shortcircuit/gates
shortcircuit package update @shortcircuit/gates --latest

shortcircuit package uninstall @shortcircuit/gates
```

Registry packages are downloaded into `.shortcircuit/packages` and recorded in
`shortcircuit.lock.json` with their resolved URL and SHA-256 integrity. One
version of a package name is active at a time. `package install` with no name
installs everything in `shortcircuit.json`.

Useful flags:

| Flag | Meaning |
| --- | --- |
| `--registry <url>` | Use a specific registry index, including a `file://` fixture. |
| `--offline` | Use only cached registry data and package archives. |
| `--refresh` | Ignore cached registry data. |
| `--frozen` | Fail if the lockfile or `.shortcircuit/packages` is incomplete. |
| `--force` | Replace a conflicting dependency or generated file. |
| `--save-exact` | Save an exact version instead of a caret range. |
| `--latest` | Change the saved range to the latest version. |

The default registry is
`https://raw.githubusercontent.com/samTime101/ShortCircuit-Packages/main/registry.json`.
Set `SHORTCIRCUIT_REGISTRY_URL` or a project's `registry` field to override it.
Cached data lives in `SHORTCIRCUIT_CACHE`, then `$XDG_CACHE_HOME/shortcircuit`,
then `~/.cache/shortcircuit`.

### Local packages

`package link` records a `path:` dependency in `shortcircuit.json`:

```bash
shortcircuit package link com16bit
shortcircuit package link packages/com16bit
shortcircuit package link /absolute/path/to/com16bit
```

The package is read in place. No files are copied and no symlink is created.
`package uninstall` removes the dependency entry but never deletes the linked
package directory.

For a one-off compile without changing the project, use `--package`:

```bash
shortcircuit compile circuit.lf --package packages/com16bit
```

`--package` is repeatable.

### Authoring packages

Package authoring works in any directory. It does not require a checkout of the
package registry:

```bash
shortcircuit package init
shortcircuit package init \
  --name @acme/parity \
  --export PARITY3 \
  --kind macro \
  --description "Three-input parity built from NAND." \
  --dependencies @shortcircuit/gates \
  --yes

shortcircuit package build   # validate and write dist/packages.json
shortcircuit package test    # run the package's .lf tests
shortcircuit package check   # build and test
shortcircuit package register --dry-run
```

`package init` explains the two export kinds before creating files:

- **MACRO** is a reusable expression such as `AND(a, b)`. Macros expand into
  the circuit that uses them.
- **CIRCUIT** is a reusable block with named ports. Circuits are instantiated
  as nodes.

The scaffold writes `package.json`, `manifest.json`, `.lf` source, docs, tests,
an empty lockfile, and a `.gitignore`. Use `shortcircuit package init --help`
for every flag.

`package register` validates the package, runs its tests, records the payload
integrity, and writes a submission bundle under
`.shortcircuit/register/<package>-<version>/`. `--dry-run` prints the registry
entry, integrity, and file list without writing. Opening the registry pull
request is still a manual step.

Packages can declare registry dependencies. `package test` and
`package register` resolve them from the package's own `shortcircuit.lock.json`
after `shortcircuit package install` in that directory.

## Source

[github.com/samTime101/ShortCircuit](https://github.com/samTime101/ShortCircuit)
