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
  parseSimulationInput,
  type CircuitIR,
  type CompileResult,
  type SimulationSnapshot,
} from "@shortcircuit/engine";
import { getStudioHtml } from "./studioHtml";
import {
  findTestAtPosition,
  inputBitAt,
  normalizeInputs,
  normalizeInputValue,
  snapshotToModel,
  type StudioDerivedKind,
  type StudioDiagnostic,
  type StudioModel,
} from "./studioModel";
import {
  compileStudioSource,
  computeStudioDerived,
  type StudioCompileData,
  type StudioDerivedPayload,
} from "./studioCompute";
import { StudioWorkerClient } from "./studioWorkerClient";
import { resolveWorkspaceContext, invalidatePackageCache } from "./packageResolver";

let client: LanguageClient | undefined;
let studioProvider: ShortCircuitStudioProvider | undefined;
let changeTimer: NodeJS.Timeout | undefined;
let packageRefreshTimer: NodeJS.Timeout | undefined;
let testOutputChannel: vscode.OutputChannel | undefined;

const CHANGE_DELAY_MS = 180;
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
  const extensionVersion = (context.extension?.packageJSON?.version as string) || "0.1.3";
  const provider = new ShortCircuitStudioProvider(
    context.extensionUri,
    extensionVersion,
    context.asAbsolutePath(path.join("out", "studio-worker.js")),
  );
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
        // Focus changed to a webview, terminal, or sidebar panel.
        // Don't wipe the studio if the current document is still open.
        const visible = visibleLogicflowDocument();
        if (visible && visible.uri.toString() !== provider.getCurrentDocument()?.uri.toString()) {
          provider.updateForDocument(visible);
        }
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

function findTargetLogicflowDocument(
  provider: ShortCircuitStudioProvider,
): vscode.TextDocument | undefined {
  const active = vscode.window.activeTextEditor;
  if (active && active.document.languageId === "logicflow" && !active.document.isClosed) {
    return active.document;
  }
  const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
  if (activeTab && activeTab.input instanceof vscode.TabInputText) {
    const doc = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === (activeTab.input as vscode.TabInputText).uri.toString(),
    );
    if (doc && doc.languageId === "logicflow" && !doc.isClosed) {
      return doc;
    }
  }
  const current = provider.getCurrentDocument();
  if (current && !current.isClosed) {
    return current;
  }
  const visible = visibleLogicflowDocument();
  if (visible && !visible.isClosed) {
    return visible;
  }
  return vscode.workspace.textDocuments.find(
    (d) => d.languageId === "logicflow" && !d.isClosed,
  );
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

type StudioDerivedCache = Partial<Record<StudioDerivedKind, StudioDerivedPayload>>;

interface CompileJob {
  seq: number;
  document: vscode.TextDocument;
  source: string;
  filePath: string;
  forceReset: boolean;
  activeCircuitName?: string;
}

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
  private lastCompileData?: StudioCompileData;
  private derivedCache: StudioDerivedCache = {};
  private derivedPending = new Set<StudioDerivedKind>();
  private compileWorker?: StudioWorkerClient;
  private derivedWorker?: StudioWorkerClient;
  private compileSeq = 0;
  private compileInFlight = false;
  private queuedCompile?: CompileJob;
  private revision = 0;
  private disposed = false;
  private clockTimer?: NodeJS.Timeout;
  private runningClockName?: string;
  private clockSpeed = 2;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly extensionVersion: string = "0.1.3",
    workerPath?: string,
  ) {
    if (workerPath) {
      this.compileWorker = new StudioWorkerClient(workerPath, "studio compile");
      this.derivedWorker = new StudioWorkerClient(workerPath, "studio preview");
    }
  }

  public getVersion(): string {
    return this.extensionVersion;
  }

  public getRevision(): number {
    return this.revision;
  }

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
    webviewView.webview.html = getStudioHtml(this.lastModel ?? null, {
      version: this.extensionVersion,
      revision: this.revision,
    });

    this.viewDisposables.push(
      webviewView.webview.onDidReceiveMessage((message) => {
        void this.handleMessage(message);
      }),
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) this.ensureUpdated();
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

  /** True when at least one studio webview is actually on screen. */
  public isVisible(): boolean {
    if (this.view?.visible) return true;
    return StudioPanel.currentPanel?.isVisible() ?? false;
  }

  /** Recompiles the current document even if a hidden view skipped updates. */
  public ensureUpdated(): void {
    const document =
      this.currentDocument && !this.currentDocument.isClosed
        ? this.currentDocument
        : findTargetLogicflowDocument(this);
    if (document) this.updateForDocument(document, { force: true });
  }

  public clear(): void {
    this.stopClockRunner();
    this.compileSeq += 1;
    this.queuedCompile = undefined;
    this.revision += 1;
    this.currentDocument = undefined;
    this.lastCompiledKey = undefined;
    this.lastModel = undefined;
    this.lastCompileData = undefined;
    this.activeCircuit = undefined;
    this.activeSimulator = undefined;
    this.activeCircuitName = undefined;
    this.currentInputs = {};
    this.derivedCache = {};
    this.derivedPending.clear();
    this.derivedWorker?.restart();
    this.post({ type: "update", payload: null, revision: this.revision });
  }

  public refresh(): void {
    invalidatePackageCache();
    this.compileWorker?.invalidate();
    this.derivedWorker?.invalidate();
    this.derivedWorker?.restart();
    this.revision += 1;
    this.lastCompiledKey = undefined;
    this.lastCompileData = undefined;
    this.derivedCache = {};
    this.derivedPending.clear();

    // A hidden studio will pick up the refreshed state when it is shown.
    if (!this.isVisible()) return;

    const targetDoc = findTargetLogicflowDocument(this);
    if (targetDoc) {
      this.updateForDocument(targetDoc, { force: true, resetState: true });
      return;
    }
    this.clear();
  }

  public updateForDocument(
    document: vscode.TextDocument,
    options: { force?: boolean; resetState?: boolean } = {},
  ): void {
    if (this.disposed || document.isClosed) return;

    const source = document.getText();
    const key = `${document.uri.toString()}\0${document.version}\0${source}`;
    if (!options.force && key === this.lastCompiledKey) return;

    const documentChanged =
      this.currentDocument?.uri.toString() !== document.uri.toString();
    if (documentChanged || options.resetState) {
      this.stopClockRunner();
      this.activeCircuitName = undefined;
      this.currentInputs = {};
      this.activeCircuit = undefined;
      this.activeSimulator = undefined;
    }

    this.currentDocument = document;

    // Typing should stay free when the studio is not on screen. The next
    // visibility change (or the ready message) compiles the latest source.
    if (!options.force && !this.isVisible()) return;

    this.lastCompiledKey = key;
    this.enqueueCompile(
      document,
      source,
      Boolean(options.resetState),
      this.activeCircuitName,
    );
  }

  public async handleMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== "object") return;
    const msg = message as { type?: string; [key: string]: unknown };

    switch (msg.type) {
      case "ready":
        // A newly opened or restored webview needs the newest source, not the
        // cached model from before the studio was hidden. The compile queue
        // coalesces this with any job that is already running.
        this.ensureUpdated();
        if (!this.compileInFlight && !this.queuedCompile && this.lastModel) {
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
        this.stopClockRunner();
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
        this.stepClock(clockName);
        return;
      }

      case "startClock": {
        if (!this.activeCircuit || !this.activeSimulator) return;
        const clockName =
          asString(msg.clock) ||
          (this.activeCircuit.events[0]
            ? this.clockNameFor(this.activeCircuit, this.activeCircuit.events[0].clock)
            : undefined);
        const speed = typeof msg.speed === "number" ? msg.speed : 2;
        if (clockName) {
          this.startClockRunner(clockName, speed);
        }
        return;
      }

      case "stopClock": {
        this.stopClockRunner();
        return;
      }

      case "setClockSpeed": {
        const speed = typeof msg.speed === "number" ? msg.speed : 2;
        this.setClockSpeed(speed);
        return;
      }

      case "selectCircuit": {
        this.stopClockRunner();
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
        this.stopClockRunner();
        this.refresh();
        return;

      case "requestData": {
        const kind = msg.kind;
        if (
          kind !== "truthTable" &&
          kind !== "waveform" &&
          kind !== "tests" &&
          kind !== "irText"
        ) {
          return;
        }
        void this.sendDerived(kind);
        return;
      }

      default:
        return;
    }
  }

  public dispose(): void {
    this.stopClockRunner();
    this.disposed = true;
    this.compileWorker?.dispose();
    this.derivedWorker?.dispose();
    this.compileWorker = undefined;
    this.derivedWorker = undefined;
    this.disposeViewListeners();
  }

  private stepClock(clockName: string): void {
    if (!this.activeCircuit || !this.activeSimulator) return;
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
  }

  private startClockRunner(clockName: string, speed: number): void {
    this.stopClockRunner();
    this.runningClockName = clockName;
    this.clockSpeed = Math.max(1, Math.min(20, speed));
    const interval = Math.max(50, Math.round(1000 / this.clockSpeed));
    this.clockTimer = setInterval(() => {
      if (!this.activeCircuit || !this.activeSimulator || !this.runningClockName) {
        this.stopClockRunner();
        return;
      }
      this.stepClock(this.runningClockName);
    }, interval);
  }

  private stopClockRunner(): void {
    if (this.clockTimer) {
      clearInterval(this.clockTimer);
      this.clockTimer = undefined;
    }
    this.runningClockName = undefined;
  }

  private setClockSpeed(speed: number): void {
    this.clockSpeed = Math.max(1, Math.min(20, speed));
    if (this.clockTimer && this.runningClockName) {
      this.startClockRunner(this.runningClockName, this.clockSpeed);
    }
  }

  private disposeViewListeners(): void {
    while (this.viewDisposables.length > 0) {
      this.viewDisposables.pop()?.dispose();
    }
  }

  /**
   * Queues a compile and coalesces rapid edits. Only the newest job is kept,
   * and a stale worker result is discarded before it can reach the webview.
   */
  private enqueueCompile(
    document: vscode.TextDocument,
    source: string,
    resetState: boolean,
    activeCircuitName: string | undefined,
  ): void {
    const seq = this.compileSeq + 1;
    this.compileSeq = seq;
    this.queuedCompile = {
      seq,
      document,
      source,
      filePath: document.fileName || "",
      forceReset: resetState,
      activeCircuitName,
    };
    void this.runCompileQueue().catch((error) => {
      console.error("[ShortCircuit] Studio compile queue failed:", error);
    });
  }

  private async runCompileQueue(): Promise<void> {
    if (this.compileInFlight) return;
    this.compileInFlight = true;
    try {
      while (!this.disposed && this.queuedCompile) {
        const job = this.queuedCompile;
        this.queuedCompile = undefined;

        let data: StudioCompileData;
        try {
          data = await this.computeCompile(job);
        } catch (error) {
          if (!this.disposed && job.seq === this.compileSeq) {
            this.applyCompileFailure(job, error);
          }
          continue;
        }

        if (this.disposed || job.seq !== this.compileSeq) continue;
        this.applyCompileData(job, data);
      }
    } finally {
      this.compileInFlight = false;
    }
  }

  private async computeCompile(job: CompileJob): Promise<StudioCompileData> {
    const openSources = collectOpenSources();
    const worker = this.compileWorker;
    if (worker?.available) {
      try {
        const response = await worker.request({
          type: "compile",
          filePath: job.filePath,
          source: job.source,
          activeCircuitName: job.activeCircuitName,
          openSources: [...openSources.entries()],
        });
        if (response.type === "compileResult") return response.data;
        if (response.type === "error") throw new Error(response.message);
        throw new Error("Unexpected response from the studio compile worker.");
      } catch (error) {
        if (this.disposed) throw error;
        // A worker that is still healthy reported a real compile failure;
        // retrying synchronously would only throw again.
        if (worker.available) throw error;
        console.warn(
          "[ShortCircuit] Studio worker unavailable; compiling synchronously.",
          error,
        );
      }
    }

    return compileStudioSource(job.filePath, job.source, {
      activeCircuitName: job.activeCircuitName,
      openSources,
    });
  }

  private applyCompileData(job: CompileJob, data: StudioCompileData): void {
    this.revision += 1;
    this.resetDerivedForCompile();
    this.lastCompileData = data;

    if (data.macro || !data.activeCircuit) {
      this.stopClockRunner();
      this.activeCircuit = undefined;
      this.activeSimulator = undefined;
      this.lastModel = this.buildModel(data, {}, null);
      this.post({
        type: "update",
        payload: this.lastModel,
        forceReset: job.forceReset,
      });
      return;
    }

    const circuit = data.activeCircuit;
    this.activeCircuitName = data.activeCircuitName;
    this.activeCircuit = circuit;
    this.currentInputs = normalizeInputs(circuit, this.currentInputs);

    let snapshot: SimulationSnapshot;
    try {
      this.activeSimulator = new Simulator(circuit);
      snapshot = this.activeSimulator.setInputs({ ...this.currentInputs });
    } catch (error) {
      this.activeSimulator = undefined;
      this.applyCompileFailure(job, error);
      return;
    }

    this.lastModel = this.buildModel(
      data,
      this.currentInputs,
      snapshotToModel(snapshot),
    );
    this.post({
      type: "update",
      payload: this.lastModel,
      forceReset: job.forceReset,
    });
  }

  private buildModel(
    data: StudioCompileData,
    inputs: Record<string, string>,
    snapshot: StudioModel["snapshot"],
  ): StudioModel {
    return {
      circuits: data.circuits,
      activeCircuit: data.activeCircuitName,
      inputs,
      snapshot,
      layout: data.layout,
      truthTable: null,
      waveform: null,
      tests: null,
      ir: data.ir,
      irText: null,
      diagnostics: data.diagnostics,
      revision: this.revision,
      structureKey: data.structureKey,
      derivedKey: data.derivedKey,
    };
  }

  private applyCompileFailure(job: CompileJob, error: unknown): void {
    if (this.disposed) return;
    this.stopClockRunner();
    const diagnostic: StudioDiagnostic = {
      message: `The studio could not compile this file: ${error instanceof Error ? error.message : String(error)}`,
      severity: "error",
      line: 1,
      column: 1,
    };
    this.revision += 1;
    this.resetDerivedForCompile();
    this.lastCompileData = undefined;
    this.activeCircuit = undefined;
    this.activeSimulator = undefined;
    this.lastModel = this.emptyModel([], "", [diagnostic]);
    this.post({
      type: "update",
      payload: this.lastModel,
      forceReset: job.forceReset,
    });
    console.error("Compilation error in StudioProvider:", error);
  }

  /** Drops cached derived views and cancels an expensive background run. */
  private resetDerivedForCompile(): void {
    this.derivedCache = {};
    this.derivedPending.clear();
    if (this.derivedWorker?.busy) this.derivedWorker.restart();
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
      revision: this.revision,
      structureKey: "empty",
      derivedKey: "empty",
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

  private async sendDerived(kind: StudioDerivedKind): Promise<void> {
    if (this.disposed) return;
    if (!this.activeCircuit || !this.lastModel) {
      this.post({
        type: "derived",
        kind,
        payload: null,
        error: "No active circuit is available.",
      });
      return;
    }

    if (this.derivedPending.has(kind)) return;
    const cached = this.derivedCache[kind];
    if (cached !== undefined) {
      this.post({ type: "derived", kind, payload: cached });
      return;
    }

    const revision = this.revision;
    const circuit = this.activeCircuit;
    // Only tests need every compiled circuit; avoid cloning large IR arrays
    // across the worker boundary for the other views.
    const allCircuits =
      kind === "tests" ? (this.lastCompileData?.allCircuits ?? [circuit]) : [];
    const tests = kind === "tests" ? (this.lastCompileData?.tests ?? []) : [];
    this.derivedPending.add(kind);

    try {
      let payload: StudioDerivedPayload;
      const worker = this.derivedWorker;
      if (worker?.available) {
        try {
          const response = await worker.request({
            type: "derive",
            kind,
            circuit,
            allCircuits,
            tests,
          });
          if (response.type === "deriveResult") payload = response.payload;
          else if (response.type === "error") throw new Error(response.message);
          else throw new Error("Unexpected response from the studio preview worker.");
        } catch (error) {
          if (this.disposed) throw error;
          if (!worker.available && revision === this.revision) {
            console.warn(
              "[ShortCircuit] Studio worker unavailable; computing preview synchronously.",
              error,
            );
            payload = computeStudioDerived(kind, circuit, allCircuits, tests);
          } else {
            throw error;
          }
        }
      } else {
        payload = computeStudioDerived(kind, circuit, allCircuits, tests);
      }

      if (this.disposed || revision !== this.revision) return;

      this.derivedCache[kind] = payload;
      if (this.lastModel) {
        if (kind === "truthTable") {
          this.lastModel.truthTable = payload as StudioModel["truthTable"];
        } else if (kind === "waveform") {
          this.lastModel.waveform = payload as StudioModel["waveform"];
        } else if (kind === "tests") {
          this.lastModel.tests = payload as StudioModel["tests"];
        } else {
          this.lastModel.irText = payload as string;
        }
      }
      this.post({ type: "derived", kind, payload });
    } catch (error) {
      if (this.disposed || revision !== this.revision) return;
      this.post({
        type: "derived",
        kind,
        payload: null,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      // A newer compile clears this set and may start a fresh request for the
      // same kind; do not remove that newer request when this one settles.
      if (revision === this.revision) this.derivedPending.delete(kind);
    }
  }

  private clockNameFor(circuit: CircuitIR, clockNodeId: string): string | undefined {
    const node = circuit.nodes.find((candidate) => candidate.id === clockNodeId);
    return node?.inputName ?? clockNodeId;
  }

  private post(message: Record<string, unknown>): void {
    if (this.disposed) return;
    const envelope =
      typeof message.revision === "number"
        ? message
        : { ...message, revision: this.revision };
    if (this.view) void this.view.webview.postMessage(envelope);
    StudioPanel.currentPanel?.postMessage(envelope);
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
      version: provider.getVersion(),
      revision: provider.getRevision(),
    });

    this.panel.webview.onDidReceiveMessage(
      (message) => {
        void provider.handleMessage(message);
      },
      null,
      this.disposables,
    );

    this.panel.onDidChangeViewState(
      (event) => {
        if (event.webviewPanel.visible) provider.ensureUpdated();
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
      provider.ensureUpdated();
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

  public isVisible(): boolean {
    return !this.disposed && this.panel.visible;
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
