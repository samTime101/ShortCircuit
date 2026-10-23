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
  Range,
  DidChangeConfigurationNotification,
  HoverParams
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { compile, type Diagnostic as EngineDiagnostic } from "@shortcircuit/engine";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;

connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities;
  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: [".", "(", "@", "\""]
      },
      hoverProvider: true,
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
const documentSettings: Map<string, Thenable<ShortCircuitSettings>> = new Map();

connection.onDidChangeConfiguration(() => {
  if (hasConfigurationCapability) {
    documentSettings.clear();
  }
  documents.all().forEach(validateTextDocument);
});

documents.onDidChangeContent(change => {
  validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  const source = textDocument.getText();

  try {
    const result = compile(source, {
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
  const startCol = Math.max(0, (d.column ?? 1) - 1);
  const startLine = Math.max(0, (d.line ?? 1) - 1);
  const length = Math.max(1, d.length ?? 1);
  const range = Range.create(
    startLine,
    startCol,
    startLine,
    startCol + length
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

    const builtins = [
      "NAND", "NOR", "AND", "OR", "XOR", "XNOR", "NOT", "BUF", "BUFFER",
      "MUX", "CONCAT", "BROADCAST", "SLICE", "ZEXT", "SEXT", "REPEAT", "REVERSE",
      "HALF_ADDER", "FULL_ADDER", "ADD4", "ADD8"
    ];
    for (const b of builtins) {
      items.push({
        label: b,
        kind: CompletionItemKind.Function,
        detail: "Built-in component"
      });
    }

    const keywords = [
      "circuit", "macro", "input", "output", "end", "body", "state", "const",
      "import", "as", "test", "case", "expect", "load", "step", "cycle",
      "on", "rising_edge", "falling_edge", "bus"
    ];
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
  const line = source.split("\n")[position.line] || "";

  try {
    const result = compile(source);

    // Check circuit declaration or reference
    for (const circuit of result.circuits) {
      const regex = new RegExp(`\\b${circuit.name}\\b`, "i");
      const match = regex.exec(line);
      if (match) {
        const start = match.index;
        const end = start + match[0].length;
        if (position.character >= start && position.character <= end) {
          const inps = circuit.inputs.map(i => `${i.name}: ${i.width}b`).join(", ");
          const outs = circuit.outputs.map(o => `${o.name}: ${o.width}b`).join(", ");
          const contents: MarkupContent = {
            kind: "markdown",
            value: `**${circuit.name}** — Digital Circuit\n\n- **Inputs:** \`${inps || "none"}\`\n- **Outputs:** \`${outs || "none"}\`\n- **Stats:** ${circuit.stats.nodes} nodes, ${circuit.stats.maxDepth} depth`
          };
          return { contents };
        }
      }
    }

    // Check built-in functions
    const builtins = ["NAND", "NOR", "AND", "OR", "XOR", "XNOR", "NOT", "BUF", "BUFFER", "MUX", "CONCAT", "BROADCAST", "SLICE", "ZEXT", "SEXT", "REPEAT", "REVERSE"];
    for (const b of builtins) {
      const regex = new RegExp(`\\b${b}\\b`, "i");
      const match = regex.exec(line);
      if (match) {
        const start = match.index;
        const end = start + match[0].length;
        if (position.character >= start && position.character <= end) {
          const contents: MarkupContent = {
            kind: "markdown",
            value: `**${b}** — Short Circuit Built-in Component`
          };
          return { contents };
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
