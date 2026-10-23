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
  TextEdit,
  DocumentFormattingParams,
  DidChangeConfigurationNotification,
  HoverParams,
  CompletionParams
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { fileURLToPath } from "url";
import * as path from "path";
import {
  compile,
  formatSource,
  parsePackageMacroSource,
  BUILTINS,
  KEYWORDS,
  type Diagnostic as EngineDiagnostic,
} from "@shortcircuit/engine";
import { resolveWorkspaceContext, invalidatePackageCache } from "./packageResolver";

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
      documentFormattingProvider: true,
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
  invalidatePackageCache();
  documents.all().forEach(validateTextDocument);
});

connection.onDidChangeWatchedFiles(() => {
  invalidatePackageCache();
  documents.all().forEach(validateTextDocument);
});

documents.onDidChangeContent(change => {
  validateTextDocument(change.document);
});

function uriToPath(uri: string): string {
  try {
    return fileURLToPath(uri);
  } catch {
    return uri.replace(/^file:\/\//, "");
  }
}

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  const source = textDocument.getText();
  const filePath = uriToPath(textDocument.uri);

  try {
    // Check if this is a package macro file (starts with MACRO or in macros/ directory)
    const isMacroFile = /^\s*MACRO\b/im.test(source) || filePath.replace(/\\/g, "/").includes("/macros/");
    if (isMacroFile) {
      const fileName = filePath ? path.basename(filePath) : "package macro";
      const { diagnostics: macroDiags } = parsePackageMacroSource(source, fileName);
      const diagnostics: Diagnostic[] = macroDiags.map((d: EngineDiagnostic) => convertDiagnostic(d));
      connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
      return;
    }

    const wsContext = resolveWorkspaceContext(filePath, source);
    const result = compile(source, {
      packages: wsContext.bundle,
      implicitImports: wsContext.implicitImports,
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

connection.onCompletion(async (params: CompletionParams): Promise<CompletionItem[]> => {
  try {
    const items: CompletionItem[] = [];
    const document = documents.get(params.textDocument.uri);
    const source = document ? document.getText() : "";
    const filePath = document ? uriToPath(document.uri) : "";
    const wsContext = filePath ? resolveWorkspaceContext(filePath, source) : null;

    // Check what the user has typed on the current line up to the cursor
    const line = source.split("\n")[params.position.line] || "";
    const beforeCursor = line.slice(0, params.position.character);

    // If typing after a dot (e.g. MyAlias.EX...), offer exports from the aliased package
    const dotMatch = /([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)?$/.exec(beforeCursor);
    if (dotMatch && wsContext) {
      const aliasName = dotMatch[1].toUpperCase();
      const importRegex = /^\s*IMPORT\s+"([^"]+)"\s+AS\s+([A-Za-z_][A-Za-z0-9_]*)/gim;
      let match: RegExpExecArray | null;
      let targetPkgName: string | undefined;
      while ((match = importRegex.exec(source)) !== null) {
        if (match[2].toUpperCase() === aliasName) {
          targetPkgName = match[1];
          break;
        }
      }
      if (targetPkgName) {
        const pkg = wsContext.bundle.packages.find((p) => p.name === targetPkgName);
        if (pkg) {
          return pkg.exports.map((exp) => ({
            label: exp.name,
            kind: exp.kind === "macro" ? CompletionItemKind.Snippet : CompletionItemKind.Class,
            detail: `${exp.name} (${pkg.name})`,
            documentation: exp.summary,
          }));
        }
      }
      return [];
    }

    // Built-in operations (structural engine kernel only)
    for (const b of BUILTINS) {
      items.push({
        label: b.name,
        kind: CompletionItemKind.Function,
        detail: b.signature,
        documentation: b.description,
      });
    }

    // Keywords
    for (const k of KEYWORDS) {
      items.push({
        label: k,
        kind: CompletionItemKind.Keyword,
      });
    }

    // Workspace package completions
    if (wsContext) {
      // Collect packages that are imported in this document
      const importedPackages = new Set<string>(wsContext.implicitImports);
      const importRegex = /^\s*IMPORT\s+"([^"]+)"(?:\s+AS\s+([A-Za-z_][A-Za-z0-9_]*))?/gim;
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(source)) !== null) {
        if (!match[2]) {
          // Unqualified import brings exports into file scope
          importedPackages.add(match[1]);
        }
      }

      // If typing on an IMPORT line, suggest available workspace packages
      const onImportLine = /^\s*IMPORT\b/i.test(beforeCursor);
      for (const pkg of wsContext.bundle.packages) {
        items.push({
          label: onImportLine ? `"${pkg.name}"` : pkg.name,
          kind: CompletionItemKind.Module,
          detail: `Short Circuit Package (${pkg.version})`,
        });
      }

      // ONLY suggest exports from packages that are actually imported in this file
      for (const pkg of wsContext.bundle.packages) {
        if (importedPackages.has(pkg.name)) {
          for (const exp of pkg.exports) {
            items.push({
              label: exp.name,
              kind: exp.kind === "macro" ? CompletionItemKind.Snippet : CompletionItemKind.Class,
              detail: `${exp.name} (${pkg.name})`,
              documentation: exp.summary,
            });
          }
        }
      }
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
  const filePath = uriToPath(document.uri);
  const position = params.position;
  const line = source.split("\n")[position.line] || "";

  try {
    const wsContext = resolveWorkspaceContext(filePath, source);
    const result = compile(source, {
      packages: wsContext.bundle,
      implicitImports: wsContext.implicitImports
    });

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

    // Check package exports
    for (const pkg of wsContext.bundle.packages) {
      for (const exp of pkg.exports) {
        const regex = new RegExp(`\\b${exp.name}\\b`, "i");
        const match = regex.exec(line);
        if (match) {
          const start = match.index;
          const end = start + match[0].length;
          if (position.character >= start && position.character <= end) {
            let portInfo = "";
            if (exp.kind === "circuit" && exp.ports) {
              const inps = exp.ports.inputs?.map(i => `${i.name}: ${i.width}b`).join(", ") ?? "";
              const outs = exp.ports.outputs?.map(o => `${o.name}: ${o.width}b`).join(", ") ?? "";
              portInfo = `\n\n- **Inputs:** \`${inps || "none"}\`\n- **Outputs:** \`${outs || "none"}\``;
            }
            const contents: MarkupContent = {
              kind: "markdown",
              value: `**${exp.name}** (${pkg.name})\n\n${exp.summary ?? ""}${portInfo}`
            };
            return { contents };
          }
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

connection.onDocumentFormatting((params: DocumentFormattingParams): TextEdit[] => {
  try {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    const text = document.getText();
    const tabSize = params.options?.tabSize ?? 4;
    const insertSpaces = params.options?.insertSpaces ?? true;
    const formatted = formatSource(text, {
      indent: insertSpaces ? tabSize : "\t",
    });
    if (formatted === text) return [];
    const lineCount = document.lineCount;
    return [
      TextEdit.replace(
        Range.create(0, 0, lineCount, 0),
        formatted
      )
    ];
  } catch {
    return [];
  }
});

documents.listen(connection);
connection.listen();
