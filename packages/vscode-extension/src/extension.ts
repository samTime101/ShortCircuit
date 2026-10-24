import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import * as path from "path";
import {
  compile,
  Simulator,
  runTests,
  formatSource,
  formatBinary,
  parsePackageMacroSource,
  parseSimulationInput,
  type CircuitIR,
  type CompileResult,
  type SimulationSnapshot,
} from "@shortcircuit/engine";
import { buildLayout } from "./graphLayout";
import { getStudioHtml } from "./studioHtml";
import {
  buildCircuitSummaries,
  buildIrSummary,
  buildIrText,
  buildTestsModel,
  buildTruthTable,
  buildWaveform,
  findTestAtPosition,
  inputBitAt,
  mapDiagnostics,
  normalizeInputs,
  normalizeInputValue,
  snapshotToModel,
  type StudioDerivedKind,
  type StudioDiagnostic,
  type StudioModel,
} from "./studioModel";
import { resolveWorkspaceContext, invalidatePackageCache } from "./packageResolver";

let client: LanguageClient | undefined;
let studioProvider: ShortCircuitStudioProvider | undefined;
let changeTimer: NodeJS.Timeout | undefined;
let packageRefreshTimer: NodeJS.Timeout | undefined;
let testOutputChannel: vscode.OutputChannel | undefined;

const CHANGE_DELAY_MS = 140;
const PACKAGE_REFRESH_DELAY_MS = 250;

export function activate(context: vscode.ExtensionContext): void {
  // 1. Language Server
  try {
    const serverModule = context.asAbsolutePath(path.join("out", "language-server.js"));
    const serverOptions: ServerOptions = {
      run: { module: serverModule, transport: TransportKind.ipc },
      debug: {
        module: serverModule,
        transport: TransportKind.ipc,
        options: { execArgv: ["--nolazy", "--inspect=6009"] },
      },
    };

    const clientOptions: LanguageClientOptions = {
      documentSelector: [
        { scheme: "file", language: "logicflow" },
        { scheme: "untitled", language: "logicflow" },
      ],
      synchronize: {
        fileEvents: [
          vscode.workspace.createFileSystemWatcher("**/*.lf"),
          vscode.workspace.createFileSystemWatcher("**/manifest.json"),
          vscode.workspace.createFileSystemWatcher("**/shortcircuit.json"),
          vscode.workspace.createFileSystemWatcher("**/shortcircuit.lock.json"),
        ],
        configurationSection: "shortcircuit",
      },
      outputChannelName: "Short Circuit",
      revealOutputChannelOn: 4,
      initializationOptions: {},
    };

    client = new LanguageClient(
      "shortcircuit",
      "Short Circuit Language Server",
      serverOptions,
      clientOptions,
    );
    void client.start();
    context.subscriptions.push({
      dispose: () => {
        if (client) return client.stop();
        return undefined;
      },
    });
  } catch (err) {
    console.error("Failed to start language client:", err);
  }

  // 2. Studio state manager and sidebar webview
  const provider = new ShortCircuitStudioProvider(context.extensionUri);
  studioProvider = provider;
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("shortcircuit.studioView", provider),
    { dispose: () => provider.dispose() },
  );

  // 3. Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("shortcircuit.openStudio", () => {
      StudioPanel.createOrShow(provider, "circuit");
    }),

    vscode.commands.registerCommand("shortcircuit.expandStudio", () => {
      StudioPanel.createOrShow(provider, "circuit");
    }),

    vscode.commands.registerCommand("shortcircuit.refreshStudio", () => {
      provider.refresh();
    }),

    vscode.commands.registerCommand("shortcircuit.openWaveform", () => {
      StudioPanel.createOrShow(provider, "waveform");
    }),

    vscode.commands.registerCommand("shortcircuit.openTruthTable", () => {
      StudioPanel.createOrShow(provider, "truth");
    }),

    vscode.commands.registerCommand(
      "shortcircuit.runTest",
      async (uri?: vscode.Uri, position?: vscode.Position) => {
        const document = await resolveCommandDocument(uri);
        if (!document || document.languageId !== "logicflow") return;
        const cursor =
          position ??
          vscode.window.activeTextEditor?.selection.active ??
          new vscode.Position(0, 0);
        const testName = findTestAtPosition(document.getText(), cursor.line) ?? undefined;
        await runFileTests(document, testName);
      },
    ),

    vscode.commands.registerCommand("shortcircuit.runAllTests", async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === "logicflow") {
        await runFileTests(editor.document);
      }
    }),

    vscode.commands.registerCommand("shortcircuit.formatDocument", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "logicflow") return;
      const text = editor.document.getText();
      const formatted = formatSource(text, {
        indent:
          editor.options.insertSpaces === false
            ? "\t"
            : typeof editor.options.tabSize === "number"
              ? editor.options.tabSize
              : 4,
      });
      if (formatted === text) return;
      const fullRange = new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(text.length),
      );
      await editor.edit((editBuilder) => {
        editBuilder.replace(fullRange, formatted);
      });
    }),
  );

  // 4. CodeLens provider for running tests
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: "logicflow" },
      {
        provideCodeLenses(document, token) {
          const lenses: vscode.CodeLens[] = [];
          const lines = document.getText().split("\n");
          for (let index = 0; index < lines.length; index += 1) {
            if (token.isCancellationRequested) break;
            const match = /^\s*TEST\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(lines[index] ?? "");
            if (!match) continue;
            const range = new vscode.Range(index, 0, index, lines[index]!.length);
            lenses.push(
              new vscode.CodeLens(range, {
                title: "▶ Run Test",
                command: "shortcircuit.runTest",
                arguments: [document.uri, new vscode.Position(index, 0)],
              }),
            );
          }
          return lenses;
        },
      },
    ),
  );

  // 5. Keep package caches fresh when manifests or external package files change
  const manifestWatcher = vscode.workspace.createFileSystemWatcher(
    "**/{manifest.json,shortcircuit.json,shortcircuit.lock.json}",
  );
  const logicflowWatcher = vscode.workspace.createFileSystemWatcher("**/*.lf");
  const onPackageFileChanged = () => schedulePackageRefresh(provider);
  context.subscriptions.push(
    manifestWatcher,
    logicflowWatcher,
    manifestWatcher.onDidChange(onPackageFileChanged),
    manifestWatcher.onDidCreate(onPackageFileChanged),
    manifestWatcher.onDidDelete(onPackageFileChanged),
    logicflowWatcher.onDidChange((uri) => {
      if (isOpenDocument(uri)) return;
      schedulePackageRefresh(provider);
    }),
    logicflowWatcher.onDidCreate(onPackageFileChanged),
    logicflowWatcher.onDidDelete(onPackageFileChanged),
  );

  // 6. Watch document and editor changes for live updates
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId !== "logicflow") return;
      const current = provider.getCurrentDocument();
      const active = vscode.window.activeTextEditor?.document;
      const isRelevant =
        current?.uri.toString() === event.document.uri.toString() ||
        active?.uri.toString() === event.document.uri.toString();
      if (!isRelevant) return;
      scheduleStudioUpdate(provider, event.document);
    }),

    vscode.window.onDidChangeActiveTextEditor((editor) => {
      cancelStudioUpdate();
      if (editor && editor.document.languageId === "logicflow") {
        provider.updateForDocument(editor.document);
      } else if (!editor) {
        const visible = visibleLogicflowDocument();
        if (visible) provider.updateForDocument(visible);
        else provider.clear();
      } else {
        const visible = visibleLogicflowDocument();
        if (visible) provider.updateForDocument(visible);
        else provider.clear();
      }
    }),

    vscode.workspace.onDidCloseTextDocument((closedDoc) => {
      if (provider.getCurrentDocument()?.uri.toString() === closedDoc.uri.toString()) {
        const remaining = visibleLogicflowDocument();
        if (remaining) provider.updateForDocument(remaining, { force: true });
        else provider.clear();
      }
    }),
  );

  // Initial update if an editor is already open
  const active = vscode.window.activeTextEditor;
  if (active && active.document.languageId === "logicflow") {
    provider.updateForDocument(active.document);
  } else {
    const visible = visibleLogicflowDocument();
    if (visible) provider.updateForDocument(visible);
  }
}

export function deactivate(): Thenable<void> | undefined {
  cancelStudioUpdate();
  if (packageRefreshTimer) {
    clearTimeout(packageRefreshTimer);
    packageRefreshTimer = undefined;
  }
  testOutputChannel?.dispose();
  testOutputChannel = undefined;
  studioProvider?.dispose();
  studioProvider = undefined;
  StudioPanel.currentPanel?.dispose();
  if (client) {
    return client.stop();
  }
  return undefined;
}

function visibleLogicflowDocument(): vscode.TextDocument | undefined {
  return vscode.window.visibleTextEditors.find(
    (editor) => editor.document.languageId === "logicflow",
  )?.document;
}

function isOpenDocument(uri: vscode.Uri): boolean {
  return vscode.workspace.textDocuments.some(
    (document) => document.uri.toString() === uri.toString(),
  );
}

function scheduleStudioUpdate(
  provider: ShortCircuitStudioProvider,
  document: vscode.TextDocument,
): void {
  cancelStudioUpdate();
  changeTimer = setTimeout(() => {
    changeTimer = undefined;
    if (document.isClosed) return;
    provider.updateForDocument(document);
  }, CHANGE_DELAY_MS);
}

function cancelStudioUpdate(): void {
  if (changeTimer) {
    clearTimeout(changeTimer);
    changeTimer = undefined;
  }
}

function schedulePackageRefresh(provider: ShortCircuitStudioProvider): void {
  if (packageRefreshTimer) clearTimeout(packageRefreshTimer);
  packageRefreshTimer = setTimeout(() => {
    packageRefreshTimer = undefined;
    provider.refresh();
  }, PACKAGE_REFRESH_DELAY_MS);
}

async function resolveCommandDocument(
  uri?: vscode.Uri,
): Promise<vscode.TextDocument | undefined> {
  if (uri) {
    const open = vscode.workspace.textDocuments.find(
      (document) => document.uri.toString() === uri.toString(),
    );
    if (open) return open;
    try {
      return await vscode.workspace.openTextDocument(uri);
    } catch {
      return undefined;
    }
  }
  return vscode.window.activeTextEditor?.document;
}

function getTestOutputChannel(): vscode.OutputChannel {
  if (!testOutputChannel) {
    testOutputChannel = vscode.window.createOutputChannel("Short Circuit Tests");
  }
  return testOutputChannel;
}

function collectOpenSources(): Map<string, string> {
  const sources = new Map<string, string>();
  for (const document of vscode.workspace.textDocuments) {
    if (document.languageId === "logicflow") {
      sources.set(path.resolve(document.fileName), document.getText());
    }
  }
  return sources;
}

function compileDocument(document: vscode.TextDocument): CompileResult {
  const source = document.getText();
  const context = document.fileName
    ? resolveWorkspaceContext(document.fileName, source, {
        openSources: collectOpenSources(),
      })
    : null;
  return compile(source, {
    packages: context?.bundle,
    implicitImports: context?.implicitImports,
    maxDiagnostics: 200,
  });
}

async function runFileTests(
  document: vscode.TextDocument,
  testName?: string,
): Promise<void> {
  const channel = getTestOutputChannel();
  channel.clear();
  channel.show(true);
  channel.appendLine(
    `=== Short Circuit tests for ${path.basename(document.fileName)} ===`,
  );
  channel.appendLine("");

  try {
    const result = compileDocument(document);
    const errors = result.diagnostics.filter(
      (diagnostic) => diagnostic.severity === "error",
    );
    if (errors.length > 0) {
      channel.appendLine(`Compilation failed with ${errors.length} error${errors.length === 1 ? "" : "s"}:`);
      for (const diagnostic of errors) {
        channel.appendLine(
          `  line ${diagnostic.line}:${diagnostic.column} [${diagnostic.code}] ${diagnostic.message}`,
        );
      }
      return;
    }

    if (result.tests.length === 0) {
      channel.appendLine("No TEST blocks were found in this file.");
      return;
    }

    const suitesToRun = testName
      ? result.tests.filter(
          (suite) => suite.name.toUpperCase() === testName.toUpperCase(),
        )
      : result.tests;

    if (testName && suitesToRun.length === 0) {
      channel.appendLine(`No test named "${testName}" was found in this file.`);
      channel.appendLine(
        `Available tests: ${result.tests.map((suite) => suite.name).join(", ") || "none"}`,
      );
      return;
    }

    const run = runTests({ tests: suitesToRun, circuits: result.circuits });
    const suites = run.suites;

    channel.appendLine(
      `${run.passed} passed, ${run.failed} failed${run.unsupported ? `, ${run.unsupported} unsupported` : ""} (${run.elapsedMs} ms)`,
    );
    channel.appendLine("");

    for (const suite of suites) {
      const status = !suite.runnable ? "UNSUPPORTED" : suite.pass ? "PASS" : "FAIL";
      channel.appendLine(`[${status}] ${suite.name} (line ${suite.line})`);
      if (suite.reason) channel.appendLine(`  ${suite.reason}`);

      for (const testCase of suite.cases) {
        channel.appendLine(
          `  ${testCase.pass ? "✓" : "✗"} ${testCase.label}${testCase.step ? ` (step ${testCase.step})` : ""}`,
        );
        if (testCase.error) channel.appendLine(`    ${testCase.error}`);
        for (const row of testCase.rows) {
          if (row.kind === "input") {
            channel.appendLine(`    INPUT ${row.name} = ${row.actual ?? "?"}`);
          } else if (row.pass) {
            channel.appendLine(`    EXPECT ${row.name} = ${row.expected ?? "?"}`);
          } else {
            channel.appendLine(
              `    EXPECT ${row.name} = ${row.expected ?? "?"} (actual ${row.actual ?? "?"})`,
            );
          }
        }
      }
      channel.appendLine("");
    }
  } catch (error) {
    channel.appendLine(
      `Test run failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

type StudioDerivedCache = Partial<Record<StudioDerivedKind, unknown>>;

/** Manages simulation state and communication with WebviewView (sidebar) and WebviewPanel */
export class ShortCircuitStudioProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private viewDisposables: vscode.Disposable[] = [];
  private currentDocument?: vscode.TextDocument;
  private lastCompiledKey?: string;
  private activeCircuitName?: string;
  private currentInputs: Record<string, string> = {};
  private activeSimulator?: Simulator;
  private activeCircuit?: CircuitIR;
  private lastModel?: StudioModel;
  private derivedCache: StudioDerivedCache = {};
  private disposed = false;

  constructor(private readonly extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.disposeViewListeners();
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = getStudioHtml(this.lastModel ?? null);

    this.viewDisposables.push(
      webviewView.webview.onDidReceiveMessage((message) => {
        void this.handleMessage(message);
      }),
      webviewView.onDidDispose(() => {
        if (this.view === webviewView) this.view = undefined;
        this.disposeViewListeners();
      }),
    );

    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.languageId === "logicflow") {
      this.updateForDocument(editor.document);
    } else if (this.currentDocument && !this.currentDocument.isClosed) {
      this.updateForDocument(this.currentDocument);
    } else {
      const visible = visibleLogicflowDocument();
      if (visible) this.updateForDocument(visible);
    }
  }

  public getModel(): StudioModel | undefined {
    return this.lastModel;
  }

  public getCurrentDocument(): vscode.TextDocument | undefined {
    return this.currentDocument;
  }

  public clear(): void {
    this.currentDocument = undefined;
    this.lastCompiledKey = undefined;
    this.lastModel = undefined;
    this.activeCircuit = undefined;
    this.activeSimulator = undefined;
    this.activeCircuitName = undefined;
    this.currentInputs = {};
    this.derivedCache = {};
    this.post({ type: "update", payload: null });
  }

  public refresh(): void {
    invalidatePackageCache();
    const active = vscode.window.activeTextEditor;
    if (active && active.document.languageId === "logicflow") {
      this.updateForDocument(active.document, { force: true });
      return;
    }
    const current =
      this.currentDocument && !this.currentDocument.isClosed
        ? this.currentDocument
        : undefined;
    if (current) {
      this.updateForDocument(current, { force: true });
      return;
    }
    const visible = visibleLogicflowDocument();
    if (visible) {
      this.updateForDocument(visible, { force: true });
      return;
    }
    this.clear();
  }

  public updateForDocument(
    document: vscode.TextDocument,
    options: { force?: boolean } = {},
  ): void {
    if (this.disposed || document.isClosed) return;

    const source = document.getText();
    const key = `${document.uri.toString()}\0${document.version}\0${source}`;
    if (!options.force && key === this.lastCompiledKey) return;

    const documentChanged =
      this.currentDocument?.uri.toString() !== document.uri.toString();
    if (documentChanged) {
      this.activeCircuitName = undefined;
      this.currentInputs = {};
      this.activeCircuit = undefined;
      this.activeSimulator = undefined;
    }

    this.currentDocument = document;
    this.lastCompiledKey = key;
    this.compileAndBroadcast(source);
  }

  public async handleMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== "object") return;
    const msg = message as { type?: string; [key: string]: unknown };

    switch (msg.type) {
      case "ready":
        if (this.lastModel) {
          this.post({ type: "update", payload: this.lastModel });
        }
        return;

      case "toggleInput": {
        const name = asString(msg.name);
        const input = this.activeCircuit?.inputs.find((entry) => entry.name === name);
        if (!input) return;
        const current = normalizeInputValue(this.currentInputs[input.name] ?? "0", input.width);
        const toggled = `${current.slice(0, -1)}${current.endsWith("1") ? "0" : "1"}`;
        this.currentInputs[input.name] = toggled;
        this.simulateAndBroadcast();
        return;
      }

      case "setInput": {
        const name = asString(msg.name);
        const input = this.activeCircuit?.inputs.find((entry) => entry.name === name);
        if (!input) return;
        const raw = asString(msg.value);
        try {
          // Normalize before storing, so invalid text never reaches the simulator.
          this.currentInputs[input.name] = formatBinary(
            parseSimulationInput(raw, input.width),
            input.width,
          );
        } catch {
          return;
        }
        this.simulateAndBroadcast();
        return;
      }

      case "flipBit": {
        const name = asString(msg.name);
        const input = this.activeCircuit?.inputs.find((entry) => entry.name === name);
        const bitIndex = Number(msg.bitIndex);
        if (!input || !Number.isInteger(bitIndex) || bitIndex < 0 || bitIndex >= input.width) {
          return;
        }
        const current = normalizeInputValue(this.currentInputs[input.name] ?? "0", input.width);
        const bit = inputBitAt(current, input.width, bitIndex);
        const next = bit === "1" ? "0" : "1";
        const position = input.width - 1 - bitIndex;
        this.currentInputs[input.name] =
          current.slice(0, position) + next + current.slice(position + 1);
        this.simulateAndBroadcast();
        return;
      }

      case "resetInputs":
        if (!this.activeCircuit) return;
        for (const input of this.activeCircuit.inputs) {
          this.currentInputs[input.name] = "0".repeat(input.width);
        }
        this.activeSimulator = new Simulator(this.activeCircuit);
        this.simulateAndBroadcast();
        return;

      case "stepClock": {
        if (!this.activeCircuit || !this.activeSimulator) return;
        const clockName =
          asString(msg.clock) ||
          (this.activeCircuit.events[0]
            ? this.clockNameFor(this.activeCircuit, this.activeCircuit.events[0].clock)
            : undefined);
        if (!clockName) return;
        try {
          this.activeSimulator.setInput(clockName, "0");
          this.activeSimulator.setInput(clockName, "1");
          const snapshot = this.activeSimulator.setInput(clockName, "0");
          this.currentInputs = normalizeInputs(
            this.activeCircuit,
            this.activeSimulator.getInputValues(),
          );
          this.applySnapshot(snapshot);
        } catch (error) {
          console.error("Step clock error:", error);
        }
        return;
      }

      case "selectCircuit": {
        const name = asString(msg.name);
        if (!name || !this.lastModel?.circuits.some((circuit) => circuit.name === name)) {
          return;
        }
        this.activeCircuitName = name;
        if (this.currentDocument) {
          this.updateForDocument(this.currentDocument, { force: true });
        }
        return;
      }

      case "expand":
        await vscode.commands.executeCommand("shortcircuit.expandStudio");
        return;

      case "refresh":
        this.refresh();
        return;

      case "requestData": {
        const kind = msg.kind;
        if (kind !== "truthTable" && kind !== "waveform" && kind !== "irText") {
          return;
        }
        this.sendDerived(kind);
        return;
      }

      default:
        return;
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.disposeViewListeners();
  }

  private disposeViewListeners(): void {
    while (this.viewDisposables.length > 0) {
      this.viewDisposables.pop()?.dispose();
    }
  }

  private compileAndBroadcast(source: string): void {
    this.derivedCache = {};
    const filePath = this.currentDocument?.fileName || "";

    try {
      const isMacroFile =
        /^\s*MACRO\b/im.test(source) ||
        filePath.replace(/\\/g, "/").includes("/macros/");

      if (isMacroFile) {
        const fileName = filePath ? path.basename(filePath) : "package macro";
        const { declarations, diagnostics } = parsePackageMacroSource(source, fileName);
        this.activeCircuit = undefined;
        this.activeSimulator = undefined;
        this.lastModel = this.emptyModel(
          declarations.map((declaration) => ({
            name: declaration.name,
            stats: { nodes: 0, states: 0, events: 0, maxDepth: 0, maxWidth: 0 },
            sequential: false,
            inputs: declaration.args.map((argument) => ({ name: argument, width: 1 })),
            outputs: [{ name: "out", width: 1 }],
          })),
          declarations[0]?.name ?? "",
          mapDiagnostics(diagnostics),
        );
        this.post({ type: "update", payload: this.lastModel });
        return;
      }

      const context = filePath
        ? resolveWorkspaceContext(filePath, source, {
            openSources: collectOpenSources(),
          })
        : null;
      const result = compile(source, {
        packages: context?.bundle,
        implicitImports: context?.implicitImports,
        maxDiagnostics: 100,
      });
      const diagnostics = mapDiagnostics(result.diagnostics);

      if (result.circuits.length === 0) {
        this.activeCircuit = undefined;
        this.activeSimulator = undefined;
        this.lastModel = this.emptyModel([], "", diagnostics);
        this.post({ type: "update", payload: this.lastModel });
        return;
      }

      let circuit = result.circuits.find(
        (candidate) => candidate.name === this.activeCircuitName,
      );
      if (!circuit) {
        circuit = result.circuits[0]!;
        this.activeCircuitName = circuit.name;
      }
      this.activeCircuit = circuit;

      this.currentInputs = normalizeInputs(circuit, this.currentInputs);
      let snapshot: SimulationSnapshot;
      try {
        this.activeSimulator = new Simulator(circuit);
        snapshot = this.activeSimulator.setInputs({ ...this.currentInputs });
      } catch (error) {
        this.activeSimulator = undefined;
        throw error;
      }

      let layout = null;
      try {
        layout = buildLayout(circuit);
      } catch (error) {
        diagnostics.push({
          message: `Could not build the circuit graph: ${error instanceof Error ? error.message : String(error)}`,
          severity: "warning",
          line: 1,
          column: 1,
        });
      }

      this.lastModel = {
        circuits: buildCircuitSummaries(result.circuits),
        activeCircuit: circuit.name,
        inputs: this.currentInputs,
        snapshot: snapshotToModel(snapshot),
        layout,
        truthTable: null,
        waveform: null,
        tests: buildTestsModel(result),
        ir: buildIrSummary(circuit),
        irText: null,
        diagnostics,
      };

      this.post({ type: "update", payload: this.lastModel });
    } catch (error) {
      const diagnostic: StudioDiagnostic = {
        message: `The studio could not compile this file: ${error instanceof Error ? error.message : String(error)}`,
        severity: "error",
        line: 1,
        column: 1,
      };
      this.activeCircuit = undefined;
      this.activeSimulator = undefined;
      this.lastModel = this.emptyModel([], "", [diagnostic]);
      this.post({ type: "update", payload: this.lastModel });
      console.error("Compilation error in StudioProvider:", error);
    }
  }

  private emptyModel(
    circuits: StudioModel["circuits"],
    activeCircuit: string,
    diagnostics: StudioDiagnostic[],
  ): StudioModel {
    return {
      circuits,
      activeCircuit,
      inputs: {},
      snapshot: null,
      layout: null,
      truthTable: null,
      waveform: null,
      tests: null,
      ir: null,
      irText: null,
      diagnostics,
    };
  }

  private simulateAndBroadcast(): void {
    if (!this.activeSimulator || !this.activeCircuit || !this.lastModel) return;

    try {
      const snapshot = this.activeSimulator.setInputs({ ...this.currentInputs });
      this.currentInputs = normalizeInputs(
        this.activeCircuit,
        this.activeSimulator.getInputValues(),
      );
      this.applySnapshot(snapshot);
    } catch (error) {
      console.error("Simulation error:", error);
    }
  }

  private applySnapshot(snapshot: SimulationSnapshot): void {
    if (!this.lastModel) return;
    this.lastModel.inputs = this.currentInputs;
    this.lastModel.snapshot = snapshotToModel(snapshot);
    this.post({
      type: "simulation",
      payload: {
        inputs: this.lastModel.inputs,
        snapshot: this.lastModel.snapshot,
      },
    });
  }

  private sendDerived(kind: StudioDerivedKind): void {
    if (!this.activeCircuit || !this.lastModel) return;
    const cached = this.derivedCache[kind];
    if (cached !== undefined) {
      this.post({ type: "derived", kind, payload: cached });
      return;
    }

    let payload: unknown;
    if (kind === "truthTable") {
      payload = buildTruthTable(this.activeCircuit);
      this.lastModel.truthTable = payload as StudioModel["truthTable"];
    } else if (kind === "waveform") {
      payload = buildWaveform(this.activeCircuit);
      this.lastModel.waveform = payload as StudioModel["waveform"];
    } else {
      payload = buildIrText(this.activeCircuit);
      this.lastModel.irText = payload as string;
    }

    this.derivedCache[kind] = payload;
    this.post({ type: "derived", kind, payload });
  }

  private clockNameFor(circuit: CircuitIR, clockNodeId: string): string | undefined {
    const node = circuit.nodes.find((candidate) => candidate.id === clockNodeId);
    return node?.inputName ?? clockNodeId;
  }

  private post(message: unknown): void {
    if (this.disposed) return;
    if (this.view) void this.view.webview.postMessage(message);
    StudioPanel.currentPanel?.postMessage(message);
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Full-page WebviewPanel (Beside editor) */
export class StudioPanel {
  public static currentPanel: StudioPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private disposed = false;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly provider: ShortCircuitStudioProvider,
    initialTab: "circuit" | "truth" | "waveform" | "tests" | "ir",
  ) {
    this.panel = panel;
    this.panel.webview.options = {
      enableScripts: true,
    };

    this.panel.webview.html = getStudioHtml(provider.getModel() ?? null, {
      initialTab,
    });

    this.panel.webview.onDidReceiveMessage(
      (message) => {
        void provider.handleMessage(message);
      },
      null,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.cleanup(), null, this.disposables);
  }

  public static createOrShow(
    provider: ShortCircuitStudioProvider,
    initialTab: "circuit" | "truth" | "waveform" | "tests" | "ir" = "circuit",
  ): void {
    if (StudioPanel.currentPanel) {
      StudioPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      StudioPanel.currentPanel.panel.webview.postMessage({
        type: "setTab",
        tab: initialTab,
      });
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "shortcircuitStudioPanel",
      "Short Circuit Studio",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    StudioPanel.currentPanel = new StudioPanel(panel, provider, initialTab);
  }

  public postMessage(message: unknown): void {
    if (this.disposed) return;
    void this.panel.webview.postMessage(message);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.cleanup();
    this.panel.dispose();
  }

  private cleanup(): void {
    if (this.disposed && StudioPanel.currentPanel !== this) return;
    this.disposed = true;
    if (StudioPanel.currentPanel === this) {
      StudioPanel.currentPanel = undefined;
    }
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }
}
