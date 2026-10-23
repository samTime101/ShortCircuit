import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from "vscode-languageclient/node";
import * as path from "path";
import { compileCore, runPackageTestsCore, generateTruthTable, Simulator, type CompileResult, type TestRunResult, type PackageTestReport, type PackageTestFileResult, type TestSuiteResult, type TestCaseResult, type TestRowResult } from "@shortcircuit/engine/core";

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
    let waveformData = "";
    let error = "";

    try {
      const result = compileCore(source, { disableDefaultPackages: true });
      if (result.circuits.length > 0) {
        const circuit = result.circuits[0];
        const simulator = new Simulator(circuit);
        
        const inputNames = simulator.inputNames;
        const outputNames = simulator.outputNames;
        const inputCount = inputNames.length;
        
        if (inputCount <= 4) {
          // Generate all input combinations for waveform
          const totalCombinations = Math.min(1 << inputCount, 16);
          const timeSteps: Array<{ inputs: Record<string, string>; outputs: Record<string, string> }> = [];
          
          for (let i = 0; i < totalCombinations; i++) {
            const inputValues: Record<string, string | number | bigint> = {};
            for (let j = 0; j < inputCount; j++) {
              const bit = (i >> j) & 1;
              inputValues[inputNames[j]] = bit;
            }
            
            const snapshot = simulator.setInputs(inputValues);
            
            timeSteps.push({
              inputs: Object.fromEntries(inputNames.map(name => [name, inputValues[name].toString()])),
              outputs: Object.fromEntries(outputNames.map(name => [name, snapshot.outputs[name]?.binary || "0"]))
            });
          }
          
          waveformData = JSON.stringify({ timeSteps, inputNames, outputNames }, null, 2);
        } else {
          error = "Too many inputs for full waveform simulation (max 4). Showing placeholder.";
        }
      } else {
        error = "No circuits found in source.";
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Waveform Preview</title>
  <style>
    body { font-family: var(--vscode-font-family); padding: 16px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    .container { max-width: 100%; overflow-x: auto; }
    .error { color: var(--vscode-errorForeground); padding: 16px; background: var(--vscode-inputValidation-errorBackground); border-radius: 4px; }
    .placeholder { text-align: center; padding: 40px; color: var(--vscode-descriptionForeground); }
    .waveform-container { font-family: monospace; font-size: 12px; line-height: 1.4; }
    .signal-row { margin-bottom: 8px; }
    .signal-name { display: inline-block; width: 80px; font-weight: bold; color: var(--vscode-symbolIcon-foreground); }
    .signal-value { display: inline-block; font-family: monospace; }
    .time-step { padding: 2px 0; }
    .time-label { color: var(--vscode-descriptionForeground); font-size: 11px; margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="container">
    <h2>Waveform Preview</h2>
    ${error ? `<div class="error">${error}</div>` : ""}
    ${waveformData ? `<div class="waveform-container" id="waveform"></div>` : `<div class="placeholder">No waveform data available</div>`}
  </div>
  <script>
    const data = ${waveformData || 'null'};
    if (data) {
      const container = document.getElementById('waveform');
      container.innerHTML = '<div class="time-label">Time steps: ' + data.timeSteps.length + '</div>';
      
      // Input signals
      for (const name of data.inputNames) {
        const row = document.createElement('div');
        row.className = 'signal-row';
        row.innerHTML = '<span class="signal-name">' + name + ' (in)</span> ' + 
          data.timeSteps.map((step: any, i: number) => 
            '<span class="signal-value" style="margin-right: 4px;">' + step.inputs[name] + '</span>'
          ).join('');
        container.appendChild(row);
      }
      
      // Output signals
      for (const name of data.outputNames) {
        const row = document.createElement('div');
        row.className = 'signal-row';
        row.innerHTML = '<span class="signal-name">' + name + ' (out)</span> ' + 
          data.timeSteps.map((step: any, i: number) => 
            '<span class="signal-value" style="margin-right: 4px;">' + step.outputs[name] + '</span>'
          ).join('');
        container.appendChild(row);
      }
    }
  </script>
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
    let tableHtml = "";
    let error = "";

    try {
      const result = compileCore(source, { disableDefaultPackages: true });
      
      if (result.circuits.length > 0) {
        const tables: string[] = [];
        
        for (const circuit of result.circuits) {
          try {
            const truthTable = generateTruthTable(circuit);
            
            let html = `<h3>${circuit.name}</h3>`;
            html += '<table style="border-collapse: collapse; width: 100%; max-width: 800px; margin: 20px auto;">';
            
            // Header
            html += '<thead><tr>';
            for (const input of truthTable.inputs) {
              html += `<th style="border: 1px solid var(--vscode-panel-border); padding: 8px; text-align: center; background: var(--vscode-editor-inactiveSelectionBackground);">${input.name}</th>`;
            }
            for (const output of truthTable.outputs) {
              html += `<th style="border: 1px solid var(--vscode-panel-border); padding: 8px; text-align: center; background: var(--vscode-editor-inactiveSelectionBackground);">${output.name}</th>`;
            }
            html += '</tr></thead>';
            
            // Rows
            html += '<tbody>';
            for (const row of truthTable.rows) {
              html += '<tr>';
              for (const input of truthTable.inputs) {
                html += `<td style="border: 1px solid var(--vscode-panel-border); padding: 8px; text-align: center;">${row.input[input.name]}</td>`;
              }
              for (const output of truthTable.outputs) {
                html += `<td style="border: 1px solid var(--vscode-panel-border); padding: 8px; text-align: center;">${row.output[output.name]}</td>`;
              }
              html += '</tr>';
            }
            html += '</tbody></table>';
            
            tables.push(html);
          } catch (e) {
            tables.push(`<p style="color: var(--vscode-errorForeground);">Could not generate truth table for ${circuit.name}: ${e instanceof Error ? e.message : String(e)}</p>`);
          }
        }
        
        tableHtml = tables.join('<hr style="margin: 30px 0;">');
      } else {
        error = "No circuits found in source.";
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Truth Table Preview</title>
  <style>
    body { font-family: var(--vscode-font-family); padding: 16px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    .error { color: var(--vscode-errorForeground); padding: 16px; background: var(--vscode-inputValidation-errorBackground); border-radius: 4px; }
    .placeholder { text-align: center; padding: 40px; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  ${error ? `<div class="error">${error}</div>` : ""}
  ${tableHtml || '<div class="placeholder">No truth table available</div>'}
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