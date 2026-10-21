# Creating a Short Circuit package

This guide creates a real package from scratch, builds the bundled snapshot,
runs its tests, and uses it from a circuit.

The example package is `@acme/parity`. It exports one macro, `PARITY3(a, b, c)`,
and depends on the bundled `@shortcircuit/gates` package.

> Packages are source-first. Implementations live in `.lf` files. The manifest
> contains catalog metadata and source pointers only; it never contains a macro
> body or circuit body.

---

## 1. One-time setup

Clone the main repository with its package submodule:

```bash
git clone --recurse-submodules https://github.com/samTime101/ShortCircuit.git
cd ShortCircuit
npm ci
```

If the repository is already cloned, initialize the submodule once:

```bash
git submodule update --init --recursive
```

The package repository lives at:

```text
vendor/ShortCircuit-Packages/
```

Check that the bundle builds before making changes:

```bash
cd vendor/ShortCircuit-Packages
node scripts/build.mjs
```

You should see:

```text
Wrote dist/packages.json (3 packages)
```

---

## 2. Create the package directory

From `vendor/ShortCircuit-Packages`:

```bash
cd vendor/ShortCircuit-Packages

mkdir -p packages/parity/macros/parity3
mkdir -p packages/parity/docs
mkdir -p packages/parity/tests
```

The layout is:

```text
packages/parity/
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

A package can also contain ordinary circuits under `circuits/<name>/`.

---

## 3. Create `package.json`

`package.json` is Node package metadata. Its `name` and `version` must match
`manifest.json`; the build script checks this.

Create `packages/parity/package.json`:

```json
{
  "name": "@acme/parity",
  "version": "0.1.0",
  "description": "Three-input parity built from the Short Circuit gates package.",
  "license": "MIT",
  "dependencies": {
    "@shortcircuit/gates": "^0.1.0"
  }
}
```

If your package uses another package's exports, declare that dependency in both
`package.json` and `manifest.json`.

---

## 4. Create the macro source

Create `packages/parity/macros/parity3/macro.lf`:

```logicflow
MACRO PARITY3(a, b, c)
  BODY XOR(a, b, c)
END
```

`XOR` is provided by `@shortcircuit/gates`. A package macro can use the kernel
`NAND` operation, structural operations, and exports from packages it depends
on.

The macro source is the implementation. Do not copy the body into the
manifest.

---

## 5. Create the manifest

Create `packages/parity/manifest.json`:

```json
{
  "schema": "shortcircuit.package/v1",
  "name": "@acme/parity",
  "version": "0.1.0",
  "engine": "^0.1.0",
  "recommendedAutoImport": true,
  "description": "Three-input parity built from NAND-derived gates.",
  "dependencies": {
    "@shortcircuit/gates": "^0.1.0"
  },
  "tests": "tests/parity.test.lf",
  "exports": [
    {
      "kind": "macro",
      "name": "PARITY3",
      "source": "macros/parity3/macro.lf",
      "group": "Parity",
      "summary": "One when an odd number of inputs are high.",
      "docs": "docs/parity3.md",
      "examples": [
        "y = PARITY3(a, b, c)"
      ],
      "widthRule": "Result width = common input width"
    }
  ]
}
```

Important fields:

| Field | Meaning |
| --- | --- |
| `name`, `version` | Must match `package.json`. |
| `engine` | Compatible engine version. |
| `recommendedAutoImport` | `true` makes the package available without an explicit `IMPORT` in the bundled app. |
| `dependencies` | Package names whose exports this package may use. |
| `tests` | Package-wide tests. Per-circuit tests can also use an export's `tests` field. |
| `exports` | Public macros and circuits. Each entry points at a real source file. |
| `internal` | Optional; hides an export from docs and completions while keeping it usable by other package sources. |
| `ports` | Optional catalog metadata for circuit exports. The compiler still reads the real ports from the circuit source. |

For a circuit export, use `"kind": "circuit"` and point `source` at a normal
`.lf` file containing `CIRCUIT <name>`.

---

## 6. Add docs

Create `packages/parity/docs/parity3.md`:

````markdown
# PARITY3

`PARITY3(a, b, c)` returns one when an odd number of its three inputs are high.

- `a`, `b`, `c`: one-bit or bus inputs of the same width.
- Result: the common input width.

```logicflow
y = PARITY3(a, b, c)
```
````

Package docs are embedded into the bundled snapshot and can be shown by a host.

---

## 7. Add package tests

Create `packages/parity/tests/parity.test.lf`:

```logicflow
CIRCUIT PARITY3_TEST
  INPUT a
  INPUT b
  INPUT c

  y = PARITY3(a, b, c)

  OUTPUT y
END

TEST PARITY3_TEST
  CASE "no inputs high"
    INPUT a = 0
    INPUT b = 0
    INPUT c = 0
    EXPECT y = 0
  END

  CASE "one input high"
    INPUT a = 1
    INPUT b = 0
    INPUT c = 0
    EXPECT y = 1
  END

  CASE "two inputs high"
    INPUT a = 1
    INPUT b = 1
    INPUT c = 0
    EXPECT y = 0
  END

  CASE "three inputs high"
    INPUT a = 1
    INPUT b = 1
    INPUT c = 1
    EXPECT y = 1
  END
END
```

The test wrapper circuit is test-only. It must not redefine a public export.
Package tests run through the same compiler and simulator as user tests.

---

## 8. Register the package

Add the package to `vendor/ShortCircuit-Packages/registry.json`:

```json
{
  "name": "@acme/parity",
  "version": "0.1.0",
  "manifest": "packages/parity/manifest.json"
}
```

The full file should now look like:

```json
{
  "schema": "shortcircuit.registry/v1",
  "packages": [
    {
      "name": "@shortcircuit/gates",
      "version": "0.1.0",
      "manifest": "packages/gates/manifest.json"
    },
    {
      "name": "@shortcircuit/arithmetic",
      "version": "0.1.0",
      "manifest": "packages/arithmetic/manifest.json"
    },
    {
      "name": "@shortcircuit/selection",
      "version": "0.1.0",
      "manifest": "packages/selection/manifest.json"
    },
    {
      "name": "@acme/parity",
      "version": "0.1.0",
      "manifest": "packages/parity/manifest.json"
    }
  ]
}
```

The registry is static. Packages are not discovered by scanning directories or
calling GitHub.

---

## 9. Build and validate the bundle

From `vendor/ShortCircuit-Packages`:

```bash
node scripts/build.mjs
```

Expected output:

```text
Wrote dist/packages.json (4 packages)
```

The build script checks that:

- every manifest uses `shortcircuit.package/v1`;
- `package.json` and `manifest.json` names and versions agree;
- every export points at an existing source file;
- the source really declares the exported `MACRO` or `CIRCUIT`;
- macro manifests do not contain implementation fields such as `body`, `args`,
  `fold`, or `variadic`;
- docs and tests referenced by the manifest exist.

Do not edit `dist/packages.json` by hand. It is generated.

---

## 10. Run the package tests

Return to the main repository:

```bash
cd ../..
npx vitest run packages/engine/test/packages.test.ts
```

That test calls `runPackageTests()` against the bundled snapshot, so the new
package and all existing package tests run together.

To run the whole project:

```bash
npm test
npm run typecheck
npm run build
```

You can also run package tests directly from the engine API:

```ts
import { runPackageTests } from "@shortcircuit/engine";

const report = runPackageTests();
console.log(report.ok, report.passed, report.failed);
```

---

## 11. Use the package in a circuit

Because this example sets `recommendedAutoImport: true`, the export is available
without an import:

```logicflow
CIRCUIT Odd
  INPUT a
  INPUT b
  INPUT c

  y = PARITY3(a, b, c)

  OUTPUT y
END
```

An explicit import is also valid. Use an alias for qualified access:

```logicflow
IMPORT "@acme/parity" AS parity

CIRCUIT Odd
  INPUT a
  INPUT b
  INPUT c

  y = parity.PARITY3(a, b, c)

  OUTPUT y
END
```

If `recommendedAutoImport` is `false`, the explicit import is required.

Missing or disabled packages report `E602`. Reusing an alias for two packages
reports `E603`.

---

## 12. Commit the package and submodule pointer

Commit the package repository first:

```bash
git -C vendor/ShortCircuit-Packages add -A
git -C vendor/ShortCircuit-Packages commit -m "feat: add parity package"
git -C vendor/ShortCircuit-Packages push origin main
```

Then commit the updated submodule pointer in the main repository:

```bash
git add vendor/ShortCircuit-Packages
git commit -m "chore: update package submodule"
git push origin main
```

The main repository must point at the package commit that contains the built
`dist/packages.json`; otherwise CI and Vercel cannot compile the engine.

---

## 13. Using a custom package outside the registry

The studio package manager lists packages from the bundled snapshot. A host can
load a different bundle through the compiler API:

```ts
import { compile, type PackageBundle } from "@shortcircuit/engine";

const bundle: PackageBundle = {
  schema: "shortcircuit.packages/v1",
  packages: [
    // Manifests with sourceText/docsText/testText embedded, like dist/packages.json.
  ],
};

const result = compile(source, {
  packages: bundle,
  disableDefaultPackages: false,
});
```

Use `disableDefaultPackages: true` when you want only the supplied bundle.
`packages` accepts either a full `PackageBundle` or an array of manifests.

---

## 14. Troubleshooting

### `Cannot find module '../../../vendor/ShortCircuit-Packages/dist/packages.json'`

The submodule is missing. Run:

```bash
git submodule update --init --recursive
```

or clone with `--recurse-submodules`.

### `package validation failed: ... is not declared in ...`

The exported name in `manifest.json` does not match the `MACRO` or `CIRCUIT`
declaration in the source file. Names must match exactly.

### `package validation failed: ... does not match package.json ...`

The `name` or `version` fields differ between `package.json` and
`manifest.json`.

### `E601` or a duplicate export error

Export names must be unique across the enabled catalog. Two packages cannot
export the same macro name.

### `E602 Cannot import ...`

The package is not installed, disabled, or not enabled for the project. Enable
it in the studio **Packages** manager or add the correct `IMPORT`.

### `E200 ... is reserved`

Package macro and circuit export names are reserved while the package is
enabled. Rename the user circuit or signal, or disable the package.

### A package source compiles but the test wrapper does not

Package tests are compiled with imports for the package and its dependencies.
Check that the wrapper uses the correct exported name and that every dependency
is listed in both `package.json` and `manifest.json`.

---

## Minimal checklist

```text
[ ] Create packages/<name>/ with package.json and manifest.json
[ ] Put implementations in .lf files
[ ] Point every export at its source
[ ] Add docs and tests
[ ] Add the manifest to registry.json
[ ] Run node scripts/build.mjs
[ ] Run npx vitest run packages/engine/test/packages.test.ts
[ ] Commit and push the package repository
[ ] Commit the updated submodule pointer in the main repository
```
