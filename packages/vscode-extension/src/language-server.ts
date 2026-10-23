import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  CompletionItem,
  CompletionItemKind,
  Hover,
  MarkupContent,
  Position,
  Range,
  DidChangeConfigurationNotification,
  CompletionParams,
  HoverParams
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { compileCore, type CompileResult, type Diagnostic as EngineDiagnostic } from "@shortcircuit/engine/core";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities;
  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );
  hasDiagnosticRelatedInformationCapability = !!(
    capabilities.textDocument &&
    capabilities.textDocument.publishDiagnostics &&
    capabilities.textDocument.publishDiagnostics.relatedInformation
  );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: [".", "(", "@"]
      },
      hoverProvider: true,
      diagnosticProvider: {
        interFileDependencies: true,
        workspaceDiagnostics: false
      }
    }
  };
  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true
      }
    };
  }
  return result;
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    connection.client.register(DidChangeConfigurationNotification.type, undefined);
  }
});

interface ShortCircuitSettings {
  registryUrl?: string;
  enablePreview?: boolean;
}

let globalSettings: ShortCircuitSettings = { enablePreview: true };
let documentSettings: Map<string, Thenable<ShortCircuitSettings>> = new Map();

connection.onDidChangeConfiguration(change => {
  if (hasConfigurationCapability) {
    documentSettings.clear();
  } else {
    globalSettings = <ShortCircuitSettings>(
      (change.settings.shortcircuit || {})
    );
  }
  documents.all().forEach(validateTextDocument);
});

function getDocumentSettings(resource: string): Thenable<ShortCircuitSettings> {
  if (!hasConfigurationCapability) {
    return Promise.resolve(globalSettings);
  }
  let result = documentSettings.get(resource);
  if (!result) {
    result = connection.workspace.getConfiguration({
      scopeUri: resource,
      section: "shortcircuit"
    });
    documentSettings.set(resource, result);
  }
  return result;
}

documents.onDidChangeContent(change => {
  validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  const settings = await getDocumentSettings(textDocument.uri);
  const source = textDocument.getText();

  try {
    const result = compileCore(source, {
      disableDefaultPackages: true,
      maxDiagnostics: 100
    });

    const diagnostics: Diagnostic[] = result.diagnostics.map((d: EngineDiagnostic) => convertDiagnostic(d));
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
  } catch (err) {
    const diagnostics: Diagnostic[] = [{
      severity: DiagnosticSeverity.Error,
      range: Range.create(0, 0, 0, 0),
      message: err instanceof Error ? err.message : String(err),
      source: "shortcircuit"
    }];
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
  }
}

function convertDiagnostic(d: EngineDiagnostic): Diagnostic {
  const range = Range.create(
    d.line - 1,
    d.column - 1,
    d.line - 1,
    (d.column - 1) + (d.length ?? 1)
  );
  return {
    severity: d.severity === "error" ? DiagnosticSeverity.Error :
              d.severity === "warning" ? DiagnosticSeverity.Warning :
              DiagnosticSeverity.Information,
    range,
    message: d.message,
    source: "shortcircuit",
    code: d.code
  };
}

connection.onCompletion(async (): Promise<CompletionItem[]> => {
  try {
    const items: CompletionItem[] = [];

    const builtins = ["NAND", "NOR", "AND", "OR", "XOR", "XNOR", "NOT", "BUF"];
    for (const b of builtins) {
      items.push({
        label: b,
        kind: CompletionItemKind.Function,
        detail: "Built-in gate"
      });
    }

    const keywords = ["CIRCUIT", "MACRO", "INPUT", "OUTPUT", "BODY", "END", "TEST", "CASE", "EXPECT", "IMPORT", "AS", "WIDTH"];
    for (const k of keywords) {
      items.push({
        label: k,
        kind: CompletionItemKind.Keyword
      });
    }

    return items;
  } catch {
    return [];
  }
});

connection.onHover(async (params: HoverParams): Promise<Hover | null> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const source = document.getText();
  const position = params.position;
  const offset = document.offsetAt(position);

  try {
    const result = compileCore(source, { disableDefaultPackages: true });

    // Check built-in gates
    const builtins = ["NAND", "NOR", "AND", "OR", "XOR", "XNOR", "NOT", "BUF"];
    for (const b of builtins) {
      const index = source.indexOf(b);
      if (index !== -1 && offset >= index && offset <= index + b.length) {
        const contents: MarkupContent = {
          kind: "markdown",
          value: `**${b}** — Built-in gate`
        };
        return { contents, range: Range.create(document.positionAt(index), document.positionAt(index + b.length)) };
      }
    }

    // Check user-defined circuits/macros from the compiled result
    for (const circuit of result.circuits) {
      const index = source.indexOf(circuit.name);
      if (index !== -1) {
        const start = index;
        const end = index + circuit.name.length;
        if (offset >= start && offset <= end) {
          const contents: MarkupContent = {
            kind: "markdown",
            value: `**${circuit.name}** — Circuit\n\nInputs: ${circuit.inputs.map(i => i.name).join(", ")}\nOutputs: ${circuit.outputs.map(o => o.name).join(", ")}`
          };
          return { contents, range: Range.create(document.positionAt(start), document.positionAt(end)) };
        }
      }
    }

    return null;
  } catch {
    return null;
  }
});

documents.listen(connection);
connection.listen();