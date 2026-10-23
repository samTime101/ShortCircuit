import * as vscode from "vscode";
import { LanguageClient, TransportKind } from "vscode-languageclient/node";
import * as path from "path";
import { runPackageTestsCore } from "@shortcircuit/engine/core";
let client;
export function activate(context) {
    const serverModule = context.asAbsolutePath(path.join("out", "language-server.js"));
    const serverOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: { module: serverModule, transport: TransportKind.ipc, options: { execArgv: ["--nolazy", "--inspect=6009"] } }
    };
    const clientOptions = {
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
    context.subscriptions.push(vscode.commands.registerCommand("shortcircuit.openWaveform", () => {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === "logicflow") {
            WaveformPreviewPanel.createOrShow(context.extensionUri, editor.document);
        }
    }), vscode.commands.registerCommand("shortcircuit.openTruthTable", () => {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === "logicflow") {
            TruthTablePreviewPanel.createOrShow(context.extensionUri, editor.document);
        }
    }), vscode.commands.registerCommand("shortcircuit.runTest", async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === "logicflow") {
            await runTestAtCursor(editor.document, editor.selection.active);
        }
    }), vscode.commands.registerCommand("shortcircuit.runAllTests", async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === "logicflow") {
            await runAllTests(editor.document);
        }
    }));
    // CodeLens provider for test runs
    vscode.languages.registerCodeLensProvider({ language: "logicflow" }, {
        provideCodeLenses(document) {
            const lenses = [];
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
    });
    context.subscriptions.push({
        dispose: () => client.stop()
    });
}
export function deactivate() {
    if (client) {
        return client.stop();
    }
    return undefined;
}
async function runTestAtCursor(document, position) {
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
async function runAllTests(document) {
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
function findTestAtPosition(source, position) {
    const lines = source.split("\n");
    if (position.line >= lines.length)
        return null;
    const line = lines[position.line];
    const match = line.match(/TEST\s+(\w+)/);
    return match ? match[1] : null;
}
function getTestDisplayName(file) {
    return file.kind === "circuit" && file.exportName
        ? `${file.packageName}/${file.exportName}`
        : file.packageName;
}
function showTestResult(testResult) {
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
    static currentPanel;
    panel;
    extensionUri;
    disposables = [];
    constructor(panel, extensionUri) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.update();
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }
    static createOrShow(extensionUri, document) {
        if (WaveformPreviewPanel.currentPanel) {
            WaveformPreviewPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
            WaveformPreviewPanel.currentPanel.update(document);
            return;
        }
        const panel = vscode.window.createWebviewPanel("shortcircuitWaveform", "Waveform Preview", vscode.ViewColumn.Beside, {
            enableScripts: true,
            retainContextWhenHidden: true
        });
        WaveformPreviewPanel.currentPanel = new WaveformPreviewPanel(panel, extensionUri);
        WaveformPreviewPanel.currentPanel.update(document);
    }
    update(document) {
        const source = document?.getText() || "";
        this.panel.webview.html = this.getHtmlForWaveform(source);
    }
    getHtmlForWaveform(source) {
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
    dispose() {
        WaveformPreviewPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const d = this.disposables.pop();
            if (d)
                d.dispose();
        }
    }
}
class TruthTablePreviewPanel {
    static currentPanel;
    panel;
    extensionUri;
    disposables = [];
    constructor(panel, extensionUri) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.update();
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }
    static createOrShow(extensionUri, document) {
        if (TruthTablePreviewPanel.currentPanel) {
            TruthTablePreviewPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
            TruthTablePreviewPanel.currentPanel.update(document);
            return;
        }
        const panel = vscode.window.createWebviewPanel("shortcircuitTruthTable", "Truth Table Preview", vscode.ViewColumn.Beside, {
            enableScripts: true,
            retainContextWhenHidden: true
        });
        TruthTablePreviewPanel.currentPanel = new TruthTablePreviewPanel(panel, extensionUri);
        TruthTablePreviewPanel.currentPanel.update(document);
    }
    update(document) {
        const source = document?.getText() || "";
        this.panel.webview.html = this.getHtmlForTruthTable(source);
    }
    getHtmlForTruthTable(source) {
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
    dispose() {
        TruthTablePreviewPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const d = this.disposables.pop();
            if (d)
                d.dispose();
        }
    }
}
//# sourceMappingURL=extension.js.map