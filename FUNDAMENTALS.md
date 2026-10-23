# Fundamentals

**Status:** proposal for review  
**Scope:** LogicFlow kernel, package model, and the v1 language cut

This document defines what Short Circuit keeps in the app, what moves into packages, and why. The goal is a small, defensible core that can grow through packages instead of accumulating special cases.

---

## 1. The fundamental test

A feature is **fundamental** only if the compiler or simulator must know about it natively.

> If a component can be expressed as a circuit using things that are already fundamental, it is a package component, not a builtin.

This is about implementation, not importance. `AND` is important, but it can be made from `NAND`, so it belongs in a package. `NAND` cannot be made from anything else in the kernel, so it stays.

The same test applies to language features:

- If it is just a shorter way to write existing circuit structure, it is optional syntax.
- If it is only useful for generating code, it is metaprogramming, not a circuit fundamental.
- If it exists only because it is convenient, it can wait until users ask for it.

---

## 2. Why NAND

### 2.1 NAND is functionally complete

A two-input NAND has this truth table:

| a | b | NAND(a, b) |
|---|---|---|
| 0 | 0 | 1 |
| 0 | 1 | 1 |
| 1 | 0 | 1 |
| 1 | 1 | 0 |

Every Boolean function can be built from NAND:

```text
NOT(x)     = NAND(x, x)
AND(a, b)  = NOT(NAND(a, b))
OR(a, b)   = NAND(NOT(a), NOT(b))
XOR(a, b)  = NAND(NAND(a, NAND(a, b)), NAND(b, NAND(a, b)))
```

That means `AND`, `OR`, `NOT`, `XOR`, `NOR`, `XNOR`, `MUX`, adders, comparators, and everything else can be package content.

### 2.2 One axiom, not two

NAND and NOR are both universal. Keeping both as primitives is redundant: either one can define the other. We must choose one native gate, or we have no smallest instruction set at all.

We choose **NAND** because:

- it is the conventional universal gate in digital logic teaching;
- `NOT` is trivial: `NAND(x, x)`;
- CMOS NAND is a natural hardware reference;
- the formulas for the other gates are compact;
- it gives the simulator one Boolean operation to implement.

If the team ever prefers NOR, the architecture does not change. We swap the single primitive and rewrite the package formulas. What we must not do is keep both and call them both fundamental.

### 2.3 What “NAND” means in the kernel

The semantic primitive is a **two-input NAND**.

The kernel may expose `NAND` as variadic and bitwise for convenience:

```logicflow
y = NAND(a, b)          // two inputs
y = NAND(a, b, c)       // NOT(AND(a, b, c))
y = NAND(a_bus, b_bus)  // bitwise across a common width
```

These are lowering conveniences, not new gates. They can be desugared into a network of two-input NANDs. The simulator may evaluate the wider form directly for performance, but the language meaning remains NAND. The kernel computes the variadic reduction itself; it does not call the package `AND` macro.

This matters because it keeps the principle intact: the instruction set has one gate, not four variations of it.

### 2.4 Why `AND`, `OR`, and `NOT` are not fundamental

They are derived. Keeping them in the kernel would mean:

- maintaining a second definition alongside the package definition;
- adding a new builtin every time a common gate is requested;
- making the simulator and IR larger than the circuit model requires;
- making the package system less meaningful;
- creating two sources of truth for docs and autocomplete.

They belong in the `gates` package.

### 2.5 The cost we accept

A NAND-only compiler produces more nodes than a word-level simulator.

For example, an 8-bit ripple-carry adder becomes a few hundred NAND nodes rather than a few `ADD` nodes. That is acceptable for a teaching and circuit-inspection app if we handle it properly:

- keep a reasonable node limit;
- attach provenance to expanded nodes (`package`, `macro`, `instance`);
- let the graph group NANDs under the original `AND`/`HALF_ADDER` block;
- move large arithmetic to fixed-width optimized package circuits;
- add native fast paths later only as optimizations, never as hidden semantics.

The graph can show an `AND` block while the simulator sees NANDs. The IR stays honest; the UI stays readable.

---

## 3. The fundamental set

### 3.1 Circuit fundamentals

| Fundamental | Form | Why it stays |
|---|---|---|
| NAND | Native gate | The single universal Boolean operation. |
| Constants | `0`, `1`, binary/hex literals | Values must exist before gates can use them. |
| Wires | Named assignments | A circuit is a graph of named connections. |
| Ports | `INPUT`, `OUTPUT` | The boundary of a circuit. |
| Buses and wiring | `BUS(n)`, indexing, slices, `CONCAT`, `BROADCAST` | Structural bit movement, not Boolean logic. NAND cannot create, rearrange, or repeat wires. |
| Composition | `CIRCUIT`, instance calls, output bundles | A circuit-based app must be able to put circuits inside circuits. |
| State | `STATE`, initial values | Storage is a runtime primitive. |
| Clock edges | `ON RISING_EDGE`, `ON FALLING_EDGE` | Sequential behavior needs an edge contract. |

`BROADCAST(bit, value)` is the structural exception that makes bus-wide selection possible: it repeats a one-bit control to the width of `value`. It is wiring, not a Boolean gate. Without it, a package `MUX` on an 8-bit bus would need an eight-way hand-written control expansion.

### 3.2 Tooling fundamentals

These are not circuit gates, but the app cannot work without them:

- parser and analyzer;
- NAND-level IR;
- simulator;
- test runner and truth tables;
- import/package resolver;
- manifest validation and cache;
- editor, graph, simulator panel, and docs renderer.

### 3.3 Why `STATE` stays

`STATE` is not a gate. It is the storage axiom.

A latch can be built from NAND with feedback, but feedback is a separate semantic capability. The current language deliberately forbids combinational loops. Adding feedback would require a fixed-point solver, oscillation rules, and a different simulation model. That is a much larger change than keeping an explicit state primitive.

For v1:

- `STATE` is fundamental;
- latches, flip-flops, and registers can be package circuits built on `STATE`;
- if feedback becomes a requested feature, it can become the fundamental and `STATE` can be reconsidered.

This is a deliberate trade-off, not an oversight.

### 3.4 Why `TEST` stays

`TEST`, `CASE`, and `EXPECT` are verification syntax, not circuit description. They do not add runtime operations or special cases to the simulator. They let packages prove that their NAND expansions behave correctly.

We keep them. If the product later needs an even smaller surface, tests can move to a separate verification mode without changing the circuit language.

---

## 4. What stays in the app

### 4.1 Engine

- lexer, parser, AST;
- name and width analysis;
- package import resolution;
- macro expansion;
- NAND lowering;
- IR schema and validation;
- simulator;
- test runner;
- truth tables;
- formatter;
- diagnostics.

### 4.2 Core operations

Only these remain hardcoded:

- `NAND`
- structural wiring operations such as `CONCAT`, `SLICE`, indexing, `BROADCAST`, and width fitting
- `STATE` and clock-edge semantics

No `AND`, `OR`, `NOT`, `XOR`, `ADD`, `MUX`, `HALF_ADDER`, or similar builtins.

### 4.3 Frontend

- editor and completions host;
- hover host;
- graph and simulator;
- docs shell;
- circuit picker;
- package manager that edits source imports;
- project settings and cache.

The frontend must not contain a hardcoded gate list. It renders whatever the core catalog and imported packages provide.

### 4.4 Core documentation

- language syntax;
- `NAND`;
- wiring, buses, widths, slicing, concatenation, and broadcast;
- `STATE` and clocks;
- imports and packages;
- diagnostics.

Everything else is package documentation.

---

## 5. What moves to packages

| Package | Contents |
|---|---|
| `gates` | `NOT`, `AND`, `OR`, `BUFFER`, `NOR`, `XOR`, `XNOR` |
| `arithmetic` | `HALF_ADDER`, `FULL_ADDER`, fixed-width adders, subtractors, comparators |
| `selection` | `MUX`, decoders, encoders |
| `sequential` | D flip-flop, latch, register, counters |
| `display` | Seven-segment decoder and drivers |
| `examples` | Larger example circuits and teaching projects |

For the current default list:

| Component | Destination |
|---|---|
| `NAND` | Core |
| `AND`, `OR`, `NOT`, `BUFFER` | `gates` package |
| `NOR` | `gates` package |
| `XOR`, `XNOR` | `gates` package |
| `HALF_ADDER`, `FULL_ADDER` | `arithmetic` package |

The docs page’s “Basic Logic Gates”, “Universal Logic Gates”, “Exclusive Gates”, and “Arithmetic Circuits” groups come from core metadata plus package manifests. They are no longer hardcoded in `DocsPage.tsx`.

---

## 6. What to remove from the language now

The project manager wants focus on the core. These features are not needed for the first package-based release.

| Feature | Decision | Reason |
|---|---|---|
| `FOR ... END` | Remove | It is compile-time metaprogramming, not circuit structure. It increases parser, analyzer, diagnostics, docs, and trust surface. |
| `CONST` | Remove | Compile-time naming sugar. Literals and package-owned definitions are enough for v1. |
| Circuit parameters | Remove | User-facing generics are not needed for a circuit-first app. Ship fixed-width packages first. |
| `IF` / `ELSE` in `ON` blocks | Remove | Conditional next-state logic is a MUX. The `MUX` package can express it as a circuit. |
| `WHEN`, `SELECT` | Remove | They are reserved but unused. Do not reserve syntax for features that do not exist. |
| Gate builtins except `NAND` | Remove | Derived gates belong in the `gates` package. |
| Arithmetic builtins | Remove | Adders and arithmetic belong in the `arithmetic` package. |
| `MUX`, decoder, encoder | Remove | Build them from NAND/gates in packages. |
| Shift builtins | Remove | Constant shifts can be expressed with `CONCAT`/`SLICE`; variable shifts are package circuits. |
| `INTRINSIC_CIRCUITS` | Remove | `HALF_ADDER` and `FULL_ADDER` become package circuits. |
| Hardcoded example catalog | Move | Only a small onboarding example stays in the app. |
| Loop/parameter snippets | Remove | They document features that no longer exist. |

### 6.1 Why remove `FOR` and `CONST`

They are programming constructs, not circuit constructs.

A circuit app should show the structure the user built. A loop hides that structure behind compile-time expansion. It also creates new failure modes: loop limits, expansion limits, constant evaluation, and generated names.

If users later ask for repetition, we can add it deliberately, with a clear design. Until then, packages can ship fixed-width circuits such as `Add4`, `Add8`, and `Add16`.

### 6.2 Why remove circuit parameters

Generics are useful, but they are not needed to prove the package architecture.

Without user generics:

- packages ship concrete widths;
- the compiler is simpler;
- docs are simpler;
- package behavior is easier to test and reason about;
- width specialization can be added later if users demand it.

Gate macros remain width-polymorphic because they expand over NAND and the existing width rules. That is not user-facing generics.

### 6.3 Why remove `IF`

A conditional state update is a multiplexer:

```logicflow
next = MUX(q, d, enable)

ON RISING_EDGE(clock):
  q = next
END
```

`MUX` is package content. This makes the circuit structure explicit and removes a control-flow construct from the language.

### 6.4 What stays

Keep:

- `CIRCUIT` and `END`;
- `INPUT` and `OUTPUT`;
- `STATE`;
- `ON`, `RISING_EDGE`, `FALLING_EDGE`;
- `BUS`;
- assignments and instance calls;
- indexing, slices, `CONCAT`, and `BROADCAST`;
- literals and comments;
- `TEST`, `CASE`, `EXPECT`;
- `IMPORT`;
- `NAND`.

---

## 7. Package model

### 7.1 Repository layout

```text
ShortCircuit-Packages/
  registry.json

  packages/
    gates/
      package.json
      manifest.json        # catalog metadata; validated by CI
      macros/
        and/macro.lf       # implementation lives here
        or/macro.lf
        not/macro.lf
        xor/macro.lf
      docs/
        and.md
        or.md
        not.md
        xor.md
      tests/
        gates.test.lf

    arithmetic/
      package.json
      manifest.json
      circuits/
        half-adder/
          circuit.lf
          docs.md
          test.lf
        full-adder/
          circuit.lf
          docs.md
          test.lf
        add8/
          circuit.lf
          docs.md
          test.lf
```

One package per domain. One folder per circuit inside a package. The manifest is generated from the package contents.

### 7.2 Registry

The registry is a static JSON file. The app never scrapes GitHub folders or calls the GitHub directory API at runtime.

```json
{
  "schema": "shortcircuit.registry/v1",
  "packages": [
    {
      "name": "@shortcircuit/gates",
      "version": "1.0.0",
      "manifest": "packages/gates/manifest.json",
      "integrity": "sha256-..."
    },
    {
      "name": "@shortcircuit/arithmetic",
      "version": "1.0.0",
      "manifest": "packages/arithmetic/manifest.json",
      "integrity": "sha256-..."
    }
  ]
}
```

Host it on GitHub Pages or serve it through jsDelivr. Pin a tag or commit. A bundled snapshot ships with the app for offline first-run use.

### 7.3 Package manifest

The manifest is the app’s source of truth for docs, autocomplete, hover, grouping, examples, and source pointers. Signatures and arity are parsed from the macro source file. The manifest is validated by CI against package sources and tests.

```json
{
  "schema": "shortcircuit.package/v1",
  "name": "@shortcircuit/gates",
  "version": "1.0.0",
  "engine": "^0.3.0",
  "exports": [
    {
      "kind": "macro",
      "name": "AND",
      "source": "macros/and/macro.lf",
      "group": "Basic Logic Gates",
      "summary": "Bitwise AND.",
      "docs": "docs/and.md",
      "examples": ["y = AND(a, b)"]
    },
    {
      "kind": "circuit",
      "name": "HalfAdder",
      "group": "Arithmetic Circuits",
      "source": "circuits/half-adder/circuit.lf",
      "docs": "circuits/half-adder/docs.md",
      "tests": "circuits/half-adder/test.lf",
      "ports": {
        "inputs": [
          { "name": "a", "width": 1 },
          { "name": "b", "width": 1 }
        ],
        "outputs": [
          { "name": "sum", "width": 1 },
          { "name": "carry", "width": 1 }
        ]
      }
    }
  ]
}
```

The app can build the completions and docs index from manifests plus parsed macro declarations without fetching every circuit source. Source is fetched only when a package is imported or compiled.

`recommendedAutoImport` is legacy manifest metadata. It does not activate a package; every source needs an explicit `IMPORT` before a package export is available.

### 7.4 Macro source format

Macros are value-returning package declarations. They live in real `.lf` files,
next to circuits and docs. The manifest never contains a macro body; it points
at a source file and carries only catalog metadata.

`packages/gates/macros/and/macro.lf`:

```logicflow
MACRO AND(a, b, ...)
  BODY NOT(NAND(a, b, ...))
END
```

`packages/gates/macros/xor/macro.lf`:

```logicflow
MACRO XOR(a, b, ...)
  FOLD XOR2
END
```

Manifest entry:

```json
{
  "kind": "macro",
  "name": "AND",
  "source": "macros/and/macro.lf",
  "group": "Basic Logic Gates",
  "summary": "Bitwise AND.",
  "docs": "docs/and.md",
  "examples": ["y = AND(a, b)"]
}
```

The source is the single source of truth for the declaration name, parameters,
variadic tail, body, and fold target. The manifest is the single source of truth
for grouping, docs, examples, and whether a helper is internal. They are joined
by `name` and validated when a package is loaded.

Grammar:

```ebnf
macro-file  = { macro-decl } ;
macro-decl  = "MACRO" identifier "("
                [ param { "," param } [ "," "..." ] ]
              ")"
              ( "BODY" expression | "FOLD" identifier )
              "END" ;
param       = identifier ;
```

Rules:

- `BODY` is one expression in the normal LogicFlow expression grammar.
- `FOLD` names a binary macro used to reduce a variadic call from left to right. `XOR(a, b, c)` becomes `XOR2(XOR2(a, b), c)`.
- `...` is allowed only as the final parameter. The fixed parameters are the minimum arity; the folded parameters are the rest.
- Arguments are evaluated once as typed references, so referencing a parameter twice does not duplicate its source expression.
- A macro body cannot contain state, assignments, tests, modules, or imports. Use another macro for a helper step.
- The current format has no `let` binding. Duplicate a subexpression or name a helper macro instead. This keeps the format small and makes every expansion step visible.
- `internal: true` in the manifest hides a helper from docs and completions while allowing other package macros to reference it.
- A macro file may contain multiple declarations. The declaration named by the manifest is the public export; the other declarations are internal helpers.
- Macro files may contain line and block comments.
- The source file is embedded as `sourceText` in the offline bundle. It is never re-authored in the manifest.

The planned selection package uses the same format:

```logicflow
MACRO MUX(zero, one, select)
  BODY OR(AND(zero, NOT(BROADCAST(select, zero))), AND(one, BROADCAST(select, zero)))
END
```

### 7.5 Circuit format

Composite circuits are ordinary LogicFlow source files.

`circuits/half-adder/circuit.lf`:

```logicflow
CIRCUIT HalfAdder
  INPUT a
  INPUT b

  sum = XOR(a, b)
  carry = AND(a, b)

  OUTPUT sum
  OUTPUT carry
END
```

Manifest entry:

```json
{
  "kind": "circuit",
  "name": "HalfAdder",
  "group": "Arithmetic Circuits",
  "source": "circuits/half-adder/circuit.lf",
  "docs": "circuits/half-adder/docs.md",
  "tests": "circuits/half-adder/test.lf",
  "ports": {
    "inputs": [
      { "name": "a", "width": 1 },
      { "name": "b", "width": 1 }
    ],
    "outputs": [
      { "name": "sum", "width": 1 },
      { "name": "carry", "width": 1 }
    ]
  }
}
```

Package source may use only fundamentals and imports. A package cannot define new simulator opcodes.

The `arithmetic` package declares `@shortcircuit/gates` as a dependency, so its circuits can use `XOR`, `AND`, `MUX`, and the other gate macros without redefining them.

### 7.6 Docs and autocomplete

The package owns its documentation and editor metadata.

- `docs` points to the long-form Markdown page.
- `signature`, `summary`, `group`, and `examples` drive completions and hover.
- `ports` drives circuit completion details.
- CI checks that every export has docs and tests.
- The app sanitizes Markdown before rendering.
- The docs page merges:
  - core docs for `NAND`, wiring, buses, state, and imports;
  - imported package docs for gates, arithmetic, and other components.

No gate-specific docs or completion entries are hardcoded in the web app.

### 7.7 Versioning and trust

- Packages use semver.
- `engine` declares the compatible compiler range.
- The registry pins versions and integrity hashes.
- A project lockfile records exact versions and checksums.
- Packages may depend on other packages; cycles are errors.
- The app caches manifests and sources locally.
- Offline mode uses the bundled snapshot.
- Packages are source/JSON/Markdown only. No package JavaScript.
- Expansion limits protect against enormous or malicious circuits.

---

## 8. Importing and using packages

### 8.1 Bundled packages

The app bundles packages for first-run usability:

- `@shortcircuit/gates`
- `@shortcircuit/arithmetic` (initially half adder and full adder)

Bundled packages are installed, but they are not active until the source imports them:

```logicflow
IMPORT "@shortcircuit/arithmetic"

CIRCUIT Main
  INPUT a
  INPUT b
  OUTPUT sum
  OUTPUT carry

  h = HalfAdder(a, b)

  OUTPUT h.sum
  OUTPUT h.carry
END
```

This is still package-provided. It is not hardcoded.

### 8.2 Explicit import

Every package needs an explicit import. An alias gives qualified names:

```logicflow
IMPORT "@shortcircuit/gates" AS Gates
IMPORT "@shortcircuit/arithmetic" AS Arith
```

Use qualified names:

```logicflow
CIRCUIT Main
  INPUT a
  INPUT b
  OUTPUT y

  y = Gates.AND(a, b)
END
```

```logicflow
CIRCUIT AddCells
  INPUT a
  INPUT b
  OUTPUT sum
  OUTPUT carry

  h = Arith.HalfAdder(a, b)

  OUTPUT h.sum
  OUTPUT h.carry
END
```

Import rules:

- `IMPORT` appears at the top level, before circuits.
- The package alias must be unique.
- `IMPORT "pkg"` without an alias imports exports unqualified.
- `IMPORT "pkg" AS Alias` requires qualified use.
- Unqualified exports collide with local circuits or other imports are a compile error.
- Relative file imports are not part of v1.
- Circular package dependencies are errors.
- A missing or incompatible package is a compile error with an actionable message.
- Imported packages plus their declared dependencies load internally, but dependencies do not expose exports to user code.

Version pinning can be added to the import later:

```logicflow
IMPORT "@shortcircuit/arithmetic@1.0.0" AS Arith
```

For v1, the project lockfile is the authoritative version record.

### 8.3 Gate use

Because gates are macros, they behave like expressions:

```logicflow
IMPORT "@shortcircuit/gates"

CIRCUIT Blink
  INPUT a
  INPUT b
  OUTPUT y

  y = XOR(AND(a, b), NOT(a))
END
```

After expansion, this is only NAND nodes.

### 8.4 Sequential use

A register package can use `STATE` and `MUX` without `IF`:

```logicflow
IMPORT "@shortcircuit/selection"

CIRCUIT Register8
  INPUT d : BUS(8)
  INPUT clock
  INPUT enable

  STATE q : BUS(8) = 0

  next = MUX(q, d, enable)

  ON RISING_EDGE(clock):
    q = next
  END

  OUTPUT q
END
```

`MUX` is package-provided. The `ON` block is an unconditional next-state assignment.

### 8.5 Imports in the editor

The package manager edits the source `IMPORT` lines. Checking a package adds an
import; unchecking removes it. The source remains the single source of truth,
so the same source behaves the same in the studio, CLI, and engine API.

When a package is not imported:

- its exports are absent from completions and hover cards;
- its circuits cannot be instantiated;
- using one of its names produces a clear diagnostic;
- core `NAND` and structural operations remain available.

Imports are file-level in v1. Per-export opt-in can be added later.

---

## 9. Compilation flow

```text
source
  → lex/parse
  → resolve imports
  → load package manifests
  → expand macros
  → elaborate circuit instances
  → lower to NAND / structural IR
  → simulate / test / render
```

Details:

1. The parser accepts only core syntax plus `IMPORT`.
2. The resolver builds the package graph from the registry and project lock.
3. The macro expander evaluates gate expressions against typed refs.
4. Circuit packages are elaborated like user circuits.
5. All derived operations become NAND and structural nodes.
6. Each expanded node keeps provenance:
   - package name and version;
   - macro or circuit name;
   - source instance path.
7. The graph can group NANDs by provenance.
8. The simulator evaluates NAND, structural operations, and state/clock behavior.

The IR remains the contract. Every view consumes the lowered IR, not package source.

---

## 10. Migration plan

### 10.1 File-level impact

| File | Action |
|---|---|
| `packages/engine/src/parser.ts` | Remove `FOR`, `CONST`, parameter lists, and `IF`/`ELSE`. Add `IMPORT`. |
| `packages/engine/src/analyzer.ts` | Remove gate/arithmetic builtins and intrinsic circuits. Add package resolution, macro expansion, and NAND lowering. |
| `packages/engine/src/builtins.ts` | Reduce to `NAND` plus structural wiring operations. Rename to a kernel registry if useful. |
| `packages/engine/src/simulator.ts` | Evaluate NAND, structural operations, and state/clock behavior only. |
| `packages/engine/src/types.ts` | Bump the language/IR schema and remove obsolete node kinds. |
| `packages/engine/src/snippets.ts` | Keep language-level snippets, remove removed features, move gate/circuit snippets to packages. |
| `packages/engine/src/index.ts` | Stop exporting intrinsic circuits; export package/catalog types instead. |
| `apps/web/src/editor/completions.ts` | Build completions from core metadata plus the imported package catalog. |
| `apps/web/src/editor/hover.ts` | Resolve hover cards through the catalog, not hardcoded gate arrays. |
| `apps/web/src/editor/logicFlowLanguage.ts` | Remove hardcoded `HALF_ADDER`/`FULL_ADDER` and other package names. |
| `apps/web/src/editor/logicFlowHighlight.ts` | Highlight core syntax; package names can be added from loaded manifests later. |
| `apps/web/src/pages/DocsPage.tsx` | Generate default groups from the catalog. Remove `DEFAULT_COMPONENTS`. |
| `scripts/reference.mts` | Generate core reference from the kernel registry and package reference from manifests. |
| `apps/web/src/lib/examples.ts` | Keep a small starter example; move the rest to package examples. |
| `docs/LANGUAGE.md` | Remove `FOR`, `CONST`, parameters, and `IF`; document NAND and imports. |
| `docs/ARCHITECTURE.md` | Replace the “no standard library” limitation with the package architecture. |
| `docs/feature-spec.md` | Mark removed metaprogramming features and align the roadmap with this document. |
| `packages/engine/test/engine.test.ts` | Move intrinsic/gate tests to package tests; keep NAND, wiring, state, and loader tests. |
| `apps/web/src/test/DocsPage.test.tsx` | Test catalog-rendered docs instead of importing intrinsic circuit arrays. |

### Stage 1: Cut the kernel

- Make `NAND` the only Boolean operation in the engine.
- Remove all gate, arithmetic, selection, and intrinsic builtins.
- Remove `FOR`, `CONST`, circuit parameters, and `IF`/`ELSE`.
- Remove unused `WHEN`/`SELECT`.
- Keep wiring, buses, `STATE`, clocks, tests, and imports.
- Bump the language and IR schema versions.

### Stage 2: Add the package runtime

- Define registry, package, and manifest schemas.
- Add package resolution, caching, integrity checks, and offline snapshot support.
- Add macro expansion with width inference and expansion limits.
- Add a catalog that merges core and package metadata.

### Stage 3: Build the `gates` package

- Define `NOT`, `AND`, `OR`, `BUFFER`, `NOR`, `XOR`, `XNOR`.
- Add docs, examples, and tests.
- Make completions, hover, highlighting, and docs catalog-driven.
- Remove hardcoded gate lists from the web app and docs generator.

### Stage 4: Build the `arithmetic` package

- Move `HALF_ADDER` and `FULL_ADDER` out of engine intrinsics.
- Add fixed-width adders such as `Add4`, `Add8`, and `Add16`.
- Move their docs, examples, and tests.
- Remove all intrinsic analyzer branches.

### Stage 5: Move the rest

- Move arithmetic, comparisons, muxes, decoders, encoders, and sequential packages.
- Move the example catalog.
- Add source imports for package activation.
- Keep a small offline starter example in the app.

### Stage 6: Clean up

- Remove `INTRINSIC_CIRCUITS`, `lookupIntrinsic`, `INTRINSIC_NAMES`, and `instantiateIntrinsic`.
- Remove removed-feature snippets, docs, parser branches, AST types, and tests.
- Update `README.md`, `docs/LANGUAGE.md`, `docs/ARCHITECTURE.md`, and `docs/feature-spec.md`.
- Add migration tests for packages and macro expansion.

---

## 11. Trade-offs and decisions

| Decision | Why | Cost |
|---|---|---|
| NAND as the only gate | Smallest honest instruction set | More IR nodes, graph noise |
| Bitwise/variadic NAND | Avoids loops in package gates and keeps bus gates usable | Slight semantic sugar in the kernel |
| `STATE` stays | Storage is a runtime primitive; feedback is out of scope | Latches are packages on top of `STATE`, not pure NAND |
| Remove `FOR`/`CONST` | Circuit structure should be explicit | Large designs need packages or manual repetition |
| Remove user generics | Simpler v1; fixed-width packages are enough | Add generics only when users demand them |
| Remove `IF` | Conditional update is a MUX | Slightly more verbose sequential code |
| Keep tests | Packages need proof; tests do not affect runtime semantics | More tooling surface |
| Package macros | Gates need expressions, width inference, and variadic behavior | New macro expander to maintain |
| Package output is source + manifest | Docs/autocomplete can load cheaply | CI must generate and validate manifests |
| Default packages bundled | Works offline and preserves the default gate list | App release size grows slightly |

### Things we explicitly reject

- Keeping `AND`, `OR`, and `NOT` as builtins “because they are common.”
- Keeping both NAND and NOR as primitives.
- Arbitrary JavaScript packages.
- Scraping GitHub folders at runtime.
- Hardcoded docs or autocomplete lists for package components.
- Adding generics or loops before users ask.
- Hiding native optimizations behind package-looking semantics.

---

## 12. Deferred until demand

These are deliberately not in v1:

- `FOR` and `CONST`;
- user-defined circuit parameters and generic widths;
- feedback loops and NAND-only latches;
- variable shifts and barrel shifters as core;
- arbitrary file imports;
- runtime package auto-updates;
- JavaScript or plugin packages;
- native word-level fast paths for arithmetic.

The package format and macro expander leave room for these later without changing the core principle.

---

## 13. Summary

- **Native gate:** NAND only.
- **Native wiring:** signals, constants, ports, buses, index/slice/concat, circuit composition.
- **Native storage:** `STATE` and clock edges.
- **Native tooling:** parser, analyzer, NAND IR, simulator, tests, package runtime, UI.
- **Packages:** every derived gate, every composite circuit, and all of their docs, examples, tests, and autocomplete metadata.
- **Language cut:** no `FOR`, `CONST`, user generics, or `IF`; add them back only if users need them.
- **Package contract:** static registry, versioned manifests, declarative macros, `.lf` circuit sources, docs, and tests.
- **Default experience:** bundle `gates` and `arithmetic`, and require an explicit `IMPORT` before their exports are available. The package manager edits those imports.

The one-sentence version:

> Keep NAND, wires, buses, state, the compiler, and the package loader. Everything else is a package.
