import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from "vscode-languageclient/node";
import * as path from "path";
import { compileCore, runPackageTestsCore, generateTruthTable, type CompileResult, type TestRunResult, type PackageTestReport, type PackageTestFileResult, type TestSuiteResult, type TestCaseResult, type TestRowResult } from "@shortcircuit/engine/core";

let client: LanguageClient;

export function activate(context: vscode.ExtensionContext): void {
  const serverModule = context.asAbsolutePath(path.join("out", "language-server.js"));

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc, options: { execArgv: ["--nolazy", "--inspect=6009"] } }
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

  client = new LanguageClient("shortcircuit", "Short Circuit Language Server", serverOptions, clientOptions);

  client.start();

  context.subscriptions.push(
    vscode.commands.registerCommand("shortcircuit.openWaveform", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === "logicflow") {
        WaveformPreviewPanel.createOrShow(context.extensionUri, editor.document);
      }
    }),
    vscode.commands.registerCommand("shortcircuit.openTruthTable", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === "logicflow") {
        TruthTablePreviewPanel.createOrShow(context.extensionUri, editor.document);
      }
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

  // CodeLens provider for test runs
  vscode.languages.registerCodeLensProvider(
    { language: "logicflow" },
    {
      provideCodeLenses(document) {
        const lenses: vscode.CodeLens[] = [];
        const lines = document.getText().split("\n");
        for (let i = 0; i < lines.length; i++) {
          const match = lines[i].match(/^\s*TEST\s+(\w+)/);
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

  context.subscriptions.push({
    dispose: () => client.stop()
  });
}

export function deactivate(): Thenable<void> | undefined {
  if (client) {
    return client.stop();
  }
  return undefined;
}

async function runTestAtCursor(document: vscode.TextDocument, position: vscode.Position): Promise<void> {
  const source = document.getText();
  const result = runPackageTestsCore({ disableDefaultPackages: true });

  const testName = findTestAtPosition(source, position);
  if (testName) {
    const testResult = result.files.find(f => getTestDisplayName(f) === testName);
    if (testResult) {
      showTestResult(testResult);
    }
  }
}

async function runAllTests(document: vscode.TextDocument): Promise<void> {
  const result = runPackageTestsCore({ disableDefaultPackages: true });

  const output = vscode.window.createOutputChannel("Short Circuit Tests");
  output.clear();
  output.appendLine(`Test run for ${document.fileName}`);
  output.appendLine(`Passed: ${result.passed}, Failed: ${result.failed}`);
  output.show(true);

  for (const file of result.files) {
    const displayName = getTestDisplayName(file);
    output.appendLine(`\n${displayName}: ${file.ok ? "PASS" : "FAIL"}`);
    if (!file.ok && file.run) {
      for (const suite of file.run.suites) {
        output.appendLine(`  ${suite.name}: ${suite.pass ? "PASS" : "FAIL"}`);
        if (!suite.pass) {
          for (const caseResult of suite.cases) {
            output.appendLine(`    ${caseResult.label}: ${caseResult.pass ? "PASS" : "FAIL"}`);
            if (!caseResult.pass && caseResult.rows) {
              for (const row of caseResult.rows) {
                if (row.kind === "expect") {
                  output.appendLine(`      Expected: ${row.expected}`);
                  output.appendLine(`      Actual:   ${row.actual}`);
                }
              }
            }
          }
        }
      }
    }
  }
}

function findTestAtPosition(source: string, position: vscode.Position): string | null {
  const lines = source.split("\n");
  if (position.line >= lines.length) return null;
  const line = lines[position.line];
  const match = line.match(/TEST\s+(\w+)/);
  return match ? match[1] : null;
}

function getTestDisplayName(file: { packageName: string; packageVersion: string; kind: string; exportName?: string; ok: boolean }): string {
  return file.kind === "circuit" && file.exportName
    ? `${file.packageName}/${file.exportName}`
    : file.packageName;
}

function showTestResult(testResult: { packageName: string; packageVersion: string; kind: string; exportName?: string; ok: boolean; run?: TestRunResult | null }): void {
  const output = vscode.window.createOutputChannel("Short Circuit Test Result");
  output.clear();
  const displayName = getTestDisplayName(testResult);
  output.appendLine(`Test: ${displayName}`);
  output.appendLine(`Status: ${testResult.ok ? "PASS" : "FAIL"}`);
  if (testResult.run) {
    for (const suite of testResult.run.suites) {
      output.appendLine(`  ${suite.name}: ${suite.pass ? "PASS" : "FAIL"}`);
      if (!suite.pass) {
        for (const caseResult of suite.cases) {
          output.appendLine(`    ${caseResult.label}: ${caseResult.pass ? "PASS" : "FAIL"}`);
        }
      }
    }
  }
  output.show(true);
}

class WaveformPreviewPanel {
  public static currentPanel: WaveformPreviewPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.update();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  public static createOrShow(extensionUri: vscode.Uri, document: vscode.TextDocument): void {
    if (WaveformPreviewPanel.currentPanel) {
      WaveformPreviewPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      WaveformPreviewPanel.currentPanel.update(document);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "shortcircuitWaveform",
      "Waveform Preview",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    WaveformPreviewPanel.currentPanel = new WaveformPreviewPanel(panel, extensionUri);
    WaveformPreviewPanel.currentPanel.update(document);
  }

  private update(document?: vscode.TextDocument): void {
    const source = document?.getText() || "";
    this.panel.webview.html = this.getHtmlForWaveform(source);
  }

  private getHtmlForWaveform(source: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Waveform Preview</title>
  <style>
    body { font-family: var(--vscode-font-family); padding: 16px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    .placeholder { text-align: center; padding: 40px; color: var(--vscode-descriptionForeground); }
    .waveform-container { max-width: 100%; overflow-x: auto; }
  </style>
</head>
<body>
  <div class="waveform-container">
    <div class="placeholder">
      <h2>Waveform Preview</h2>
      <p>Waveform rendering will be implemented using the engine's simulator output.</p>
      <p>Source length: ${source.length} characters</p>
    </div>
  </div>
</body>
</html>`;
  }

  public dispose(): void {
    WaveformPreviewPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
  }
}

class TruthTablePreviewPanel {
  public static currentPanel: TruthTablePreviewPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.update();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  public static createOrShow(extensionUri: vscode.Uri, document: vscode.TextDocument): void {
    if (TruthTablePreviewPanel.currentPanel) {
      TruthTablePreviewPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      TruthTablePreviewPanel.currentPanel.update(document);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "shortcircuitTruthTable",
      "Truth Table Preview",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    TruthTablePreviewPanel.currentPanel = new TruthTablePreviewPanel(panel, extensionUri);
    TruthTablePreviewPanel.currentPanel.update(document);
  }

  private update(document?: vscode.TextDocument): void {
    const source = document?.getText() || "";
    this.panel.webview.html = this.getHtmlForTruthTable(source);
  }

  private getHtmlForTruthTable(source: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Truth Table Preview</title>
  <style>
    body { font-family: var(--vscode-font-family); padding: 16px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    .placeholder { text-align: center; padding: 40px; color: var(--vscode-descriptionForeground); }
    table { border-collapse: collapse; width: 100%; max-width: 600px; margin: 20px auto; }
    th, td { border: 1px solid var(--vscode-panel-border); padding: 8px; text-align: center; }
    th { background: var(--vscode-editor-inactiveSelectionBackground); }
  </style>
</head>
<body>
  <div class="placeholder">
    <h2>Truth Table Preview</h2>
    <p>Truth table generation will use the engine's \`generateTruthTable\` function.</p>
    <p>Source length: ${source.length} characters</p>
  </div>
</body>
</html>`;
  }

  public dispose(): void {
    TruthTablePreviewPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
  }
}