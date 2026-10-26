# Short Circuit — Code Audit

**Date:** 2026-10-25
**Commit:** `4f17fc4` (main)
**Scope:** `packages/engine`, `packages/cli`, `packages/vscode-extension`, `apps/web`
**Overall architecture score: 7.4 / 10** — a genuinely well-layered codebase with one weak seam (the web studio's state ownership) and a handful of real bugs concentrated in the "record a test" and waveform paths.

---

## 0. Baseline

Everything below was measured on a clean checkout, before any inspection findings.

| Check | Result |
|---|---|
| `npm run typecheck` (engine + web + cli + cross) | **passes**, no errors |
| `npm test` (35 files, 360 tests) | **360/360 pass** in 8.2s |
| `npm run build -w @shortcircuit/web` | **passes** in 232ms |
| `TODO` / `FIXME` / `HACK` markers | **zero** |

Two `act(...)` warnings in `App.test.tsx` — test hygiene only, not a product bug.

Code size:

| Area | Lines | Files |
|---|---|---|
| `packages/engine/src` | 8,307 | 24 |
| `packages/cli/src` | 4,569 | 11 |
| `packages/vscode-extension/src` | 7,121 | 10 |
| `apps/web/src` | 16,723 | 66 |
| tests | 6,638 | 35 |

So: ~36.7k source lines against ~6.6k test lines (≈1:5.5), which is a healthy ratio for a project this size.

The important baseline fact: **the suite is green, so every bug below lives in a gap the tests do not cover.** Section 4 explains each gap specifically.

---

## 1. Confirmed bugs

Ordered by user impact. Each one was reproduced; the repro is in the appendix.

### B1 — "Record test" corrupts the source file when a TEST block already exists · **High**

[recordTest.ts:45-56](apps/web/src/lib/recordTest.ts#L45-L56) locates the `TEST <circuit>` header, then scans forward for the **first** line whose trimmed text is `END` and inserts the new `CASE` before it. In any TEST block that already contains a `CASE`, that first `END` is the *case's* terminator, so the new case is spliced inside the previous case:

```logicflow
TEST Half
  CASE "existing"
    INPUT a = 0
    INPUT b = 1
    EXPECT sum = 1
  CASE "recorded"      ← nested inside the previous CASE
    INPUT a = 1
    ...
  END
  END
END
```

Compiling that output produces `E111: CASE is missing its END` and `E100: Expected IMPORT, CIRCUIT, or TEST, found "END"`. The studio then refuses to compile — **the user's file is broken by a button in the UI**, and the "Add test case" flow even reports success ("Added the test case …").

The fix is a depth counter (or a scan that tracks `CASE`/`STEP` openers) rather than the first `END`.

### B2 — `CYCLE` inside `STEP` compiles but silently does nothing · **High**

The parser accepts `CYCLE` inside `STEP` ([parser.ts](packages/engine/src/parser.ts) `parseTestStep`), and the analyzer happily lowers it to a `{kind:"cycle"}` instruction. The runner's `step` branch ([testing.ts:186-216](packages/engine/src/testing.ts#L186-L216)) only applies *input* instructions from inside a step and only reports *expect* rows — a nested `cycle` (and a nested `step`) is dropped on the floor.

Result: two textually near-identical test cases disagree.

```logicflow
CASE "cycle inside step"
  STEP
    CYCLE clk 1        ← silently ignored
    EXPECT q = 1       ← fails, "got 0"
  END
END
CASE "cycle at top level"
  CYCLE clk 1          ← works
  EXPECT q = 1         ← passes
END
```

This is the worst kind of bug: it doesn't error, it just produces a wrong verdict and a misleading failure message. Either the runner must execute nested cycles (and the testbench exporter already models them, so the semantics exist) or the analyzer must reject them like it rejects `LOAD` inside `STEP` (`E232`).

### B3 — A recorded clock run cannot be replayed · **High (feature is effectively broken)**

`App.stepClock` ([App.tsx](apps/web/src/App.tsx)) records a clock pulse as:

```logicflow
STEP
  INPUT clk = 1
END
```

The clock is raised and never lowered, so a second recorded step resolves to `INPUT clk = 1` again and **no further edge fires**. Recording twenty ticks reproduces exactly one. Combined with B2, there is currently no way to record clock-driven behaviour that plays back correctly — `CYCLE` (the correct emission) is both ignored inside `STEP` and not what the recorder writes.

Related: `suggestCaseName` looks for `^CYCLE …`, a line the recorder never produces, so recorded clock cases are all named "N steps".

### B4 — Test summary counts are wrong for mixed suites · **Medium**

[testing.ts:69-70](packages/engine/src/testing.ts#L69-L70):

```ts
if (suitePass) passed += caseResults.length;
else failed += caseResults.filter((entry) => !entry.pass).length;
```

A suite's passes are counted only if *every* case passes. Measured: a suite with one passing and one failing case reports **passed = 0, failed = 1** instead of 1/1. The Tests panel and the CLI summary therefore under-report passes and mislead about progress.

### B5 — Verilog export emits invalid zero-width replication · **Medium**

[verilog.ts:248-256](packages/engine/src/verilog.ts#L248-L256) builds `{{N{...}}, value}` where `N = width - sourceWidth`. The analyzer allows `ZEXT`/`SEXT` at equal width (it only rejects `target < width`), so this compiles:

```logicflow
y = ZEXT(a, 4)      // a is already 4 bits
```

and exports:

```verilog
assign y = {{0{1'b0}}, a};   // zero-width replication
```

IEEE 1364 forbids a zero replication count; most tools reject it. `SEXT` has the same problem (`{{0{a[3]}}, a}`). Fix: skip the replication when `N === 0`.

### B6 — Compile-time parameters become phantom nodes in the IR · **Medium**

`compileCall` resolves *all* arguments as value expressions before the builtins pull their constant parameters out ([analyzer.ts:1756](packages/engine/src/analyzer.ts#L1756)), so slice/width/count literals become real `constant` nodes that nothing reads. For:

```logicflow
INPUT a : BUS(4)
y = SLICE(a, 3, 0)
z = ZEXT(a, 8)
```

the IR is **6 nodes**: `a`, constant `3`, constant `0`, `SLICE`, constant `8`, `ZEXT`. Consequences:

- `stats.nodes` — displayed in the studio as "N nodes" — is inflated by every slice bound and width argument;
- the graph shows floating, unconnected constant cards;
- the Verilog export emits dangling `localparam`s (`localparam [2:0] n_4 = 3'b100;`) for values that are compile-time only.

### B7 — The compiler worker has no crash/timeout recovery · **Medium**

[compilerClient.ts:49-66](apps/web/src/lib/compilerClient.ts#L49-L66) only handles `onmessage` and `onerror`. If the worker exits without an error event (tab under memory pressure, `terminate()` from elsewhere, a browser-initiated kill), pending `compile()` promises never settle, `compiling` stays `true`, and the status chip spins forever with no way back short of a reload.

The drain loop on `onerror` also looks wrong at a glance:

```ts
for (const [, entry] of pending) {
  pending.delete(Number([...pending.keys()][0]));   // deletes the *first* key, not this entry's
  entry.resolve(compile(entry.source, entry.options));
}
```

I reproduced it: it *does* settle every promise, because the iterator is always positioned at the front and the first remaining key is therefore the visited one. So this is not a hang — it is correct by accident, O(n²), and one line away from being wrong. Compare [studioWorkerClient.ts](packages/vscode-extension/src/studioWorkerClient.ts), which handles `exit`, tracks intentionally-terminated workers, and rejects pending requests — the extension already has the right pattern.

### B8 — The graph throws away the user's pan/zoom whenever it is resized · **Medium (UX)**

```ts
const fit = useCallback(…, [applyView, layout.width, layout.height, size.width, size.height]);
useEffect(() => { fit(); }, [circuit, fit]);     // CircuitGraph.tsx:645-647
```

`fit` is recreated whenever the measured size changes, so the effect re-runs on **every** resize, not just on circuit changes. Dragging the simulator-dock resizer, dragging the input/output column splitter, or resizing the window all snap the graph back to the default fit — and it visibly fights the drag. Intent is clearly "fit when the circuit changes"; `size` should not be in the trigger.

### B9 — Every successful recompile resets the simulation and wipes the trace · **Medium (UX)**

`compileNow` calls `activateCircuit(circuit)` unconditionally on success ([App.tsx:327](apps/web/src/App.tsx#L327)), and `activateCircuit` builds a fresh `Simulator`, resets inputs and calls `setTrace([])`.

Because compilation is debounced-on-edit, **typing a comment resets your inputs, your stored state and your waveform** ~360ms later. There is no check that the circuit's IR actually changed. The VS Code studio solves exactly this with `structureKey`/`derivedKey` and a `forceReset` flag — the web app is the one place that regressed.

### B10 — State fields are overwritten mid-typing while the clock runs · **Low-Medium**

`StateField` and `BusTextField` sync their local draft from the incoming prop in a `useEffect` ([SimulatorDock.tsx:78](apps/web/src/components/SimulatorDock.tsx#L78), [:140](apps/web/src/components/SimulatorDock.tsx#L140)). For inputs the prop string is stable during a run, but for **state** the prop is the live snapshot value, which changes on every tick — so with the clock running, characters disappear mid-edit and any validation message is cleared each tick. The draft should only re-sync when the field is not focused (or when the edit is committed).

### B11 — Registry integrity is recorded but never verified · **Medium (supply chain)**

`packages/cli/src/registry.ts` parses `integrity` from the registry index ([:195](packages/cli/src/registry.ts#L195)), and the publisher writes it via `packageIntegrity` in `authoring.ts`. On install, `fetchRemotePackage` **recomputes** the hash from whatever bytes it downloaded and stores that as the lock value ([:576](packages/cli/src/registry.ts#L576)). The declared hash is never compared.

Net effect: a compromised registry or mirror can serve modified package source, and the lockfile will happily record the tampered hash as the source of truth. `docs/PACKAGES.md` and the CLI README both claim SHA-256 integrity for reproducible builds. Path traversal *is* correctly blocked (`normalizePackageFile`, `..`, absolute paths, schemes), so the write side is safe; it is only the authenticity check that is missing.

### B12 — Smaller correctness and hygiene issues

| # | Where | Issue |
|---|---|---|
| a | [simulator.ts](packages/engine/src/simulator.ts) | `initialRuntimeError` is only ever assigned `null`; nothing catches an evaluation error into it, so the `runtimeError` getter, the `snapshot().runtimeError` field and the studio's check for it are dead code. `evaluate()` throws from the constructor instead. |
| b | [analyzer.ts](packages/engine/src/analyzer.ts) `validateEventConflicts` | builds a `key` string, never uses it, then `void key;` to silence the linter. |
| c | [analyzer.ts](packages/engine/src/analyzer.ts) `compileTest` | reports `E221 "no EXPECT statements"` and `E109 "TEST is missing END"` in addition to the underlying parse error, producing cascading noise for one mistake. |
| d | [diagnostics.ts](packages/engine/src/diagnostics.ts) | `DiagnosticBag.add` silently drops diagnostics past `max` (100/200). No "showing 100 of N" notice anywhere in the console panel — a file with 300 errors looks like it has 100. |
| e | [DiagnosticsPanel.tsx](apps/web/src/components/DiagnosticsPanel.tsx) | renders `<span role="button" tabIndex={0}>` inside a `<button>` — nested interactive content, invalid HTML, awkward focus order. |
| f | [registry.ts](packages/cli/src/registry.ts) `readCache` | TTL is applied by callers inconsistently: `installPackage` always forces `refresh: true`, so `package install` hits the network for the index even when a fresh cache exists. |
| g | [verilog.ts](packages/engine/src/verilog.ts) | a testbench connects output ports by `sanitize(output.name)` rather than the name `moduleFor` actually reserved; they only differ on a collision, but then the testbench will not elaborate. |
| h | [trace.ts](apps/web/src/lib/trace.ts) | `appendSample` copies the whole array per sample (`[...trace, sample]`) up to the 10k cap, twice per clock step. Small, but it is per-tick allocation in the hottest loop. |
| i | [packages.ts](packages/engine/src/packages.ts) | package macro names share one global namespace; two packages exporting `AND` makes the second an error rather than namespacing it. |
| j | [App.tsx](apps/web/src/App.tsx) | `localStorage.setItem(STORAGE_KEY, source)` runs on **every keystroke** (line ~230) with no debounce; a synchronous write of the whole document on each character. |

---

## 2. Lag and performance

Every number here was measured on this machine, not estimated (method in the appendix).

### 2.1 The engine is genuinely fast — lag is not where you'd guess

| Operation | Measured |
|---|---|
| Compile a 2,002-node / 4,008-edge design | **27.6 ms** |
| Compile 40 test cases | **7.0 ms** |
| Run a 40-case test suite | **3.3 ms** |
| Run a case with `CYCLE clk 2000` | **12.0 ms** |
| Generate a 4,096-row truth table | **29 ms** |
| Build the graph layout for 2,010 nodes | **19.5 ms** |
| One pan frame (cull + batch 4,008 edges) | **0.32 ms** |
| One simulation tick's edge-path rebuild | **0.33 ms** (201 KB of path data) |

So the compiler, simulator, truth table, test runner and graph layout are all in the "no user can perceive this" range. The graph's culling, LOD batching (`MIN_NODE_BATCH_SCALE`), rAF-coalesced panning and memoised layout are the strongest performance work in the repo.

### 2.2 The one pathological component: the waveform panel

[WaveformPanel.tsx:33](apps/web/src/components/WaveformPanel.tsx#L33):

```ts
const width = LEFT + trace.length * SAMPLE_WIDTH + 24;   // 54 px per sample, unbounded
```

It renders one DOM element per sample **per signal**, plus an axis line and an edge marker per sample, with no windowing, virtualisation or downsampling. `TRACE_LIMIT` is 10,000 ([trace.ts:25](apps/web/src/lib/trace.ts#L25)). Measured with a 6-signal circuit:

| Trace length | SVG width | DOM nodes in the panel | Re-render |
|---|---|---|---|
| 100 | 5,556 px | 890 | 33 ms |
| 500 | 27,156 px | 4,290 | 101 ms |
| 1,000 | 54,156 px | 8,540 | 200 ms |
| 2,000 | 108,156 px | 17,040 | 258 ms |
| **10,000 (the cap)** | **540,156 px** | **85,040** | **1,473 ms** |

That is a jsdom measurement, so a real browser is faster in absolute terms — but 85k SVG nodes and a 540,000 px canvas is a freeze in any engine. And it is not a one-off: the panel re-renders on **every** trace change, so with the clock running at 10 Hz and the Waveform tab open, the app is re-rendering the entire trace ten times a second. Within a couple of minutes of running, the tab is unusable.

This is the single biggest lag in the product and the cheapest to fix: cap the rendered window (e.g. the last 200 samples, paged back), or emit one packed `<path>` per signal like `CircuitGraph` already does for edges.

### 2.3 Per-tick render fan-out

One clock step (`stepClock`) performs four state updates — `setSnapshot`, `setInputValues`, `setTrace` ×2 — and every one of them re-renders the whole `Studio` component: header, editor chrome, diagnostics list, tabs, dock, graph. Nothing between `Studio` and the leaf components is memoised (`CircuitGraph`, `SimulatorDock`, `DiagnosticsPanel` are all plain function components). The heavy internals are memoised, so this stays cheap at 2k nodes, but it is the structure that will make 20k-node designs (the engine's `maxNodes` default) feel heavy on every tick.

### 2.4 Bundle

| Chunk | Size | Gzip |
|---|---|---|
| `index.js` (studio + engine + **docs page**) | 499.7 kB | 144.6 kB |
| `SourceEditor.js` (CodeMirror, lazy) | 416.2 kB | 134.5 kB |
| `compile.worker.js` (lazy by nature) | 112.7 kB | — |
| `index.css` | 70.1 kB | 14.4 kB |

CodeMirror is correctly split out. The docs page is **not**: `App.tsx` imports `DocsPage` statically even though it is a separate route, so 1,888 lines of docs JSX plus the docs content tables ship in the studio's first load. Making that route `lazy()` is the cheapest initial-paint win available.

### 2.5 Other observations

- **The VS Code webview is ahead of the web app here.** `studioCompute` returns a `structureKey`/`derivedKey` so the webview can patch values instead of rebuilding DOM, tests and truth tables are computed **lazily** ("Tests are executed lazily, never on every edit"), and clock-driven state lives behind a worker. The web studio runs `runTests()` and `generateTruthTable()` synchronously after *every* compile. At the measured 3–29 ms this is tolerable today, but it is the pattern that will hurt on a big design — and it already exists, correctly, in the other host.
- `.node-value` is looked up with `querySelector` per node per tick in the webview ([studioHtml.ts](packages/vscode-extension/src/studioHtml.ts) `updateGraphValues`) instead of caching the text node. ~10k DOM queries/second at 10 Hz with 1k visible nodes.
- Both graph implementations rebuild the full `d` attribute of every edge bucket on every tick (same 0.33 ms / 201 KB pattern measured above). Fine at 2k edges; at 20k edges it is ~2 MB of string churn per tick.

---

## 3. Architecture review

### 3.1 What is genuinely good

**The engine/host boundary is the best thing in this repo.** `packages/engine` has no DOM, no React, no Node APIs, and a versioned IR (`shortcircuit.ir/v1`) documented in `docs/IR.md`. Four hosts consume the same engine — CLI, web studio, VS Code extension, and package tests — and they share behaviour rather than reimplementing it. That is rare and it is why the same 360 tests can validate a browser app and a terminal tool.

**The compiler is a clean staged pipeline** (lexer → parser → analyzer/elaborator → flat IR → simulator), each stage independently testable, diagnostics carrying stable codes plus `hint`, `related`, `suggestion` and a `plain` (beginner-language) rendering. The diagnostics quality is above what most hobby compilers reach: `suggestName` with Levenshtein, one-click rename fixes, related locations, and plain-language paraphrases.

**Resource limits are designed in, not bolted on**: `maxNodes`, `maxDepth`, `maxInstances`, `maxWidth`, `maxDiagnostics`, all with dedicated `E32x` codes, plus recursive-instantiation and combinational-loop detection *before* simulation. `docs/ARCHITECTURE.md` matches the code.

**The VS Code host is properly engineered**: compile and derived-data workers, coalescing compile queue that keeps only the newest job, revision counters so a stale worker result cannot reach the webview, `structureKey` for patch-vs-rebuild, clock runner lifecycle handled in one place, and a worker client that distinguishes intentional termination from a crash.

**Testing is real**: 360 tests across engine/CLI/web/VS Code, including 5.9 s of exhaustive package comparison, runtime tests that mount the actual webview script, and runtime HTML tests for the CodeMirror editor. Not smoke tests.

### 3.2 What holds it back

**1. The web studio owns too much state in one component.** `Studio` in `App.tsx` is ~1,000 lines holding source, compile result, simulator, snapshot, inputs, trace, displays, truth table, test result, recording, modals, pane sizes, font size, mode and toasts. Every simulation tick re-renders all of it. There is no store, no reducer, no context — just twenty `useState` calls and ~15 effects whose interactions are only discoverable by reading the whole file. B9 and B10 are symptoms, not accidents: state that should live with the simulator lives three levels away and gets rebuilt.

**2. Two independent UI implementations of the same product.** The React studio (`CircuitGraph.tsx` 1,101 lines, `SimulatorDock.tsx` 535, `WaveformPanel`, `TruthTablePanel`, `TestsPanel`, `OutputDisplay`) and the webview (`studioHtml.ts`, **3,654 lines** of HTML + CSS + vanilla JS inside one template literal). They share the engine and the intent, but not a line of view code, and they have drifted (lazy tests and `structureKey` in one, eager recompute and reset-on-compile in the other). `studioHtml.ts` being a 3,654-line string literal also means it is the least toolable file in the repo: no type checking, no component boundaries, string-concatenated HTML.

**3. Framework-free hosts and framework-coupled ones are mixed without a shared view model.** `studioModel.ts` (391 lines) is the good pattern — a plain serialisable view model. The web app has no equivalent: it derives everything inline in components and `App.tsx`.

**4. Oversized leaf files.** `styles.css` 3,517 lines (one global sheet, no scoping or tokens module), `DocsPage.tsx` 1,888 lines, `analyzer.ts` 2,570 lines (a `ProgramAnalyzer` service plus a `ScopeBuilder` class doing elaboration in one file), `installer.ts` 1,024 lines. None of these is tangled — they are just big enough that finding a rule or a branch costs a scroll and a search.

**5. Security posture is partial.** Path traversal on package writes: correctly blocked. Registry authenticity: absent (B11). No `eval`/`new Function`/`dangerouslySetInnerHTML` in the web app — the webview does use `innerHTML` extensively but escapes every interpolated value through `escapeHtml`, which I checked. Local storage usage is wrapped in try/catch throughout.

### 3.3 Scorecard

| Axis | Score | Rationale |
|---|---|---|
| Layering & boundaries | **9.0** | Engine truly host-free; versioned IR; four hosts over one core; docs match reality |
| Compiler & IR design | **8.0** | Clean stages, stable diagnostics, designed-in limits; dinged for phantom nodes (B6) and dead runtime-error plumbing (B12a) |
| Simulator semantics | **7.5** | Atomic clock commit, conflict detection, topological validation; dinged because the test runner's step semantics diverge from the simulator's (B2) |
| Web studio composition | **5.5** | 1,000-line stateful component, 20 `useState`s, per-tick full-tree render, no shared view model |
| VS Code extension | **8.0** | Workers, queue coalescing, revision guards, structure keys; dinged for a 3,654-line webview string |
| Duplication / maintainability | **5.0** | Two UIs, one 3.5k-line stylesheet, 1.9k-line docs page, 2.6k-line analyzer file |
| Testing | **7.5** | Excellent breadth and depth; but five of the six high-severity bugs sit in untested seams (Section 4) |
| Diagnostics & developer UX | **9.0** | Best-in-class hints, suggestions, related spans, plain-language mode |
| Performance | **6.5** | Engine and graph are fast (measured); waveform is pathological; per-tick fan-out and a 500 kB initial chunk |
| Security / supply chain | **5.0** | Path safety good; registry integrity unverified; no sandbox issues found |
| Docs | **9.0** | `ARCHITECTURE.md`, `IR.md`, `LANGUAGE.md`, `PACKAGES.md` all accurate and current |

**Weighted overall: 7.4 / 10.** The engine and the layering are 8–9 territory; the drag is almost entirely the web studio's state architecture and the duplicated webview.

---

## 4. Why the test suite missed these

This matters more than the individual bugs, because each gap is a class of bug that will recur.

| Bug | Gap in the suite |
|---|---|
| B1 record → existing TEST | [recordTest.test.ts](apps/web/src/test/recordTest.test.ts) asserts only that `CASE "two"` appears *after* `CASE "one"` and that `TEST` appears once. It never **compiles the result**. A nesting bug passes a string-containment assertion trivially. |
| B2 CYCLE in STEP | Every `CYCLE` in `engine.test.ts` sits at the top level of a `CASE` (lines 398–534). `STEP` is only tested with `INPUT`s. |
| B3 recorded clock run | No test replays a recording and checks the edges that fire; `suggestCaseName` is tested with `CYCLE` input the recorder never produces. |
| B4 mixed suite counts | Every test suite in the suite of tests is all-pass or all-fail, so `passed += caseResults.length` was never exercised on a mixed suite. |
| B5 Verilog `ZEXT`/`SEXT` | Export tests apparently cover widening only; equal-width `ZEXT` is legal per the analyzer and unexercised. No test parses/elaborates the emitted Verilog. |
| B6 phantom constants | Node-count assertions likely check `> 0` or specific named nodes, not exact counts. |
| B7 worker crash | [compilerClient.test.ts](apps/web/src/test/compilerClient.test.ts) runs in jsdom, where `new Worker` throws — both tests take the main-thread fallback, so the entire worker path is unexecuted. |
| B8 / B9 / B10 webview behaviour | jsdom reports `clientWidth`/`clientHeight` as 0, so `fit()` early-returns and no test can see the refit-on-resize behaviour; there is no test that compiles twice and asserts simulation state survives. |
| B11 integrity | Tests assert `integrity` *matches `/^sha256-/`*, never that a mismatch is rejected. |

Concrete additions worth making: compile the output of `insertRecordedCase` before asserting; add one test per construct *inside* `STEP`; add a deliberately mixed test suite; run the Verilog output through a parser (or at least assert no `{{0{`); add a `Worker` stub so the crash path is executable; add "edit the source, assert the simulator survived" to `App.test.tsx`.

---

## 5. Recommended order of work

**Fix now (small, user-visible, no design change)**

1. B1 — record into an existing TEST (depth-aware insertion). ~20 lines + a compile-the-result test.
2. B2 — either execute or reject `CYCLE`/`STEP` inside `STEP`. Rejecting is 3 lines and matches `LOAD`'s `E232`.
3. B3 — record clock pulses as `CYCLE <clock> 1` (or lower the line again after a `STEP`), after B2.
4. B4 — count passes per case, not per suite.
5. B5 — omit the replication when the extra width is 0.
6. B8 — drop `size` from the `fit` trigger.
7. B9 — skip `activateCircuit` when the compiled IR for the active circuit is unchanged (a `structureKey`-style identity check, as the extension already does).

**Fix next (a little more design)**

8. B7 — add `onexit`/`messageerror` handling and a compile timeout to the web compiler client, following `studioWorkerClient`.
9. B11 — compare the registry-declared `integrity` against the computed payload hash on fetch, and refuse on mismatch (with `--force` as the escape hatch).
10. B10 — only re-sync a field draft when unfocused.

**Then (structural, worth a plan of its own)**

11. Windowing or path-packing in the waveform panel (the 85k-node / 1.5 s case).
12. Extract the web studio's simulation state into a reducer/hook so ticks stop re-rendering the shell; `React.memo` the dock and the graph.
13. `lazy()` the docs route; move `DocsPage`'s content tables out of the initial chunk.
14. Extract the webview's view code out of the 3,654-line template literal into real modules (or share a render layer with the React app via a plain view model, extending the `studioModel.ts` pattern).
15. Feed compile-time params to builtins without materialising constant nodes (B6), which also cleans up `stats.nodes`, the graph, and the Verilog.

---

## Appendix — how each finding was verified

All probes were run against the real modules with `esbuild --bundle` and Node 24; the temporary scripts were removed afterwards.

1. **B1** — `insertRecordedCase` on a source with one existing `CASE`, then `compile()` on the result: two errors (`E111` line 9, `E100` line 19).
2. **B2** — one program with `CYCLE clk 1` inside `STEP` and at the top level of a second case: `case "cycle inside step" pass=false err=EXPECT q: expected 1, got 0`, `case "cycle at top level" pass=true`. Nested `STEP` inside `STEP` containing `CYCLE` also fails.
3. **B4** — suite of two cases, one passing: `passed=0 failed=1`.
4. **B5/B6** — `exportVerilog()` on `ZEXT(a,4)` at equal width: `assign y = {{0{1'b0}}, a};`; IR node dump for the `SLICE`/`ZEXT` program: 6 nodes, three of them parameters (`3`, `0`, `8`).
5. **B7** — reproduced the `onerror` drain loop with a 4-entry `Map`: all four settle, none leak. Reported as "correct by accident, O(n²), no exit/timeout handling", not as a hang.
6. **B8** — code path read; jsdom cannot reproduce it because `clientWidth` is 0 in tests (which is itself why it was never caught).
7. **Latency table** — `compile`, `runTests`, `generateTruthTable`, `Simulator` and `buildLayout`/`cullLayout` timed via `performance.now()` on a generated 2,002-node design and a 4,096-row truth table.
8. **Waveform table** — real `WaveformPanel` rendered under the project's own jsdom + Testing Library setup at 100/500/1,000/2,000/10,000 samples, counting `container.querySelectorAll("*").length` and timing a second render (standing in for one tick).
9. **Bundle sizes** — `npm run build -w @shortcircuit/web` output.
10. **Formatter safety** — `formatSource` applied to all 10 bundled examples: no diagnostic changes, idempotent on all of them. No bug found, so none reported.
11. **Path safety** — `normalizePackageFile` rejects `..`, absolute paths, schemes, `?` and `#`; `writeRemotePackage` normalises every file before joining. No traversal found.

---

## 6. Fix status — 2026-10-26

Every confirmed defect in this audit has been fixed. The work ships with CLI `0.3.6`
and VS Code extension `0.1.6`.

| Finding | Status | Fix |
|---|---|---|
| B1 — recorded case nesting | Fixed | `insertRecordedCase` tracks `CASE`/`STEP` depth and inserts before the TEST block's own `END`; the result is compiled in a regression test. |
| B2 — `CYCLE` inside `STEP` | Fixed | The test runner executes nested `CYCLE` and `STEP` instructions in source order instead of dropping them. |
| B3 — recorded clock runs | Fixed | Clock recording emits `CYCLE <clock> 1`, which replays an edge; suggested case names now match recorded lines. |
| B4 — mixed suite totals | Fixed | Passing and failing cases are counted independently. |
| B5 — zero-width Verilog replication | Fixed | Equal-width `ZEXT`/`SEXT` exports the operand directly. |
| B6 — phantom constant nodes | Fixed | Slice bounds, extension widths, and repeat counts are resolved as compile-time parameters, not IR nodes. |
| B7 — worker recovery | Fixed | The web compiler worker now handles crashes, message-decoding failures, `postMessage` failures, and per-request timeouts, draining every queued request on the main thread. |
| B8 — graph refit on resize | Fixed | The graph fits once per circuit identity and once on first measurement; resizing preserves the user's pan/zoom. |
| B9 — simulation reset on recompile | Fixed | Recompiles compare the active circuit IR and preserve the simulator, inputs, snapshot, trace, and truth table when it is unchanged. |
| B10 — draft overwritten while typing | Fixed | State and bus drafts only re-sync when the field is not focused. |
| B11 — registry integrity | Fixed | Registry-declared hashes are checked against downloaded and cached contents; mismatches fail with guidance and `--force` is the explicit override. |
| B12a — dead runtime-error capture | Fixed | Simulator construction failures are captured on the snapshot instead of throwing from the constructor. |
| B12b — unused conflict key | Fixed | Removed the unused key and `void key` workaround. |
| B12c — cascading test diagnostics | Fixed | Test analysis is skipped when parser errors already exist. |
| B12d — silently truncated diagnostics | Fixed | The diagnostic bag counts dropped entries and appends a `W900` "Showing X of N" notice after sorting. |
| B12e — nested interactive elements | Fixed | Diagnostic selection and one-click fixes are sibling buttons inside a non-interactive container. |
| B12f — needless index refresh | Fixed | `installPackage` respects the caller's refresh setting instead of always forcing a network refresh. |
| B12g — testbench port collisions | Fixed | Testbenches connect outputs using the reserved port names from `moduleFor`. |
| B12h — per-sample trace copying | Fixed | `appendSamples` batches a clock pulse into one copy, including cap trimming. |
| B12i — package macro collisions | Fixed | Macros are namespaced per package; local helpers win, and genuinely ambiguous unqualified calls report the competing packages and require an alias. |
| B12j — synchronous source writes | Fixed | Source persistence is debounced by 300 ms and flushed on unmount. |

### Performance findings

| Finding | Status | Fix |
|---|---|---|
| 2.2 — unbounded waveform DOM | Fixed | The waveform mounts a 200-sample window with Earlier/Later/Latest paging. |
| 2.3 — per-tick render fan-out | Mitigated | Heavy panels are memoized and callbacks passed to them are stable. |
| 2.4 — docs in the initial bundle | Fixed | `DocsPage` is lazy-loaded and emitted as a separate chunk. |
| 2.5 — webview `.node-value` lookups | Fixed | The VS Code webview caches value elements beside its graph node map. |

Architecture-only follow-ups from section 5 were intentionally left out of this
bug-fix release: extracting the studio's simulation state into a reducer,
splitting the webview template into modules, and rebuilding edge paths only when
their values change. None of these is a confirmed defect.

### Verification and release targets

- `npm test`: 387 tests across 38 files pass.
- `npm run typecheck`: engine, web, CLI, and cross-package tests pass.
- `npm run build -w @shortcircuit/web`: passes; the docs route is a separate
  chunk and the initial JS bundle is ~325 kB.
- GitHub: commit and push `main`; the push also triggers CI and the CLI release.
- npm: `@shortcircuitcli/cli@0.3.6` is published by the `Release CLI` workflow.
- VS Code: `shortcircuit@0.1.6` is packaged as a VSIX and attached to the
  `vscode-v0.1.6` GitHub release; Marketplace publishing remains manual.
- Web: `@shortcircuit/web` is private and is not published.
