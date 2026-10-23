# Creating a Short Circuit package

This guide creates a package with the CLI, builds it, tests it, links it into a
project, and prepares it for a registry submission.

Packages are source-first. Implementations live in `.lf` files. A manifest
contains catalog metadata and source pointers; it never contains a macro body
or a circuit body.

> The CLI does not ship a package registry checkout. Package creation,
> installation, and testing work in any directory. The web studio keeps its own
> bundled snapshot, so its behavior is unchanged.

---

## Package names and exports

Package names are scoped npm-style names:

```text
@samip101/com16bit
@acme/parity
@shortcircuit/gates
```

The package name is not the export name. A package can export one or more
public names:

```text
Package: @samip101/com16bit
Export:  COM16BIT
```

Exports come in two kinds:

- **MACRO** is a reusable expression such as `AND(a, b)` or `XOR(a, b)`.
  Macros expand into the circuit that uses them. They are a good fit for small
  combinational expressions.
- **CIRCUIT** is a reusable block with named ports, such as `ADD4` or
  `COM16BIT`. Circuits are instantiated as nodes and can have their own internal
  structure.

---

## Quick start: scaffold a package

Run the command from an empty directory or pass a directory to create:

```bash
shortcircuit package init
```

The command explains MACRO versus CIRCUIT before creating files. With no flags,
it prompts for the name, export, kind, description, version, license, and
dependencies.

When the package lives inside an existing project, pass a subdirectory:

```bash
shortcircuit package init packages/com1bit \
  --name @shortcircuit/com1bit \
  --export COM1BIT \
  --kind circuit \
  --yes
shortcircuit package link @shortcircuit/com1bit
```

`package init` refuses to write package files directly into a project root.
Likewise, `shortcircuit init` refuses to create a project over a package root.

For scripts and automation:

```bash
shortcircuit package init \
  --name @acme/parity \
  --export PARITY3 \
  --kind macro \
  --description "Three-input parity built from NAND." \
  --dependencies @shortcircuit/gates \
  --yes
```

Useful flags:

| Flag | Meaning |
| --- | --- |
| `--name <@scope/name>` | Scoped package name. Required when not prompting. |
| `--export <NAME>` | Public macro or circuit name. Defaults to the upper-case package name. |
| `--kind <macro\|circuit>` | Export kind. Default: `macro`. |
| `--description <text>` | Catalog description. |
| `--version <semver>` | Package version. Default: `0.1.0`. |
| `--license <id>` | License identifier. Default: `MIT`. |
| `--dependencies <list>` | Comma-separated package names. |
| `--force` | Replace generated files in an existing package. |
| `--yes` | Use defaults and never prompt. `--name` is still required. |

The scaffold creates:

```text
package.json
manifest.json
macros/<export>/macro.lf     # or circuits/<export>/circuit.lf
docs/<export>.md             # or circuits/<export>/docs.md
tests/<package>.test.lf
shortcircuit.lock.json
.gitignore
```

The generated source is a NAND scaffold. Replace it with the real
implementation and update the docs and tests.

---

## Build and test

From the package directory:

```bash
shortcircuit package build   # validate and write dist/packages.json
shortcircuit package test    # run the package's .lf tests
shortcircuit package check   # build and test
```

`package build` validates the manifest, package metadata, source paths, docs,
tests, and export declarations, then writes a one-package
`dist/packages.json` bundle.

`package test` compiles each package-level or export-level test with the package
and its installed dependencies. Registry dependencies must be installed first:

```bash
shortcircuit package install
shortcircuit package test
```

Path dependencies are read in place and need no install step, but they must be
recorded in the manifest and lockfile.

---

## Manifest and source layout

A minimal package looks like this:

```text
parity/
  package.json
  manifest.json
  macros/
    parity3/
      macro.lf
  docs/
    parity3.md
  tests/
    parity.test.lf
```

`manifest.json`:

```json
{
  "schema": "shortcircuit.package/v1",
  "name": "@acme/parity",
  "version": "0.1.0",
  "engine": "^0.1.0",
  "description": "Three-input parity built from NAND.",
  "tests": "tests/parity.test.lf",
  "exports": [
    {
      "kind": "macro",
      "name": "PARITY3",
      "source": "macros/parity3/macro.lf",
      "group": "Arithmetic",
      "summary": "Three-input parity.",
      "docs": "docs/parity3.md",
      "examples": ["y = PARITY3(a, b, c)"],
      "widthRule": "Result width = common input width"
    }
  ]
}
```

- `source` points at the `.lf` file that declares the export.
- `docs` points at a Markdown file.
- `tests` at the package level names package tests.
- A circuit export can also provide its own `tests` file and port metadata.
- Paths must stay inside the package directory.

`package.json` is optional, but recommended. When present, its `name` and
`version` must match `manifest.json`.

A macro source declares only the public macro:

```logicflow
MACRO PARITY3(a, b, c)
  BODY XOR(XOR(a, b), c)
END
```

A circuit source declares an ordinary circuit:

```logicflow
CIRCUIT COM16BIT
  INPUT a
  INPUT b
  INPUT cin

  sum = XOR(XOR(a, b), cin)
  carry = OR(AND(a, b), AND(cin, XOR(a, b)))

  OUTPUT sum
  OUTPUT carry
END
```

Package circuits should use only the kernel `NAND` and their declared
dependencies. They are compiled with the package's dependencies and do not see
the web studio's default snapshot.

Dependencies use the same scoped names and semver ranges:

```json
{
  "dependencies": {
    "@shortcircuit/gates": "^0.1.0"
  }
}
```

Registry packages cannot declare `path:` dependencies. Path links are for local
development in a project.

---

## Use a package in a project

Create a project first:

```bash
shortcircuit init
```

Install a registry package:

```bash
shortcircuit package install @shortcircuit/gates
```

This writes a dependency such as `"@shortcircuit/gates": "^0.1.0"` and installs
the resolved version into `.shortcircuit/packages`. `shortcircuit.lock.json`
records the exact version, resolved URL, integrity, and transitive
dependencies.

Then import it in source:

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

### Link a local package

During package development, link the directory instead of installing it:

```bash
shortcircuit package link com16bit
shortcircuit package link @samip101/com16bit
shortcircuit package link packages/com16bit
shortcircuit package link /absolute/path/to/com16bit
```

`link` writes a path dependency:

```json
{
  "dependencies": {
    "@samip101/com16bit": "path:packages/com16bit"
  }
}
```

The package is read in place. No files are copied and no symlink is created.
`package uninstall com16bit` removes the dependency entry but never deletes the
linked package files. Use `--force` to replace a conflicting registry
dependency with a path link.

### One-off local packages

For a single compile without changing the project manifest:

```bash
shortcircuit compile circuit.lf --package packages/com16bit
shortcircuit compile circuit.lf --package packages/com16bit/manifest.json
```

`--package` is repeatable. This loads the package for that command only.

---

## Install, update, and verify

```bash
shortcircuit package list
shortcircuit package list upstream --refresh
shortcircuit package install
shortcircuit package update
shortcircuit package update @shortcircuit/gates --latest
shortcircuit package uninstall @shortcircuit/gates
shortcircuit package install --frozen
```

- `package list` reads `shortcircuit.lock.json` and reports each package's
  version, origin (`local` or `registry`), state, export count, and path.
- `package list upstream` fetches the registry index and each package manifest.
- `package install` with no name installs everything in the manifest.
- `package update` stays within saved ranges. `--latest` moves the saved range
  to the latest version.
- `package install --frozen` fails if the lockfile or package store is
  incomplete.
- `package uninstall` removes a direct dependency, prunes unreachable registry
  packages, and leaves path-linked files alone.

Useful flags:

| Flag | Meaning |
| --- | --- |
| `--registry <url>` | Use a specific registry index, including a `file://` path. |
| `--offline` | Use only cached registry data and package archives. |
| `--refresh` | Ignore cached registry data. |
| `--frozen` | Verify the lockfile and package store without changing them. |
| `--force` | Replace a conflicting dependency or generated file. |
| `--save-exact` | Save an exact version instead of a caret range. |
| `--latest` | Update the saved range to the latest version. |

The default registry is:

```text
https://raw.githubusercontent.com/samTime101/ShortCircuit-Packages/main/registry.json
```

Override it with `--registry`, a project `registry` field, or
`SHORTCIRCUIT_REGISTRY_URL`. Cache data lives in `SHORTCIRCUIT_CACHE`, then
`$XDG_CACHE_HOME/shortcircuit`, then `~/.cache/shortcircuit`.

---

## Registry format

A registry index can be flat (v1):

```json
{
  "schema": "shortcircuit.registry/v1",
  "packages": [
    {
      "name": "@acme/parity",
      "version": "0.1.0",
      "manifest": "packages/parity/manifest.json"
    }
  ]
}
```

or versioned (v2):

```json
{
  "schema": "shortcircuit.registry/v2",
  "packages": [
    {
      "name": "@acme/parity",
      "description": "Three-input parity.",
      "versions": {
        "0.1.0": {
          "manifest": "packages/parity-0.1.0/manifest.json"
        }
      }
    }
  ]
}
```

Manifest paths are relative to the registry index. Package files are fetched
from the manifest's directory. A package can also be served from a `file://`
registry during development and tests.

The installer records a SHA-256 integrity over the canonical package payload it
downloads: the manifest, optional `package.json`, sources, docs, tests, and
`README`/`LICENSE` files.

---

## Prepare a registry submission

`package register` validates the package, runs its tests, records the payload
integrity, and writes a submission bundle:

```bash
shortcircuit package register
shortcircuit package register --dry-run
shortcircuit package register --dry-run --json
```

The bundle is written under:

```text
.shortcircuit/register/<package>-<version>/
  submission.json
  package/
    manifest.json
    package.json
    ...
```

`submission.json` contains a ready-to-copy registry entry, the payload
integrity, and every payload file. Registration refuses path dependencies
because a published package must resolve its dependencies from the registry.

Opening the pull request against the package registry is still manual. Copy the
registry entry and package files from the submission bundle, then follow the
registry repository's contribution instructions.

---

## Troubleshooting

### `E602 Cannot import "@acme/parity"`

The source has an `IMPORT` but the package is not loaded. Check:

```bash
shortcircuit package list
shortcircuit package install
```

For a linked package, verify the manifest name matches the import and the path
dependency exists in `shortcircuit.json`.

### `Dependency ... is not installed`

Run `shortcircuit package install` in the project or package root. For a
package under development, its own registry dependencies need their own lockfile
and install.

### `Package ... does not match package.json name/version`

If `package.json` exists, its `name` and `version` must match `manifest.json`.
Update one or remove `package.json` if it is not needed.

### `... is not declared in ...`

The manifest export's `source` does not contain a matching `MACRO <NAME>(` or
`CIRCUIT <NAME>` declaration. Check the export name and source path.

### `Path dependency ... points to ... which does not exist`

The linked directory is missing or moved. Update the dependency or run
`shortcircuit package link` again from the project root.

### `No version of ... satisfies ...`

The requested range cannot be met by the registry's available versions. Run
`shortcircuit package list upstream --refresh` and adjust the range.

### `... is missing from .shortcircuit/packages`

The package store is incomplete. Run `shortcircuit package install` (without
`--frozen`) to restore it, or remove the store and reinstall from cache.

### A package compiles but its test fails

Run it directly to see the diagnostics:

```bash
shortcircuit package test
```

Check that the package source uses only the kernel `NAND` and its declared
dependencies, and that every test imports or instantiates the export correctly.

---

## Minimal checklist

- Scoped package name, for example `@acme/parity`.
- Separate export name, for example `PARITY3`.
- `manifest.json` with `schema`, `name`, `version`, and `exports`.
- Source files with matching `MACRO` or `CIRCUIT` declarations.
- Docs and tests.
- `shortcircuit package check` passes.
- `shortcircuit package register --dry-run` passes.
- Registry dependencies instead of path dependencies for publication.
