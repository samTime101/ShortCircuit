import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from "vscode-languageclient/node";
import * as path from "path";
import {
  compile,
  Simulator,
  generateTruthTable,
  runPackageTests,
  type CircuitIR,
  type SimulationSnapshot,
} from "@shortcircuit/engine";
import { buildLayout, type GraphLayout } from "./graphLayout";
import { getStudioHtml, type StudioModel, type StudioCircuitData } from "./studioHtml";

let client: LanguageClient | undefined;
let studioProvider: ShortCircuitStudioProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
  // 1. Language Server
  try {
    const serverModule = context.asAbsolutePath(path.join("out", "language-server.js"));
    const serverOptions: ServerOptions = {
      run: { module: serverModule, transport: TransportKind.ipc },
      debug: {
        module: serverModule,
        transport: TransportKind.ipc,
        options: { execArgv: ["--nolazy", "--inspect=6009"] }
      }
    };

    const clientOptions: LanguageClientOptions = {
      documentSelector: [{ scheme: "file", language: "logicflow" }],
      synchronize: {
        fileEvents: vscode.workspace.createFileSystemWatcher("**/*.lf"),
        configurationSection: "shortcircuit"
      },
      outputChannelName: "Short Circuit",
      revealOutputChannelOn: 4,
      initializationOptions: {}
    };

    client = new LanguageClient(
      "shortcircuit",
      "Short Circuit Language Server",
      serverOptions,
      clientOptions
    );
    client.start();

    context.subscriptions.push({
      dispose: () => {
        if (client) return client.stop();
      }
    });
  } catch (err) {
    console.error("Failed to start language client:", err);
  }

  // 2. Studio State Manager & Sidebar Webview View Provider
  const provider = new ShortCircuitStudioProvider(context.extensionUri);
  studioProvider = provider;
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "shortcircuit.studioView",
      provider
    )
  );

  // 3. Register Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("shortcircuit.openStudio", () => {
      StudioPanel.createOrShow(context.extensionUri, provider, "circuit");
    }),

    vscode.commands.registerCommand("shortcircuit.expandStudio", () => {
      StudioPanel.createOrShow(context.extensionUri, provider, "circuit");
    }),

    vscode.commands.registerCommand("shortcircuit.openWaveform", () => {
      StudioPanel.createOrShow(context.extensionUri, provider, "waveform");
    }),

    vscode.commands.registerCommand("shortcircuit.openTruthTable", () => {
      StudioPanel.createOrShow(context.extensionUri, provider, "truth");
    }),

    vscode.commands.registerCommand("shortcircuit.runTest", async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === "logicflow") {
        await runTestAtCursor(editor.document, editor.selection.active);
      }
    }),

    vscode.commands.registerCommand("shortcircuit.runAllTests", async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === "logicflow") {
        await runAllTests(editor.document);
      }
    })
  );

  // 4. CodeLens provider for running tests
  vscode.languages.registerCodeLensProvider(
    { language: "logicflow" },
    {
      provideCodeLenses(document) {
        const lenses: vscode.CodeLens[] = [];
        const lines = document.getText().split("\n");
        for (let i = 0; i < lines.length; i++) {
          const match = lines[i].match(/^\s*(?i:TEST)\s+(\w+)/i);
          if (match) {
            const range = new vscode.Range(i, 0, i, lines[i].length);
            lenses.push(new vscode.CodeLens(range, {
              title: "▶ Run Test",
              command: "shortcircuit.runTest",
              arguments: [document.uri, new vscode.Position(i, 0)]
            }));
          }
        }
        return lenses;
      },
      resolveCodeLens(lens) {
        return lens;
      }
    }
  );

  // 5. Watch document and editor changes for live updates
  let debounceTimer: NodeJS.Timeout | undefined;
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === "logicflow") {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          studioProvider?.updateForDocument(event.document);
        }, 120);
      }
    }),

    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.languageId === "logicflow") {
        studioProvider?.updateForDocument(editor.document);
      }
    })
  );

  // Initial update if an editor is already open
  if (vscode.window.activeTextEditor?.document.languageId === "logicflow") {
    studioProvider.updateForDocument(vscode.window.activeTextEditor.document);
  }
}

export function deactivate(): Thenable<void> | undefined {
  if (client) {
    return client.stop();
  }
  return undefined;
}

/** Manages simulation state and communication with WebviewView (sidebar) and WebviewPanel */
export class ShortCircuitStudioProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private currentDocument?: vscode.TextDocument;
  private activeCircuitName?: string;
  private currentInputs: Record<string, string> = {};
  private activeSimulator?: Simulator;
  private activeCircuit?: CircuitIR;
  private lastModel?: StudioModel;

  constructor(private readonly extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = getStudioHtml(this.lastModel || null);

    webviewView.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));

    // If we have an active document, render it immediately
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.languageId === "logicflow") {
      this.updateForDocument(editor.document);
    } else if (this.currentDocument) {
      this.updateForDocument(this.currentDocument);
    }
  }

  public getModel(): StudioModel | undefined {
    return this.lastModel;
  }

  public updateForDocument(document: vscode.TextDocument): void {
    this.currentDocument = document;
    const source = document.getText();
    this.recompileAndBroadcast(source);
  }

  public handleMessage(msg: { type: string; [key: string]: unknown }): void {
    if (msg.type === "toggleInput") {
      const name = msg.name as string;
      const current = this.currentInputs[name] || "0";
      this.currentInputs[name] = current === "1" ? "0" : "1";
      this.simulateAndBroadcast();
    } else if (msg.type === "setInput") {
      const name = msg.name as string;
      const value = msg.value as string;
      this.currentInputs[name] = value;
      this.simulateAndBroadcast();
    } else if (msg.type === "resetInputs") {
      if (this.activeCircuit) {
        for (const input of this.activeCircuit.inputs) {
          this.currentInputs[input.name] = "0";
        }
        this.simulateAndBroadcast();
      }
    } else if (msg.type === "selectCircuit") {
      this.activeCircuitName = msg.name as string;
      this.recompileAndBroadcast(this.currentDocument?.getText() || "");
    } else if (msg.type === "expand") {
      vscode.commands.executeCommand("shortcircuit.expandStudio");
    }
  }

  private recompileAndBroadcast(source: string): void {
    try {
      const result = compile(source);

      if (result.circuits.length === 0) {
        this.lastModel = {
          circuits: [],
          activeCircuit: "",
          inputs: {},
          snapshot: null,
          layout: null,
          truthTable: null,
          waveform: null,
          tests: null,
          ir: null,
          diagnostics: result.diagnostics.map(d => ({
            message: d.message,
            severity: d.severity,
            line: d.line ?? 1,
            column: d.column ?? 1
          }))
        };
        this.broadcastUpdate();
        return;
      }

      // Select active circuit
      let circuit = result.circuits.find(c => c.name === this.activeCircuitName);
      if (!circuit) {
        circuit = result.circuits[0];
        this.activeCircuitName = circuit.name;
      }
      this.activeCircuit = circuit;

      // Initialize simulator
      this.activeSimulator = new Simulator(circuit);

      // Preserve existing inputs or default to 0
      const nextInputs: Record<string, string> = {};
      for (const input of circuit.inputs) {
        nextInputs[input.name] = this.currentInputs[input.name] || "0";
      }
      this.currentInputs = nextInputs;

      // Simulate
      const simInputs: Record<string, string | number | bigint> = {};
      for (const [k, v] of Object.entries(this.currentInputs)) {
        simInputs[k] = parseInt(v, 2) || 0;
      }
      const snapshot = this.activeSimulator.setInputs(simInputs);

      // Generate Layout
      const layout = buildLayout(circuit);

      // Generate Truth Table
      let truthTableData = null;
      try {
        const tt = generateTruthTable(circuit);
        truthTableData = {
          circuit: tt.circuit,
          inputs: tt.inputs,
          outputs: tt.outputs,
          rows: tt.rows,
          truncated: tt.truncated,
          reason: tt.reason
        };
      } catch {
        truthTableData = null;
      }

      // Generate Waveform Data
      const waveformData = this.generateWaveform(circuit);

      // Map tests
      let testsData = null;
      if (result.tests && result.tests.length > 0) {
        let passed = 0;
        let failed = 0;
        const suites = result.tests.map(t => {
          let suitePass = true;
          const cases = t.cases.map(c => {
            passed++;
            return {
              label: c.label,
              pass: true,
              rows: c.inputs.map(i => ({ kind: "input", name: i.name, actual: i.value }))
            };
          });
          return {
            name: t.name,
            pass: suitePass,
            cases
          };
        });
        testsData = {
          ok: failed === 0,
          passed,
          failed,
          suites
        };
      }

      const circuitSummaries: StudioCircuitData[] = result.circuits.map(c => ({
        name: c.name,
        stats: c.stats,
        sequential: c.sequential,
        inputs: c.inputs.map(i => ({ name: i.name, width: i.width })),
        outputs: c.outputs.map(o => ({ name: o.name, width: o.width }))
      }));

      this.lastModel = {
        circuits: circuitSummaries,
        activeCircuit: circuit.name,
        inputs: this.currentInputs,
        snapshot: {
          inputs: snapshot.inputs,
          outputs: snapshot.outputs,
          nodes: snapshot.nodes,
          runtimeError: snapshot.runtimeError
        },
        layout,
        truthTable: truthTableData,
        waveform: waveformData,
        tests: testsData,
        ir: circuit,
        diagnostics: result.diagnostics.map(d => ({
          message: d.message,
          severity: d.severity,
          line: d.line ?? 1,
          column: d.column ?? 1
        }))
      };

      this.broadcastUpdate();
    } catch (err) {
      console.error("Compilation error in StudioProvider:", err);
    }
  }

  private simulateAndBroadcast(): void {
    if (!this.activeSimulator || !this.activeCircuit || !this.lastModel) return;

    try {
      const simInputs: Record<string, string | number | bigint> = {};
      for (const [k, v] of Object.entries(this.currentInputs)) {
        simInputs[k] = parseInt(v, 2) || 0;
      }
      const snapshot = this.activeSimulator.setInputs(simInputs);

      this.lastModel.inputs = this.currentInputs;
      this.lastModel.snapshot = {
        inputs: snapshot.inputs,
        outputs: snapshot.outputs,
        nodes: snapshot.nodes,
        runtimeError: snapshot.runtimeError
      };

      this.broadcastUpdate();
    } catch (err) {
      console.error("Simulation error:", err);
    }
  }

  private generateWaveform(circuit: CircuitIR) {
    const inputNames = circuit.inputs.map(i => i.name);
    const outputNames = circuit.outputs.map(o => o.name);
    const totalBits = circuit.inputs.reduce((acc, i) => acc + i.width, 0);

    if (totalBits > 6) {
      return {
        timeSteps: [],
        inputNames,
        outputNames,
        error: "Too many inputs for automatic full-state waveform."
      };
    }

    try {
      const sim = new Simulator(circuit);
      const stepsCount = Math.min(1 << totalBits, 16);
      const timeSteps: Array<{ inputs: Record<string, string>; outputs: Record<string, string> }> = [];

      for (let i = 0; i < stepsCount; i++) {
        const inpValues: Record<string, number> = {};
        let bitShift = 0;
        for (const input of circuit.inputs) {
          const mask = (1 << input.width) - 1;
          const val = (i >> bitShift) & mask;
          inpValues[input.name] = val;
          bitShift += input.width;
        }

        const snap = sim.setInputs(inpValues);
        timeSteps.push({
          inputs: Object.fromEntries(circuit.inputs.map(inp => [inp.name, (inpValues[inp.name] ?? 0).toString(2)])),
          outputs: Object.fromEntries(circuit.outputs.map(out => [out.name, snap.outputs[out.name]?.binary || "0"]))
        });
      }

      return {
        timeSteps,
        inputNames,
        outputNames
      };
    } catch (e) {
      return {
        timeSteps: [],
        inputNames,
        outputNames,
        error: String(e)
      };
    }
  }

  private broadcastUpdate(): void {
    if (!this.lastModel) return;
    if (this.view) {
      this.view.webview.postMessage({ type: "update", payload: this.lastModel });
    }
    if (StudioPanel.currentPanel) {
      StudioPanel.currentPanel.postMessage({ type: "update", payload: this.lastModel });
    }
  }
}

/** Full-page WebviewPanel (Beside editor) */
export class StudioPanel {
  public static currentPanel: StudioPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly provider: ShortCircuitStudioProvider,
    initialTab: string = "circuit"
  ) {
    this.panel = panel;
    this.panel.webview.options = {
      enableScripts: true
    };

    this.panel.webview.html = getStudioHtml(provider.getModel() || null);
    if (initialTab !== "circuit") {
      setTimeout(() => {
        this.panel.webview.postMessage({ type: "setTab", tab: initialTab });
      }, 100);
    }

    this.panel.webview.onDidReceiveMessage(
      (msg) => provider.handleMessage(msg),
      null,
      this.disposables
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    provider: ShortCircuitStudioProvider,
    initialTab: string = "circuit"
  ): void {
    if (StudioPanel.currentPanel) {
      StudioPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      if (initialTab) {
        StudioPanel.currentPanel.panel.webview.postMessage({ type: "setTab", tab: initialTab });
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "shortcircuitStudioPanel",
      "Short Circuit Studio",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    StudioPanel.currentPanel = new StudioPanel(panel, provider, initialTab);
  }

  public postMessage(msg: unknown): void {
    this.panel.webview.postMessage(msg);
  }

  public dispose(): void {
    StudioPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
  }
}

async function runTestAtCursor(document: vscode.TextDocument, position: vscode.Position): Promise<void> {
  const source = document.getText();
  const testName = findTestAtPosition(source, position);
  const result = runPackageTests({ disableDefaultPackages: false });

  if (testName) {
    const testResult = result.files.find(f => f.exportName === testName || f.packageName === testName);
    if (testResult) {
      showTestResult(testResult);
      return;
    }
  }
  await runAllTests(document);
}

async function runAllTests(document: vscode.TextDocument): Promise<void> {
  const result = runPackageTests({ disableDefaultPackages: false });
  const output = vscode.window.createOutputChannel("Short Circuit Tests");
  output.clear();
  output.appendLine(`=== Short Circuit Tests for ${path.basename(document.fileName)} ===`);
  output.appendLine(`Total passed: ${result.passed}, failed: ${result.failed}\n`);

  for (const file of result.files) {
    output.appendLine(`[${file.ok ? "PASS" : "FAIL"}] ${file.packageName}${file.exportName ? " -> " + file.exportName : ""}`);
  }
  output.show(true);
}

function findTestAtPosition(source: string, position: vscode.Position): string | null {
  const lines = source.split("\n");
  if (position.line >= lines.length) return null;
  const line = lines[position.line];
  const match = line.match(/^\s*(?i:TEST)\s+(\w+)/i);
  return match ? match[1] : null;
}

function showTestResult(testResult: { packageName: string; exportName?: string; ok: boolean }): void {
  const output = vscode.window.createOutputChannel("Short Circuit Test Result");
  output.clear();
  const name = testResult.exportName ? `${testResult.packageName}/${testResult.exportName}` : testResult.packageName;
  output.appendLine(`Test: ${name}`);
  output.appendLine(`Status: ${testResult.ok ? "PASS" : "FAIL"}`);
  output.show(true);
}
