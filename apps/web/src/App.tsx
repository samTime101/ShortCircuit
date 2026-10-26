import {
  DEFAULT_PACKAGE_BUNDLE,
  ENGINE_VERSION,
  IR_SCHEMA,
  LANGUAGE_VERSION,
  Simulator,
  formatSource,
  generateTruthTable,
  runTests,
  type CircuitIR,
  type CompileResult,
  type Diagnostic,
  type DiagnosticFix,
  type SimulationSnapshot,
  type TestRunResult,
  type TruthTable,
} from "@shortcircuit/engine";
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CircuitGraph } from "./components/CircuitGraph";
import { CircuitPicker } from "./components/CircuitPicker";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { IRPanel } from "./components/IRPanel";
import { Modal } from "./components/Modal";
import { PaneResizer } from "./components/PaneResizer";
import { SimulatorDock } from "./components/SimulatorDock";
import { TestsPanel } from "./components/TestsPanel";
import { TruthTablePanel } from "./components/TruthTablePanel";
import { WaveformPanel } from "./components/WaveformPanel";
import type { DisplayMode } from "./components/OutputDisplay";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Book,
  Braces,
  Check,
  CircuitMark,
  Code,
  Cpu,
  Download,
  FileCode,
  Flask,
  FontDecrease,
  FontIncrease,
  Graduation,
  Grid,
  Maximize,
  Minimize,
  Play,
  Table,
} from "./components/Icons";
import type { SourceEditorHandle } from "./editor/SourceEditor";
import { DEFAULT_EXAMPLE, EXAMPLES, type Example } from "./lib/examples";
import { insertRecordedCase, suggestCaseName } from "./lib/recordTest";
import { migrateLegacyComments } from "./lib/legacyComments";
import {
  appendSample,
  appendSamples,
  sampleFromSnapshot,
  type TraceSample,
} from "./lib/trace";
import { useRoute } from "./lib/router";
import { createCompilerClient, type CompilerClient } from "./lib/compilerClient";
import {
  DEFAULT_EDITOR_FONT_SIZE,
  DEFAULT_SIM_DOCK_HEIGHT,
  EDITOR_FONT_SIZE_STEP,
  MAX_EDITOR_FONT_SIZE,
  MAX_SIM_DOCK_HEIGHT,
  MIN_EDITOR_FONT_SIZE,
  MIN_SIM_DOCK_HEIGHT,
  clampEditorFontSize,
  clampSimDockHeight,
  readEditorFontSize,
  readMode,
  readSimDockHeight,
  writeEditorFontSize,
  writeMode,
  writeSimDockHeight,
  type StudioMode,
} from "./lib/settings";
import {
  addPackageImport,
  readPackageImports,
  removePackageImport,
} from "./lib/packageImports";

const STORAGE_KEY = "shortcircuit.source.v1";
const DISPLAY_STORAGE_KEY = "shortcircuit.displays.v1";
const COMPILE_DELAY = 360;
const SOURCE_WRITE_DELAY = 300;

/** Keep enough of the graph visible that it never gets squeezed away. */
const GRAPH_MIN_HEIGHT = 140;
const RESIZER_STRIP = 10;

// CodeMirror is the largest dependency in the studio. Load it separately so the
// shell and compiler can paint before the editor bundle arrives.
const SourceEditor = lazy(() =>
  import("./editor/SourceEditor").then((module) => ({ default: module.SourceEditor })),
);

// The documentation is a separate route and is not needed for the first paint.
const DocsPage = lazy(() =>
  import("./pages/DocsPage").then((module) => ({ default: module.DocsPage })),
);

type Tab = "circuit" | "truth" | "waveform" | "tests" | "ir";

const EMPTY_TESTS: TestRunResult = {
  ok: true,
  suites: [],
  passed: 0,
  failed: 0,
  unsupported: 0,
  elapsedMs: 0,
};

function readStoredDisplays(): Record<string, DisplayMode> {
  try {
    const raw = window.localStorage.getItem(DISPLAY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, DisplayMode>) : {};
  } catch {
    return {};
  }
}

function readStoredSource(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === null) return DEFAULT_EXAMPLE.source;
    // Sources saved before LogicFlow 0.2 used `#` for comments.
    return migrateLegacyComments(stored);
  } catch {
    return DEFAULT_EXAMPLE.source;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The engine formatter ends its output with a newline so CLI files are
 * POSIX-friendly. In the editor that trailing newline looks like an extra
 * blank line, so keep the editor's existing end-of-file style instead.
 */
function formatSourceForEditor(source: string): string {
  const formatted = formatSource(source);
  return source.endsWith("\n") ? formatted : formatted.slice(0, -1);
}

export default function App() {
  const [route, navigate] = useRoute();
  const [mode, setMode] = useState<StudioMode>(readMode);
  if (route === "docs") {
    return (
      <Suspense
        fallback={
          <div className="docs-loading" role="status">
            Loading the documentation…
          </div>
        }
      >
        <DocsPage onBack={() => navigate("studio")} beginner={mode === "beginner"} />
      </Suspense>
    );
  }
  return (
    <Studio
      onOpenDocs={() => navigate("docs")}
      mode={mode}
      onModeChange={setMode}
    />
  );
}

function Studio({
  onOpenDocs,
  mode,
  onModeChange,
}: {
  onOpenDocs(): void;
  mode: StudioMode;
  onModeChange(mode: StudioMode): void;
}) {
  const [source, setSource] = useState(readStoredSource);
  const [result, setResult] = useState<CompileResult | null>(null);
  const [compiling, setCompiling] = useState(true);
  const [activeCircuitName, setActiveCircuitName] = useState(DEFAULT_EXAMPLE.focusCircuit);
  const [tab, setTab] = useState<Tab>("circuit");
  const [simulator, setSimulator] = useState<Simulator | null>(null);
  const [snapshot, setSnapshot] = useState<SimulationSnapshot | null>(null);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [selectedClock, setSelectedClock] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [clockSpeed, setClockSpeed] = useState(2);
  const [recording, setRecording] = useState<{ circuit: string; lines: string[] } | null>(null);
  const [recordingName, setRecordingName] = useState("");
  const [recordingOpen, setRecordingOpen] = useState(false);
  const [trace, setTrace] = useState<TraceSample[]>([]);
  const [displays, setDisplays] = useState<Record<string, DisplayMode>>(readStoredDisplays);
  const [truthTable, setTruthTable] = useState<TruthTable | null>(null);
  const [testResult, setTestResult] = useState<TestRunResult | null>(null);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [packagesOpen, setPackagesOpen] = useState(false);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const [editorMaximized, setEditorMaximized] = useState(false);
  const [editorFontSize, setEditorFontSize] = useState(readEditorFontSize);
  const [dockHeight, setDockHeight] = useState(readSimDockHeight);

  const editorRef = useRef<SourceEditorHandle>(null);
  const circuitTabRef = useRef<HTMLDivElement>(null);
  const simPaneRef = useRef<HTMLDivElement>(null);
  const compilerRef = useRef<CompilerClient | null>(null);
  if (compilerRef.current === null) compilerRef.current = createCompilerClient();
  const compiler = compilerRef.current;
  const compileSeq = useRef(0);
  const lastCompiledSource = useRef<string | null>(null);
  const debounceTimer = useRef<number | null>(null);
  const activeCircuitRef = useRef(DEFAULT_EXAMPLE.focusCircuit);
  const activeCircuitIR = useRef<CircuitIR | null>(null);
  const simulatorRef = useRef<Simulator | null>(null);
  const latestSource = useRef(source);
  const toastSeq = useRef(0);

  const notify = useCallback((message: string) => {
    toastSeq.current += 1;
    setToast({ id: toastSeq.current, message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    return () => compiler.dispose();
  }, [compiler]);

  useEffect(() => {
    latestSource.current = source;
    // Typing should not synchronously write the whole document on every key.
    // Keep the newest value and persist it once the burst settles.
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, source);
      } catch {
        // Persistence is a convenience; private browsing can reject writes.
      }
    }, SOURCE_WRITE_DELAY);
    return () => window.clearTimeout(timer);
  }, [source]);

  useEffect(() => {
    // Flush the pending source when the studio unmounts or the route changes.
    return () => {
      try {
        window.localStorage.setItem(STORAGE_KEY, latestSource.current);
      } catch {
        // Ignore storage failures during teardown too.
      }
    };
  }, []);

  useEffect(() => {
    writeMode(mode);
  }, [mode]);

  useEffect(() => {
    writeEditorFontSize(editorFontSize);
  }, [editorFontSize]);

  useEffect(() => {
    const timer = window.setTimeout(() => writeSimDockHeight(dockHeight), 200);
    return () => window.clearTimeout(timer);
  }, [dockHeight]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(displays));
    } catch {
      // The display choices are a convenience, not something to fail over.
    }
  }, [displays]);

  const installSimulator = useCallback((next: Simulator | null) => {
    simulatorRef.current = next;
    setSimulator(next);
  }, []);

  const activateCircuit = useCallback((circuit: CircuitIR) => {
    activeCircuitRef.current = circuit.name;
    activeCircuitIR.current = circuit;
    setActiveCircuitName(circuit.name);
    setTruthTable(generateTruthTable(circuit));
    setRuntimeError(null);
    setRunning(false);
    setTrace([]);
    try {
      const nextSimulator = new Simulator(circuit);
      const nextSnapshot = nextSimulator.snapshot();
      installSimulator(nextSimulator);
      setInputValues(nextSimulator.getInputValues());
      if (nextSnapshot.runtimeError) {
        setSnapshot(null);
        setRuntimeError(`${nextSnapshot.runtimeError.code}: ${nextSnapshot.runtimeError.message}`);
      } else {
        setSnapshot(nextSnapshot);
      }
    } catch (error) {
      installSimulator(null);
      setSnapshot(null);
      setInputValues({});
      setRuntimeError(`Could not start the simulator: ${errorText(error)}`);
    }
  }, [installSimulator]);

  const compileNow = useCallback(
    (nextSource: string, preferredCircuit?: string) => {
      if (debounceTimer.current !== null) {
        window.clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
      lastCompiledSource.current = nextSource;
      const sequence = ++compileSeq.current;
      setCompiling(true);

      // The compiler runs in a worker, so a large design never blocks typing.
      // A result that is older than the newest request is dropped.
      void compiler
        .compile(nextSource)
        .then((next) => {
          if (sequence !== compileSeq.current) return;

          setResult(next);
          setCompiling(false);

          if (!next.ok) {
            installSimulator(null);
            setSnapshot(null);
            setInputValues({});
            setRuntimeError(null);
            setTruthTable(null);
            setTestResult(null);
            return;
          }

          const requested = preferredCircuit ?? activeCircuitRef.current;
          const circuit =
            next.circuits.find((entry) => entry.name === requested) ??
            next.circuits[0];

          if (!circuit) {
            installSimulator(null);
            setSnapshot(null);
            setInputValues({});
            setTruthTable(null);
            setTestResult(runTests(next));
            return;
          }

          // A comment-only edit must not throw away inputs, state or the
          // waveform. Rebuild the simulator only when the IR actually changed.
          const previous = activeCircuitIR.current;
          const unchanged =
            simulatorRef.current !== null &&
            previous !== null &&
            JSON.stringify(previous) === JSON.stringify(circuit);
          if (unchanged) {
            setTestResult(runTests(next));
            return;
          }

          activateCircuit(circuit);
          setTestResult(runTests(next));
        })
        .catch(() => {
          if (sequence !== compileSeq.current) return;
          setCompiling(false);
        });
    },
    [activateCircuit, compiler, installSimulator],
  );

  const togglePackage = useCallback(
    (name: string, imported: boolean) => {
      const next = imported
        ? addPackageImport(source, name)
        : removePackageImport(source, name);
      if (next === source) return;
      setSource(next);
      notify(imported ? `${name} imported` : `${name} import removed`);
      compileNow(next, activeCircuitRef.current);
    },
    [compileNow, notify, source],
  );

  // Compile immediately on mount, then debounce edits.
  useEffect(() => {
    if (lastCompiledSource.current === source) return;
    const delay = lastCompiledSource.current === null ? 0 : COMPILE_DELAY;
    const timer = window.setTimeout(() => {
      debounceTimer.current = null;
      compileNow(source);
    }, delay);
    debounceTimer.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (debounceTimer.current === timer) debounceTimer.current = null;
    };
  }, [source, compileNow]);

  const activeCircuit = useMemo(() => {
    if (!result?.ok) return undefined;
    return (
      result.circuits.find((circuit) => circuit.name === activeCircuitName) ??
      result.circuits[0]
    );
  }, [result, activeCircuitName]);

  const stepClock = useCallback(() => {
    if (!simulator || !selectedClock) return;
    setRecording((current) =>
      current
        ? { ...current, lines: [...current.lines, `CYCLE ${selectedClock} 1`] }
        : current,
    );
    try {
      simulator.setInput(selectedClock, "0");
      const rising = simulator.setInput(selectedClock, "1");
      const after = simulator.setInput(selectedClock, "0");
      setSnapshot(after);
      setInputValues(simulator.getInputValues());
      setRuntimeError(null);
      // Keep both halves of the pulse so the edge that fired is on the trace.
      setTrace((current) =>
        appendSamples(current, [
          sampleFromSnapshot(rising, selectedClock),
          sampleFromSnapshot(after, selectedClock),
        ]),
      );
    } catch (error) {
      setSnapshot(null);
      setRuntimeError(errorText(error));
    }
  }, [simulator, selectedClock]);

  const startRecording = useCallback(() => {
    if (!activeCircuitRef.current) return;
    setRecording({ circuit: activeCircuitRef.current, lines: [] });
    setRecordingName(suggestCaseName([]));
  }, []);

  const stopRecording = useCallback(() => {
    setRecordingName(suggestCaseName(recording?.lines ?? []));
    setRecordingOpen(true);
  }, [recording]);

  const expectThis = useCallback(
    (name: string, value: string) => {
      setRecording((current) =>
        current ? { ...current, lines: [...current.lines, `EXPECT ${name} = ${value}`] } : current,
      );
    },
    [],
  );

  const saveRecording = useCallback(() => {
    if (!recording) return;
    const label = recordingName.trim() || suggestCaseName(recording.lines);
    const next = insertRecordedCase(source, {
      circuit: recording.circuit,
      label,
      lines: recording.lines,
    });
    setRecording(null);
    setRecordingOpen(false);
    setSource(next);
    compileNow(next, activeCircuitRef.current);
    notify(`Added the test case "${label}"`);
  }, [recording, recordingName, source, compileNow, notify]);

  const forceState = useCallback(
    (name: string, value: string) => {
      if (!simulator) return;
      try {
        const next = simulator.setState(name, value);
        setSnapshot(next);
        setRuntimeError(null);
        setTrace((current) => appendSample(current, sampleFromSnapshot(next, name)));
      } catch (error) {
        setRuntimeError(errorText(error));
      }
    },
    [simulator],
  );

  const clockNames = useMemo(() => {
    if (!activeCircuit) return [] as string[];
    const names = new Set<string>();
    for (const event of activeCircuit.events) {
      const node = activeCircuit.nodes.find((entry) => entry.id === event.clock);
      if (node?.inputName) names.add(node.inputName);
    }
    return [...names];
  }, [activeCircuit]);

  useEffect(() => {
    setRunning(false);
    setSelectedClock((current) => {
      if (current && clockNames.includes(current)) return current;
      return clockNames[0] ?? null;
    });
  }, [clockNames]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => stepClock(), Math.max(60, 1000 / clockSpeed));
    return () => window.clearInterval(timer);
  }, [running, clockSpeed, stepClock]);

  const matchingExample = useMemo(
    () => EXAMPLES.find((example) => example.source === source),
    [source],
  );

  const importedPackages = useMemo(
    () => new Set(readPackageImports(source).map((entry) => entry.packageName)),
    [source],
  );

  const errorCount = useMemo(
    () => result?.diagnostics.filter((item) => item.severity === "error").length ?? 0,
    [result],
  );
  const warningCount = useMemo(
    () => result?.diagnostics.filter((item) => item.severity === "warning").length ?? 0,
    [result],
  );
  const totalNodes = useMemo(
    () => result?.circuits.reduce((sum, circuit) => sum + circuit.stats.nodes, 0) ?? 0,
    [result],
  );

  const switchCircuit = useCallback(
    (name: string) => {
      if (!result?.ok) return;
      const circuit = result.circuits.find((entry) => entry.name === name);
      if (!circuit) return;
      activateCircuit(circuit);
    },
    [activateCircuit, result],
  );

  const dockHeightLimit = () => {
    const available = circuitTabRef.current?.clientHeight ?? 0;
    if (available <= 0) return MAX_SIM_DOCK_HEIGHT;
    return Math.max(
      MIN_SIM_DOCK_HEIGHT,
      Math.min(MAX_SIM_DOCK_HEIGHT, available - GRAPH_MIN_HEIGHT - RESIZER_STRIP),
    );
  };

  const resizeDock = (delta: number) => {
    const limit = dockHeightLimit();
    setDockHeight((current) => clampSimDockHeight(Math.min(limit, current + delta)));
  };

  const resetDockHeight = () => {
    setDockHeight(clampSimDockHeight(Math.min(DEFAULT_SIM_DOCK_HEIGHT, dockHeightLimit())));
  };

  /**
   * Start a drag from the height the browser actually shows, which may be
   * capped by the window even when the stored size is larger.
   */
  const syncDockHeight = () => {
    const measured = simPaneRef.current?.getBoundingClientRect().height ?? 0;
    if (measured > 0) setDockHeight(clampSimDockHeight(measured));
  };

  const onInputChange = useCallback(
    (name: string, value: string) => {
      if (!simulator) return;
      setRecording((current) =>
        current ? { ...current, lines: [...current.lines, `INPUT ${name} = ${value}`] } : current,
      );
      try {
        const next = simulator.setInput(name, value);
        setSnapshot(next);
        setInputValues(simulator.getInputValues());
        setRuntimeError(null);
        setTrace((current) => appendSample(current, sampleFromSnapshot(next, name)));
      } catch (error) {
        setSnapshot(null);
        setRuntimeError(errorText(error));
      }
    },
    [simulator],
  );

  const resetSimulation = useCallback(() => {
    if (!simulator) return;
    try {
      const next = simulator.reset();
      setSnapshot(next);
      setInputValues(simulator.getInputValues());
      setRuntimeError(null);
      setTrace([]);
      notify("Stored state returned to its initial value");
    } catch (error) {
      setSnapshot(null);
      setRuntimeError(errorText(error));
    }
  }, [notify, simulator]);

  const runNow = useCallback(() => {
    compileNow(source, activeCircuitRef.current);
    notify("Rebuilding the circuit graph");
  }, [compileNow, notify, source]);

  const selectDiagnostic = useCallback((diagnostic: Diagnostic) => {
    editorRef.current?.gotoLine(diagnostic.line, diagnostic.column);
  }, []);

  const toggleRun = useCallback(() => {
    setRunning((current) => !current);
  }, []);

  const changeDisplay = useCallback((name: string, mode: DisplayMode) => {
    setDisplays((current) => ({ ...current, [name]: mode }));
  }, []);

  const handleFormat = useCallback(() => {
    const formatted = formatSourceForEditor(source);
    if (formatted === source) {
      notify("Source is already formatted");
      return;
    }
    setSource(formatted);
    compileNow(formatted, activeCircuitRef.current);
    notify("Formatted LogicFlow source");
  }, [source, compileNow, notify]);

  const toggleEditorMaximized = useCallback(() => {
    setEditorMaximized((current) => !current);
  }, []);

  const growEditorFont = useCallback(() => {
    setEditorFontSize((current) =>
      clampEditorFontSize(current + EDITOR_FONT_SIZE_STEP),
    );
  }, []);

  const shrinkEditorFont = useCallback(() => {
    setEditorFontSize((current) =>
      clampEditorFontSize(current - EDITOR_FONT_SIZE_STEP),
    );
  }, []);

  const resetEditorFont = useCallback(() => {
    setEditorFontSize(DEFAULT_EDITOR_FONT_SIZE);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        handleFormat();
        return;
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === "m") {
        event.preventDefault();
        toggleEditorMaximized();
        return;
      }
      // Escape leaves the maximized editor, but never steals the key from a
      // dialog that is already open.
      if (
        event.key === "Escape" &&
        editorMaximized &&
        !examplesOpen &&
        !recordingOpen
      ) {
        setEditorMaximized(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleFormat, toggleEditorMaximized, editorMaximized, examplesOpen, recordingOpen]);

  const loadExample = (example: Example) => {
    setSource(example.source);
    setExamplesOpen(false);
    setTab("circuit");
    compileNow(example.source, example.focusCircuit);
    notify(`Loaded ${example.title}`);
  };

  const downloadText = useCallback((filename: string, contents: string, mime: string) => {
    const blob = new Blob([contents], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const downloadSource = () => {
    const filename = matchingExample ? `${matchingExample.id}.lf` : "scratch.lf";
    const blob = new Blob([source], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    notify("LogicFlow source downloaded");
  };

  const applyFix = useCallback(
    (fix: DiagnosticFix) => {
      const lines = source.split("\n");
      const index = fix.line - 1;
      const line = lines[index];
      if (line === undefined) return;
      const start = Math.max(0, fix.column - 1);
      const end = Math.min(line.length, start + fix.length);
      const next = [...lines];
      next[index] = `${line.slice(0, start)}${fix.text}${line.slice(end)}`;
      const patched = next.join("\n");
      setSource(patched);
      compileNow(patched, activeCircuitRef.current);
      notify(`Applied the fix for ${fix.label}`);
    },
    [source, compileNow, notify],
  );

  const tabs: Array<{ id: Tab; label: string; icon: ReactNode; count?: string; alert?: boolean }> = [
    {
      id: "circuit",
      label: "Circuit",
      icon: <Cpu size={13} />,
      count: activeCircuit ? `${activeCircuit.stats.nodes}` : undefined,
    },
    {
      id: "truth",
      label: "Truth table",
      icon: <Table size={13} />,
      count: truthTable && truthTable.rows.length > 0 ? `${truthTable.rows.length}` : undefined,
    },
    {
      id: "waveform",
      label: "Waveform",
      icon: <Activity size={13} />,
      count: trace.length > 0 ? `${trace.length}` : undefined,
    },
    {
      id: "tests",
      label: "Tests",
      icon: <Flask size={13} />,
      count:
        testResult && testResult.suites.length > 0
          ? testResult.failed > 0
            ? `${testResult.failed}`
            : `${testResult.passed}`
          : undefined,
      alert: Boolean(testResult && testResult.failed > 0),
    },
    ...(mode === "beginner" ? [] : [{ id: "ir" as Tab, label: "IR", icon: <Braces size={13} /> }]),
  ];

  const engineState = compiling
    ? { className: "is-compiling", label: "Compiling" }
    : errorCount > 0
      ? { className: "is-error", label: `${errorCount} error${errorCount === 1 ? "" : "s"}` }
      : { className: "is-ready", label: warningCount > 0 ? "Graph ready · warnings" : "Graph ready" };

  const fileName = matchingExample ? `${matchingExample.id}.lf` : "scratch.lf";

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workbench">
        Skip to the workbench
      </a>
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">
            <CircuitMark size={30} />
          </span>
          <div className="brand-text">
            <span className="brand-name">SHORT CIRCUIT</span>
            <span className="brand-sub">LogicFlow Studio</span>
          </div>
        </div>

        <div className="header-center">
          <span className="version-chip">LogicFlow 0.2</span>
          <span className={`engine-status ${engineState.className}`}>
            <span className="status-dot" />
            {engineState.label}
          </span>
        </div>

        <div className="header-actions">
          <button className="ghost-button" onClick={() => setExamplesOpen(true)}>
            <Grid size={14} />
            <span className="button-label">Examples</span>
          </button>
          <button
            className="ghost-button"
            onClick={() => setPackagesOpen(true)}
            title="Manage package imports"
          >
            <Cpu size={14} />
            <span className="button-label">Packages</span>
          </button>
          <button
            className={`ghost-button ${mode === "beginner" ? "is-active" : ""}`}
            onClick={() => {
              const next: StudioMode = mode === "beginner" ? "advanced" : "beginner";
              onModeChange(next);
              writeMode(next);
              notify(next === "beginner" ? "Beginner mode on" : "Advanced mode on");
            }}
            title="Beginner mode hides the advanced views"
          >
            <Graduation size={14} />
            <span className="button-label">{mode === "beginner" ? "Beginner" : "Advanced"}</span>
          </button>
          <button className="ghost-button" onClick={onOpenDocs} title="Open the LogicFlow documentation">
            <Book size={14} />
            <span className="button-label">Docs</span>
          </button>
          <button className="primary-button" onClick={runNow} title="Compile and run (Mod+Enter in the editor)">
            <Play size={13} />
            Run
            <kbd>Mod↵</kbd>
          </button>
        </div>
      </header>

      <main
        className={`app-main ${editorMaximized ? "is-editor-max" : ""}`}
        id="workbench"
      >
        <section className="editor-pane">
          <div className="pane-chrome">
            <div className="pane-tab">
              <FileCode size={14} />
              <span className="file-name" title={fileName}>
                {fileName}
              </span>
              <span className="file-dot" />
            </div>
            <div className="pane-chrome-right">
              <span className="pane-meta">
                {result?.circuits.length ?? 0} circuit{(result?.circuits.length ?? 0) === 1 ? "" : "s"} ·{" "}
                {totalNodes} nodes
              </span>
              <div className="font-size-control" role="group" aria-label="Editor font size">
                <button
                  className="icon-button tiny"
                  onClick={shrinkEditorFont}
                  disabled={editorFontSize <= MIN_EDITOR_FONT_SIZE}
                  title="Smaller editor text"
                  aria-label="Decrease editor font size"
                >
                  <FontDecrease size={14} />
                </button>
                <button
                  className="font-size-value"
                  onClick={resetEditorFont}
                  title="Reset to the default size"
                  aria-label={`Editor font size ${editorFontSize} pixels, reset to default`}
                >
                  {editorFontSize}px
                </button>
                <button
                  className="icon-button tiny"
                  onClick={growEditorFont}
                  disabled={editorFontSize >= MAX_EDITOR_FONT_SIZE}
                  title="Larger editor text"
                  aria-label="Increase editor font size"
                >
                  <FontIncrease size={14} />
                </button>
              </div>
              <button
                className="icon-button"
                onClick={handleFormat}
                title="Format source (Mod+S)"
                aria-label="Format source"
              >
                <Code size={15} />
              </button>
              <button
                className="icon-button"
                onClick={downloadSource}
                title="Download source"
                aria-label="Download LogicFlow source"
              >
                <Download size={15} />
              </button>
              <button
                className="icon-button"
                onClick={toggleEditorMaximized}
                aria-pressed={editorMaximized}
                title={
                  editorMaximized
                    ? "Restore the split view (Esc)"
                    : "Maximize the editor (Mod+Shift+M)"
                }
                aria-label={editorMaximized ? "Restore editor" : "Maximize editor"}
              >
                {editorMaximized ? <Minimize size={15} /> : <Maximize size={15} />}
              </button>
            </div>
          </div>

          <Suspense
            fallback={
              <div className="source-editor editor-loading">
                <span>Loading editor…</span>
              </div>
            }
          >
            <SourceEditor
              ref={editorRef}
              value={source}
              diagnostics={result?.diagnostics ?? []}
              fontSize={editorFontSize}
              onChange={setSource}
              onRun={runNow}
            />
          </Suspense>

          <DiagnosticsPanel
            diagnostics={result?.diagnostics ?? []}
            source={source}
            compiling={compiling}
            circuitCount={result?.circuits.length ?? 0}
            nodeCount={totalNodes}
            onSelect={selectDiagnostic}
            onApplyFix={applyFix}
          />
        </section>

        <section className="inspection-pane" hidden={editorMaximized}>
          <div className="inspection-tabs">
            <div className="tab-row" role="tablist" aria-label="Inspection views">
              {tabs.map((entry) => (
                <button
                  key={entry.id}
                  role="tab"
                  aria-selected={tab === entry.id}
                  className={`inspection-tab ${tab === entry.id ? "is-active" : ""}`}
                  onClick={() => setTab(entry.id)}
                >
                  {entry.icon}
                  {entry.label}
                  {entry.count !== undefined ? (
                    <span className={`tab-count ${entry.alert ? "alert" : ""}`}>{entry.count}</span>
                  ) : null}
                </button>
              ))}
            </div>

            {result?.ok && result.circuits.length > 0 ? (
              <div className="inspection-context">
                <CircuitPicker
                  circuits={result.circuits.map((circuit) => circuit.name)}
                  value={activeCircuit?.name ?? activeCircuitName}
                  onChange={switchCircuit}
                />
              </div>
            ) : null}
          </div>

          <div className="inspection-content">
            {tab === "circuit" ? (
              compiling && !result ? (
                <div className="inspection-loading">
                  <span className="loader-ring" />
                  <span>Warming up the workbench…</span>
                </div>
              ) : !activeCircuit || !result?.ok ? (
                <div className="inspection-fatal">
                  <span className="fatal-icon">
                    <AlertTriangle size={21} />
                  </span>
                  <h2>Errors detected</h2>
                  <p>
                    The compiler found {errorCount || "one or more"} error{errorCount === 1 ? "" : "s"}.
                    Check the error console and fix them. The graph rebuilds automatically.
                  </p>
                </div>
              ) : (
                <div className="circuit-tab" ref={circuitTabRef}>
                  <div className="sim-pane" ref={simPaneRef} style={{ height: `${dockHeight}px` }}>
                    <SimulatorDock
                      circuit={activeCircuit}
                      snapshot={snapshot}
                      inputValues={inputValues}
                      runtimeError={runtimeError}
                      clocks={clockNames}
                      selectedClock={selectedClock}
                      onSelectClock={setSelectedClock}
                      onStep={stepClock}
                      running={running}
                      onToggleRun={toggleRun}
                      speed={clockSpeed}
                      onSpeedChange={setClockSpeed}
                      onInputChange={onInputChange}
                      onSetState={forceState}
                      onReset={resetSimulation}
                      recording={recording !== null}
                      onStartRecording={startRecording}
                      onStopRecording={stopRecording}
                      onExpectThis={expectThis}
                      displays={displays}
                      beginner={mode === "beginner"}
                      onDisplayChange={changeDisplay}
                    />
                  </div>

                  <PaneResizer
                    orientation="horizontal"
                    label="Resize the simulation panel and graph"
                    value={dockHeight}
                    min={MIN_SIM_DOCK_HEIGHT}
                    max={MAX_SIM_DOCK_HEIGHT}
                    onDrag={resizeDock}
                    onStart={syncDockHeight}
                    onNudge={resizeDock}
                    onEdge={(edge) =>
                      setDockHeight(edge === "start" ? MIN_SIM_DOCK_HEIGHT : dockHeightLimit())
                    }
                    onReset={resetDockHeight}
                  />

                  <div className="graph-panel">
                    <div className="graph-toolbar">
                      <div className="graph-toolbar-title">
                        <span className="eyebrow">Evaluation graph</span>
                        <div>
                          <strong>{activeCircuit.name}</strong>
                          <span>
                            {activeCircuit.stats.nodes} nodes · {activeCircuit.stats.maxDepth} deep ·{" "}
                            {activeCircuit.stats.maxWidth}b max width
                          </span>
                        </div>
                      </div>
                      <span
                        className={`graph-mode ${activeCircuit.sequential ? "sequential" : "combinational"}`}
                      >
                        {activeCircuit.sequential ? "Sequential" : "Combinational"}
                      </span>
                    </div>
                    <CircuitGraph circuit={activeCircuit} snapshot={snapshot} />
                  </div>
                </div>
              )
            ) : null}

            {tab === "truth" ? (
              <div className="inspection-scroll">
                <TruthTablePanel table={result?.ok ? truthTable : null} />
              </div>
            ) : null}

            {tab === "waveform" ? (
              <div className="inspection-scroll">
                {activeCircuit ? (
                  <WaveformPanel
                    circuit={activeCircuit}
                    trace={trace}
                    onDownload={downloadText}
                  />
                ) : null}
              </div>
            ) : null}

            {tab === "tests" ? (
              <div className="inspection-scroll">
                <TestsPanel result={result?.ok ? testResult ?? EMPTY_TESTS : EMPTY_TESTS} />
              </div>
            ) : null}

            {tab === "ir" ? (
              <div className="inspection-scroll">
                <IRPanel ir={result?.ir ?? null} onNotify={notify} />
              </div>
            ) : null}
          </div>
        </section>
      </main>

      <footer className="status-bar">
        <div className="status-left">
          <span className="status-item">
            <span className="tiny-led" /> engine {ENGINE_VERSION}
          </span>
          <span className="status-item">{IR_SCHEMA}</span>
          <span className="status-item status-optional">{LANGUAGE_VERSION}</span>
          {compiling ? <span className="status-item status-compiling">compiling…</span> : null}
          {runtimeError ? <span className="status-item status-runtime">runtime stopped</span> : null}
        </div>
        <div className="status-right">
          <span className="status-hint">
            <kbd>Mod</kbd>
            <kbd>↵</kbd> run
          </span>
          <span className="status-hint">
            <kbd>Mod</kbd>
            <kbd>S</kbd> format
          </span>
          <span className="status-hint status-optional">drag to pan · scroll to zoom</span>
        </div>
      </footer>

      {toast ? (
        <div className="toast" role="status" aria-live="polite" key={toast.id}>
          <Check size={13} />
          {toast.message}
        </div>
      ) : null}

      {recordingOpen ? (
        <Modal
          eyebrow="Recorded test"
          title="Name this case"
          subtitle="The recording becomes a TEST case in your source, so you can edit it afterwards."
          onClose={() => setRecordingOpen(false)}
        >
          <div className="recording-form">
            <label className="recording-label" htmlFor="recording-name">
              Case name
            </label>
            <input
              id="recording-name"
              className="recording-input"
              value={recordingName}
              autoFocus
              onChange={(event) => setRecordingName(event.target.value)}
            />
            <pre className="recording-preview">
              {recording
                ? [
                    `TEST ${recording.circuit}`,
                    `  CASE "${recordingName || suggestCaseName(recording.lines)}"`,
                    ...recording.lines.map((line) => `    ${line}`),
                    "  END",
                    "END",
                  ].join("\n")
                : ""}
            </pre>
            <div className="recording-actions">
              <button className="secondary-button" onClick={() => setRecordingOpen(false)}>
                Cancel
              </button>
              <button className="primary-button" onClick={saveRecording}>
                Add test case
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {packagesOpen ? (
        <Modal
          eyebrow="Package manager"
          title="Installed packages"
          subtitle="Packages are available only when the source imports them. Check a package to add its IMPORT line at the top, or clear it to remove the line."
          onClose={() => setPackagesOpen(false)}
        >
          <div className="package-list">
            {DEFAULT_PACKAGE_BUNDLE.packages.map((entry) => {
              const imported = importedPackages.has(entry.name);
              return (
                <label className="package-row" key={entry.name}>
                  <input
                    type="checkbox"
                    aria-label={entry.name}
                    checked={imported}
                    onChange={(event) => togglePackage(entry.name, event.target.checked)}
                  />
                  <span className="package-row-text">
                    <span className="package-row-title">
                      <strong>{entry.name}</strong>
                      <span className="package-version">v{entry.version}</span>
                    </span>
                    <span className="package-description">
                      {entry.description ?? "LogicFlow package"}
                    </span>
                    <span className="package-exports">
                      {entry.exports.length} export{entry.exports.length === 1 ? "" : "s"}
                      {entry.dependencies && Object.keys(entry.dependencies).length > 0
                        ? ` · depends on ${Object.keys(entry.dependencies).join(", ")}`
                        : ""}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <p className="package-note">
            Unimported packages do not affect compilation. Removing an IMPORT line makes that
            package's exports unavailable until it is imported again.
          </p>
        </Modal>
      ) : null}

      {examplesOpen ? (
        <Modal
          eyebrow="Example library"
          title="Start from a working circuit"
          subtitle="Every example is a complete LogicFlow program with tests, ready to simulate."
          size="wide"
          onClose={() => setExamplesOpen(false)}
        >
          <div className="example-grid">
            {EXAMPLES.map((example, index) => {
              const current = matchingExample?.id === example.id;
              return (
                <button
                  className={`example-card ${current ? "is-current" : ""}`}
                  key={example.id}
                  onClick={() => loadExample(example)}
                >
                  <div className="example-card-top">
                    <span className="example-number">{String(index + 1).padStart(2, "0")}</span>
                    <span className="example-level">{example.level}</span>
                  </div>
                  <h3>{example.title}</h3>
                  <p>{example.description}</p>
                  <div className="example-card-footer">
                    <span className="example-tag">{example.tag}</span>
                    <span className="example-open">
                      {current ? "Reload" : "Open"} <ArrowUpRight size={11} />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="examples-footnote">
            <FileCode size={13} />
            <span>
              Loading an example replaces the editor contents. Your current source is kept in local storage
              until you replace it.
            </span>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
