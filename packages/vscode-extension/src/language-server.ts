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
  CompletionParams,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { fileURLToPath } from "url";
import * as path from "path";
import {
  compile,
  formatSource,
  parsePackageMacroSource,
  BUILTINS,
  BUILTIN_BY_NAME,
  KEYWORDS,
  type CompileResult,
  type Diagnostic as EngineDiagnostic,
  type PackageManifest,
} from "@shortcircuit/engine";
import {
  resolveWorkspaceContext,
  invalidatePackageCache,
  type ResolvedWorkspaceContext,
} from "./packageResolver";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

const VALIDATE_DELAY_MS = 140;
const validationTimers = new Map<string, NodeJS.Timeout>();

interface DocumentAnalysis {
  version: number;
  source: string;
  macro: boolean;
  result: CompileResult | null;
  diagnostics: EngineDiagnostic[];
  context: ResolvedWorkspaceContext;
}

const analyses = new Map<string, DocumentAnalysis>();

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
        triggerCharacters: [".", "(", "@", "\""],
      },
      hoverProvider: true,
      documentFormattingProvider: true,
    },
  };
  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    };
  }
  return result;
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    connection.client.register(DidChangeConfigurationNotification.type, undefined);
  }
});

connection.onDidChangeConfiguration(() => {
  invalidatePackageCache();
  analyses.clear();
  scheduleValidationOfAllDocuments();
});

connection.onDidChangeWatchedFiles(() => {
  invalidatePackageCache();
  analyses.clear();
  scheduleValidationOfAllDocuments();
});

documents.onDidChangeContent((change) => {
  scheduleValidation(change.document.uri);
});

documents.onDidClose((event) => {
  const timer = validationTimers.get(event.document.uri);
  if (timer) clearTimeout(timer);
  validationTimers.delete(event.document.uri);
  analyses.delete(event.document.uri);
});

connection.onShutdown(() => clearValidationTimers());
connection.onExit(() => clearValidationTimers());

function clearValidationTimers(): void {
  for (const timer of validationTimers.values()) clearTimeout(timer);
  validationTimers.clear();
}

function scheduleValidation(uri: string): void {
  const existing = validationTimers.get(uri);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    validationTimers.delete(uri);
    const document = documents.get(uri);
    if (document) void validateTextDocument(document);
  }, VALIDATE_DELAY_MS);
  validationTimers.set(uri, timer);
}

let revalidateAllTimer: NodeJS.Timeout | undefined;

function scheduleValidationOfAllDocuments(): void {
  if (revalidateAllTimer) clearTimeout(revalidateAllTimer);
  revalidateAllTimer = setTimeout(() => {
    revalidateAllTimer = undefined;
    for (const document of documents.all()) {
      void validateTextDocument(document);
    }
  }, VALIDATE_DELAY_MS);
}

function uriToPath(uri: string): string {
  try {
    return fileURLToPath(uri);
  } catch {
    return uri.replace(/^file:\/\//, "");
  }
}

/** Unsaved editor buffers, used to keep imported package sources current. */
function openSources(): Map<string, string> {
  const sources = new Map<string, string>();
  for (const document of documents.all()) {
    sources.set(path.resolve(uriToPath(document.uri)), document.getText());
  }
  return sources;
}

function isMacroFile(source: string, filePath: string): boolean {
  return (
    /^\s*MACRO\b/im.test(source) ||
    filePath.replace(/\\/g, "/").includes("/macros/")
  );
}

function analyzeDocument(document: TextDocument): DocumentAnalysis {
  const cached = analyses.get(document.uri);
  if (cached && cached.version === document.version && cached.source === document.getText()) {
    return cached;
  }

  const source = document.getText();
  const filePath = uriToPath(document.uri);
  const context = resolveWorkspaceContext(filePath, source, {
    openSources: openSources(),
  });
  const macro = isMacroFile(source, filePath);

  let result: CompileResult | null = null;
  let diagnostics: EngineDiagnostic[];

  if (macro) {
    const fileName = filePath ? path.basename(filePath) : "package macro";
    diagnostics = parsePackageMacroSource(source, fileName).diagnostics;
  } else {
    result = compile(source, {
      packages: context.bundle,
      implicitImports: context.implicitImports,
      maxDiagnostics: 100,
    });
    diagnostics = result.diagnostics;
  }

  const analysis: DocumentAnalysis = {
    version: document.version,
    source,
    macro,
    result,
    diagnostics,
    context,
  };
  analyses.set(document.uri, analysis);
  return analysis;
}

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  try {
    const analysis = analyzeDocument(textDocument);
    const diagnostics: Diagnostic[] = analysis.diagnostics.map(convertDiagnostic);
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
  } catch (err) {
    const diagnostics: Diagnostic[] = [
      {
        severity: DiagnosticSeverity.Error,
        range: Range.create(0, 0, 0, 0),
        message: err instanceof Error ? err.message : String(err),
        source: "shortcircuit",
      },
    ];
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
  }
}

function convertDiagnostic(d: EngineDiagnostic): Diagnostic {
  const startCol = Math.max(0, (d.column ?? 1) - 1);
  const startLine = Math.max(0, (d.line ?? 1) - 1);
  const length = Math.max(1, d.length ?? 1);
  const range = Range.create(startLine, startCol, startLine, startCol + length);
  return {
    severity:
      d.severity === "error"
        ? DiagnosticSeverity.Error
        : d.severity === "warning"
          ? DiagnosticSeverity.Warning
          : DiagnosticSeverity.Information,
    range,
    message: d.message,
    source: "shortcircuit",
    code: d.code,
  };
}

interface ImportedPackages {
  unqualified: Set<string>;
  aliases: Map<string, string>;
}

function readImports(source: string, implicit: string[] = []): ImportedPackages {
  const unqualified = new Set<string>(implicit);
  const aliases = new Map<string, string>();
  const importRegex = /^\s*IMPORT\s+"([^"]+)"(?:\s+AS\s+([A-Za-z_][A-Za-z0-9_]*))?/gim;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(source)) !== null) {
    if (match[2]) aliases.set(match[2].toUpperCase(), match[1]);
    else unqualified.add(match[1]);
  }
  return { unqualified, aliases };
}

function wordAt(
  line: string,
  character: number,
): { word: string; start: number; end: number; qualifier?: string } | null {
  const isWordCharacter = (value: string | undefined) =>
    value !== undefined && /[A-Za-z0-9_]/.test(value);

  // Hover positions may sit in the middle of a word. Walk out to the full
  // identifier instead of only looking at the text before the cursor.
  let index = Math.min(character, Math.max(0, line.length - 1));
  if (!isWordCharacter(line[index])) index = character - 1;
  if (index < 0 || !isWordCharacter(line[index])) return null;

  let start = index;
  while (start > 0 && isWordCharacter(line[start - 1])) start -= 1;
  let end = index + 1;
  while (end < line.length && isWordCharacter(line[end])) end += 1;

  const word = line.slice(start, end);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(word)) return null;

  const qualifierMatch = /([A-Za-z_][A-Za-z0-9_]*)\.$/.exec(line.slice(0, start));
  return {
    word,
    start,
    end,
    qualifier: qualifierMatch ? qualifierMatch[1] : undefined,
  };
}

connection.onCompletion(async (params: CompletionParams): Promise<CompletionItem[]> => {
  try {
    const items: CompletionItem[] = [];
    const document = documents.get(params.textDocument.uri);
    if (!document) return items;
    const source = document.getText();
    const filePath = uriToPath(document.uri);
    const context = resolveWorkspaceContext(filePath, source, {
      openSources: openSources(),
    });
    const imports = readImports(source, context.implicitImports);

    const line = source.split("\n")[params.position.line] ?? "";
    const beforeCursor = line.slice(0, params.position.character);
    const dotMatch = /([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)?$/.exec(beforeCursor);
    if (dotMatch) {
      const targetPackage = imports.aliases.get(dotMatch[1].toUpperCase());
      if (!targetPackage) return [];
      const pkg = context.bundle.packages.find((entry) => entry.name === targetPackage);
      if (!pkg) return [];
      return pkg.exports.map((entry) => packageExportCompletion(entry, pkg));
    }

    for (const builtin of BUILTINS) {
      items.push({
        label: builtin.name,
        kind: CompletionItemKind.Function,
        detail: builtin.signature,
        documentation: builtin.description,
      });
    }

    for (const keyword of KEYWORDS) {
      items.push({ label: keyword, kind: CompletionItemKind.Keyword });
    }

    const onImportLine = /^\s*IMPORT\b/i.test(beforeCursor);
    for (const pkg of context.bundle.packages) {
      items.push({
        label: onImportLine ? `"${pkg.name}"` : pkg.name,
        kind: CompletionItemKind.Module,
        detail: `Short Circuit Package (${pkg.version})`,
        documentation: pkg.description,
      });
    }

    // Only suggest exports from packages actually imported by this file.
    for (const pkg of context.bundle.packages) {
      if (!imports.unqualified.has(pkg.name)) continue;
      for (const entry of pkg.exports) {
        if ("internal" in entry && entry.internal) continue;
        items.push(packageExportCompletion(entry, pkg));
      }
    }

    return items;
  } catch {
    return [];
  }
});

function packageExportCompletion(
  entry: PackageManifest["exports"][number],
  pkg: PackageManifest,
): CompletionItem {
  return {
    label: entry.name,
    kind: entry.kind === "macro" ? CompletionItemKind.Snippet : CompletionItemKind.Class,
    detail: `${entry.name} (${pkg.name})`,
    documentation: entry.summary,
  };
}

connection.onHover(async (params: HoverParams): Promise<Hover | null> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const line = document.getText().split("\n")[params.position.line] ?? "";
  const found = wordAt(line, params.position.character);
  if (!found) return null;
  const upper = found.word.toUpperCase();
  const range = Range.create(
    params.position.line,
    found.start,
    params.position.line,
    found.end,
  );

  const builtin = BUILTIN_BY_NAME.get(upper);
  if (builtin) {
    return {
      contents: {
        kind: "markdown",
        value: `**${builtin.name}** — ${builtin.description}\n\n\`${builtin.signature}\`\n\n- **Width:** ${builtin.widthRule}\n- **Tip:** ${builtin.tip}\n\n\`${builtin.example.call}\` → \`${builtin.example.result}\` — ${builtin.example.note}`,
      },
      range,
    };
  }

  try {
    const analysis = analyzeDocument(document);
    const imports = readImports(
      analysis.source,
      analysis.context.implicitImports,
    );

    // Qualifier before the word (Alias.EXPORT).
    if (found.qualifier) {
      const packageName = imports.aliases.get(found.qualifier.toUpperCase());
      const pkg = packageName
        ? analysis.context.bundle.packages.find((entry) => entry.name === packageName)
        : undefined;
      const entry = pkg?.exports.find(
        (candidate) => candidate.name.toUpperCase() === upper,
      );
      if (pkg && entry) return { contents: packageHover(entry, pkg), range };
    }

    if (analysis.result) {
      const circuit = analysis.result.circuits.find(
        (candidate) => candidate.name.toUpperCase() === upper,
      );
      if (circuit) {
        const inputs = circuit.inputs.map((input) => `${input.name}: ${input.width}b`).join(", ");
        const outputs = circuit.outputs.map((output) => `${output.name}: ${output.width}b`).join(", ");
        const contents: MarkupContent = {
          kind: "markdown",
          value: `**${circuit.name}** — Digital Circuit\n\n- **Inputs:** \`${inputs || "none"}\`\n- **Outputs:** \`${outputs || "none"}\`\n- **Stats:** ${circuit.stats.nodes} nodes, ${circuit.stats.maxDepth} depth${circuit.sequential ? "\n- **Kind:** Sequential" : ""}`,
        };
        return { contents, range };
      }
    }

    // Unqualified package exports are visible only after an import.
    for (const pkg of analysis.context.bundle.packages) {
      if (!imports.unqualified.has(pkg.name)) continue;
      const entry = pkg.exports.find(
        (candidate) => candidate.name.toUpperCase() === upper,
      );
      if (entry) return { contents: packageHover(entry, pkg), range };
    }

    return null;
  } catch {
    return null;
  }
});

function packageHover(
  entry: PackageManifest["exports"][number],
  pkg: PackageManifest,
): MarkupContent {
  let portInfo = "";
  if (entry.kind === "circuit" && entry.ports) {
    const inputs = entry.ports.inputs?.map((input) => `${input.name}: ${input.width}b`).join(", ") ?? "";
    const outputs = entry.ports.outputs?.map((output) => `${output.name}: ${output.width}b`).join(", ") ?? "";
    portInfo = `\n\n- **Inputs:** \`${inputs || "none"}\`\n- **Outputs:** \`${outputs || "none"}\``;
  }
  return {
    kind: "markdown",
    value: `**${entry.name}** (${pkg.name})\n\n${entry.summary ?? ""}${entry.group ? `\n\n*${entry.group}*` : ""}${portInfo}`,
  };
}

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
    return [
      TextEdit.replace(
        Range.create(0, 0, document.lineCount, 0),
        formatted,
      ),
    ];
  } catch {
    return [];
  }
});

documents.listen(connection);
connection.listen();
