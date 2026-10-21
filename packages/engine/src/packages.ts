import defaultBundleJson from "../../../vendor/ShortCircuit-Packages/dist/packages.json";
import type {
  AssignmentAst,
  CircuitAst,
  ExpressionAst,
} from "./ast";
import { lex, type Token } from "./lexer";
import { Parser } from "./parser";
import type { CompileOptions, Diagnostic } from "./types";

export interface PackageMacroExport {
  kind: "macro";
  name: string;
  /** Package-relative path to the .lf source that declares the macro. */
  source: string;
  /** Inlined source, present in the bundled snapshot. */
  sourceText?: string;
  internal?: boolean;
  group?: string;
  summary?: string;
  widthRule?: string;
  tip?: string;
  docs?: string;
  docsText?: string;
  examples?: string[];
}

export interface PackageCircuitPort {
  name: string;
  width: number;
}

export interface PackageCircuitExport {
  kind: "circuit";
  name: string;
  group?: string;
  summary?: string;
  source: string;
  sourceText?: string;
  docs?: string;
  docsText?: string;
  tests?: string;
  testText?: string;
  ports?: {
    inputs: PackageCircuitPort[];
    outputs: PackageCircuitPort[];
  };
}

export type PackageExport = PackageMacroExport | PackageCircuitExport;

export interface PackageManifest {
  schema: "shortcircuit.package/v1";
  name: string;
  version: string;
  engine?: string;
  description?: string;
  recommendedAutoImport?: boolean;
  dependencies?: Record<string, string>;
  exports: PackageExport[];
}

export interface PackageBundle {
  schema: "shortcircuit.packages/v1";
  generatedAt?: string;
  packages: PackageManifest[];
}

export interface ResolvedPackageMacro extends PackageMacroExport {
  args: string[];
  minArgs: number;
  maxArgs: number | null;
  variadic: boolean;
  fold: string | null;
  body: string | null;
  signature: string;
  bodyAst: ExpressionAst | null;
  parseError: string | null;
  bodyCache: Map<number, { ast: ExpressionAst | null; error: string | null }>;
}

export interface PackageCircuitSource {
  packageName: string;
  packageVersion: string;
  circuit: PackageCircuitExport;
  ast: CircuitAst;
}

export interface PackageCatalog {
  readonly packages: PackageManifest[];
  readonly macros: Map<string, ResolvedPackageMacro>;
  readonly circuits: PackageCircuitSource[];
  readonly diagnostics: Diagnostic[];
}

export const DEFAULT_PACKAGE_BUNDLE = defaultBundleJson as unknown as PackageBundle;

const EMPTY_BUNDLE: PackageBundle = {
  schema: "shortcircuit.packages/v1",
  packages: [],
};

export interface ParsedPackageMacro {
  name: string;
  args: string[];
  variadic: boolean;
  body: string | null;
  fold: string | null;
  line: number;
  column: number;
}

/**
 * Parse a package macro source file.
 *
 * A macro source is a real LogicFlow file with one or more `MACRO` blocks:
 *
 *   MACRO AND(a, b, ...)
 *     BODY NOT(NAND(a, b, ...))
 *   END
 *
 *   MACRO XOR(a, b, ...)
 *     FOLD XOR2
 *   END
 *
 * The body is an ordinary expression. `BODY` and `FOLD` are package-file
 * declarations, not runtime operations. This keeps package implementations in
 * source files instead of JSON strings while leaving user circuits unchanged.
 */
export function parsePackageMacroSource(
  source: string,
  fileLabel = "package macro",
): { declarations: ParsedPackageMacro[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const tokens = lex(source, diagnostics);
  const declarations: ParsedPackageMacro[] = [];
  let index = 0;

  const peek = (): Token => tokens[index] ?? tokens[tokens.length - 1]!;
  const advance = (): Token => tokens[index++] ?? tokens[tokens.length - 1]!;
  const skipNewlines = () => {
    while (peek().kind === "newline") index += 1;
  };
  const isKeyword = (token: Token, value: string) =>
    token.kind === "identifier" && token.value.toUpperCase() === value;
  const error = (token: Token, message: string, hint?: string) => {
    diagnostics.push({
      code: "E601",
      severity: "error",
      message: `${fileLabel}: ${message}`,
      line: token.line,
      column: token.column,
      length: token.length || undefined,
      hint,
    });
  };
  const expectSymbol = (value: string, context: string): Token | null => {
    skipNewlines();
    const token = peek();
    if (token.kind === "symbol" && token.value === value) return advance();
    error(token, `${context} expected "${value}", found "${token.raw || "end of file"}".`);
    return null;
  };
  const expectKeyword = (value: string, context: string): Token | null => {
    skipNewlines();
    const token = peek();
    if (isKeyword(token, value)) return advance();
    error(token, `${context} expected ${value}, found "${token.raw || "end of file"}".`);
    return null;
  };

  while (true) {
    skipNewlines();
    if (peek().kind === "eof") break;
    if (!isKeyword(peek(), "MACRO")) {
      error(peek(), `only MACRO declarations are allowed in a package macro source.`);
      // Recover at the next line so one bad declaration does not hide the file.
      while (peek().kind !== "newline" && peek().kind !== "eof") index += 1;
      continue;
    }

    const macroToken = advance();
    skipNewlines();
    const nameToken = peek();
    if (nameToken.kind !== "identifier") {
      error(nameToken, `MACRO needs a name.`, "Write MACRO AND(a, b, ...) ... END.");
      while (peek().kind !== "newline" && peek().kind !== "eof") index += 1;
      continue;
    }
    advance();
    const name = nameToken.value;
    if (!expectSymbol("(", `macro ${name}`)) continue;

    const args: string[] = [];
    let variadic = false;
    let closed = false;
    while (!closed) {
      skipNewlines();
      const token = peek();
      if (token.kind === "symbol" && token.value === ")") {
        advance();
        closed = true;
        break;
      }
      if (
        token.kind === "symbol" && token.value === "." &&
        tokens[index + 1]?.kind === "symbol" && tokens[index + 1]?.value === "." &&
        tokens[index + 2]?.kind === "symbol" && tokens[index + 2]?.value === "."
      ) {
        index += 3;
        variadic = true;
        skipNewlines();
        if (!expectSymbol(")", `macro ${name} argument list`)) break;
        closed = true;
        break;
      }
      if (token.kind !== "identifier") {
        error(token, `macro ${name} argument list expected a parameter name or "...".`);
        while (peek().kind !== "newline" && peek().kind !== "eof") index += 1;
        break;
      }
      const arg = advance().value;
      if (args.includes(arg)) {
        error(token, `macro ${name} repeats parameter "${arg}".`);
      } else {
        args.push(arg);
      }
      skipNewlines();
      if (peek().kind === "symbol" && peek().value === ",") {
        advance();
        continue;
      }
      if (peek().kind === "symbol" && peek().value === ")") continue;
      error(peek(), `macro ${name} argument list expected "," or ")".`);
      while (peek().kind !== "newline" && peek().kind !== "eof") index += 1;
      break;
    }
    if (!closed) continue;

    skipNewlines();
    const mode = peek();
    if (!isKeyword(mode, "BODY") && !isKeyword(mode, "FOLD")) {
      error(mode, `macro ${name} needs a BODY or FOLD declaration.`, "Use BODY <expression> END or FOLD <binary-macro> END.");
      while (peek().kind !== "newline" && peek().kind !== "eof") index += 1;
      continue;
    }
    advance();

    if (isKeyword(mode, "FOLD")) {
      skipNewlines();
      const foldToken = peek();
      if (foldToken.kind !== "identifier") {
        error(foldToken, `macro ${name} FOLD needs a helper macro name.`);
        while (peek().kind !== "newline" && peek().kind !== "eof") index += 1;
        continue;
      }
      const fold = advance().value;
      if (!expectKeyword("END", `macro ${name}`)) continue;
      declarations.push({ name, args, variadic, body: null, fold, line: macroToken.line, column: macroToken.column });
      continue;
    }

    skipNewlines();
    const bodyStartToken = peek();
    let depth = 0;
    let bodyEnd = -1;
    for (let scan = index; scan < tokens.length; scan += 1) {
      const token = tokens[scan]!;
      if (token.kind === "eof") break;
      if (token.kind === "symbol" && (token.value === "(" || token.value === "[")) depth += 1;
      if (token.kind === "symbol" && (token.value === ")" || token.value === "]")) depth = Math.max(0, depth - 1);
      if (depth === 0 && isKeyword(token, "END")) {
        bodyEnd = scan;
        break;
      }
    }
    if (bodyEnd < 0) {
      error(macroToken, `macro ${name} BODY is missing END.`);
      break;
    }
    const body = source.slice(bodyStartToken.offset, tokens[bodyEnd]!.offset).trim();
    if (!body) {
      error(bodyStartToken, `macro ${name} has an empty BODY.`);
    } else {
      declarations.push({ name, args, variadic, body, fold: null, line: macroToken.line, column: macroToken.column });
    }
    index = bodyEnd + 1;
  }

  return { declarations, diagnostics };
}

function parseMacroBody(body: string, label: string): { ast: ExpressionAst | null; error: string | null } {
  try {
    const parser = new Parser(`CIRCUIT __PACKAGE_MACRO\n__value = ${body}\nEND`);
    const program = parser.parse();
    const diagnostics = parser.diagnostics.filter((entry) => entry.severity === "error");
    if (diagnostics.length > 0) {
      return {
        ast: null,
        error: `Package macro ${label} could not be parsed: ${diagnostics.map((entry) => entry.message).join(" ")}`,
      };
    }
    const circuit = program.circuits[0];
    const assignment = circuit?.body.find(
      (item): item is AssignmentAst => item.kind === "Assignment" && item.target[0]?.name === "__value",
    );
    if (!assignment) {
      return { ast: null, error: `Package macro ${label} has no body expression.` };
    }
    return { ast: assignment.value, error: null };
  } catch (error) {
    return {
      ast: null,
      error: `Package macro ${label} could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Parse a package macro body after variadic arguments have been substituted.
 * Package authors can use the ordinary expression grammar plus `...` in the
 * macro source. The macro parser is deliberately isolated from user circuits.
 */
export function parseMacroExpression(body: string, label: string): ExpressionAst {
  const parsed = parseMacroBody(body, label);
  if (!parsed.ast) throw new Error(parsed.error ?? `Invalid macro ${label}.`);
  return parsed.ast;
}

/** Expand a package macro body for a concrete call arity. */
export function macroBodyForArity(
  macro: ResolvedPackageMacro,
  arity: number,
): { ast: ExpressionAst | null; error: string | null; restNames: string[] } {
  const fixed = macro.args.length;
  const restNames = Array.from({ length: Math.max(0, arity - fixed) }, (_, index) => `__rest${index}`);
  if (!macro.variadic && arity !== fixed) {
    return { ast: null, error: null, restNames: [] };
  }
  if (macro.bodyAst && restNames.length === 0) {
    return { ast: macro.bodyAst, error: null, restNames };
  }
  const cached = macro.bodyCache.get(arity);
  if (cached) return { ...cached, restNames };

  let body = macro.body ?? "";
  if (macro.variadic) {
    body = body.replace(/\s*,\s*\.\.\./g, restNames.length > 0 ? `, ${restNames.join(", ")}` : "");
    if (body.includes("...")) {
      const error = `Package macro ${macro.name} has a misplaced ... placeholder.`;
      const result = { ast: null, error };
      macro.bodyCache.set(arity, result);
      return { ...result, restNames };
    }
  }
  const parsed = parseMacroBody(body, macro.name);
  macro.bodyCache.set(arity, parsed);
  return { ...parsed, restNames };
}

function parsePackageCircuit(
  manifest: PackageManifest,
  circuit: PackageCircuitExport,
  diagnostics: Diagnostic[],
): CircuitAst | null {
  if (!circuit.sourceText) return null;
  try {
    const parser = new Parser(circuit.sourceText);
    const program = parser.parse();
    const errors = parser.diagnostics.filter((entry) => entry.severity === "error");
    if (errors.length > 0) {
      for (const error of errors) {
        diagnostics.push({
          ...error,
          message: `${manifest.name} (${circuit.name}): ${error.message}`,
        });
      }
      return null;
    }
    const ast = program.circuits.find((entry) => entry.name === circuit.name);
    if (!ast) {
      diagnostics.push({
        code: "E999",
        severity: "error",
        message: `Package ${manifest.name} did not contain a circuit named ${circuit.name}.`,
        line: 1,
        column: 1,
      });
      return null;
    }
    return ast;
  } catch (error) {
    diagnostics.push({
      code: "E999",
      severity: "error",
      message: `Package ${manifest.name} circuit ${circuit.name} could not be parsed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      line: 1,
      column: 1,
    });
    return null;
  }
}

/**
 * Build the runtime catalog from one or more package bundles. The default bundle
 * is generated from the ShortCircuit-Packages submodule; hosts can add bundles
 * through CompileOptions without changing the engine.
 */
export function createPackageCatalog(bundles: PackageBundle[]): PackageCatalog {
  const packages: PackageManifest[] = [];
  const macros = new Map<string, ResolvedPackageMacro>();
  const circuits: PackageCircuitSource[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const bundle of bundles) {
    for (const manifest of bundle.packages) {
      packages.push(manifest);
      for (const item of manifest.exports) {
        if (item.kind === "macro") {
          if (!item.sourceText) {
            diagnostics.push({
              code: "E601",
              severity: "error",
              message: `Package ${manifest.name} macro ${item.name} has no source text.`,
              line: 1,
              column: 1,
            });
            continue;
          }
          const parsedFile = parsePackageMacroSource(item.sourceText, `${manifest.name}/${item.name}`);
          diagnostics.push(...parsedFile.diagnostics);
          const exported = parsedFile.declarations.find(
            (declaration) => declaration.name.toUpperCase() === item.name.toUpperCase(),
          );
          if (!exported) {
            diagnostics.push({
              code: "E601",
              severity: "error",
              message: `Package ${manifest.name} source ${item.source} does not declare MACRO ${item.name}.`,
              line: 1,
              column: 1,
            });
            continue;
          }

          // Register every declaration in the file. The manifest names the
          // public export; extra declarations are internal helpers.
          for (const declaration of parsedFile.declarations) {
            const key = declaration.name.toUpperCase();
            if (macros.has(key)) {
              diagnostics.push({
                code: "E601",
                severity: "error",
                message: `Package macro ${declaration.name} is defined by more than one package.`,
                line: declaration.line,
                column: declaration.column,
              });
              continue;
            }
            const isExport = declaration.name.toUpperCase() === item.name.toUpperCase();
            const metadata: PackageMacroExport = isExport
              ? item
              : {
                  kind: "macro",
                  name: declaration.name,
                  source: item.source,
                  sourceText: item.sourceText,
                  internal: true,
                };
            const variadic = declaration.variadic;
            const args = declaration.args;
            const signature = `${declaration.name}(${[...args, ...(variadic ? ["..."] : [])].join(", ")})`;
            let parsedBody: { ast: ExpressionAst | null; error: string | null } = {
              ast: null,
              error: null,
            };
            if (declaration.fold) {
              // Folds are expanded pairwise by compileMacroWithRefs.
            } else if (!declaration.body) {
              parsedBody = { ast: null, error: `Package macro ${declaration.name} has no body.` };
            } else if (variadic) {
              // Validate the variadic shape now, but keep the body AST null so
              // each call arity can splice its own rest arguments.
              const probeBody = declaration.body.replace(/\s*,\s*\.\.\./g, ", __rest0");
              const probe = parseMacroBody(probeBody, declaration.name);
              if (probe.error) {
                diagnostics.push({
                  code: "E601",
                  severity: "error",
                  message: `${manifest.name}: ${probe.error}`,
                  line: declaration.line,
                  column: declaration.column,
                });
              }
            } else {
              parsedBody = parseMacroBody(declaration.body, declaration.name);
              if (parsedBody.error) {
                diagnostics.push({
                  code: "E601",
                  severity: "error",
                  message: `${manifest.name}: ${parsedBody.error}`,
                  line: declaration.line,
                  column: declaration.column,
                });
              }
            }
            macros.set(key, {
              ...metadata,
              args,
              minArgs: args.length,
              maxArgs: variadic ? null : args.length,
              variadic,
              fold: declaration.fold,
              body: declaration.body,
              signature,
              bodyAst: parsedBody.ast,
              parseError: parsedBody.error,
              bodyCache: new Map(),
            });
          }
        } else {
          const ast = parsePackageCircuit(manifest, item, diagnostics);
          if (ast) {
            circuits.push({
              packageName: manifest.name,
              packageVersion: manifest.version,
              circuit: item,
              ast,
            });
          }
        }
      }
    }
  }

  return { packages, macros, circuits, diagnostics };
}

function normalizeBundle(input?: PackageBundle | PackageManifest[]): PackageBundle {
  if (!input) return EMPTY_BUNDLE;
  if (Array.isArray(input)) {
    return {
      schema: "shortcircuit.packages/v1",
      packages: input,
    };
  }
  return input;
}

/** Merge the default package snapshot with any host-provided packages. */
export function resolvePackageBundle(options: CompileOptions): PackageBundle {
  const bundles: PackageBundle[] = [];
  if (!options.disableDefaultPackages) bundles.push(DEFAULT_PACKAGE_BUNDLE);
  const custom = normalizeBundle(options.packages);
  if (custom.packages.length > 0) bundles.push(custom);
  return {
    schema: "shortcircuit.packages/v1",
    packages: bundles.flatMap((bundle) => bundle.packages),
  };
}

export function findPackageMacro(
  catalog: PackageCatalog,
  name: string,
): ResolvedPackageMacro | undefined {
  return catalog.macros.get(name.toUpperCase());
}

export function packageCircuitAsts(catalog: PackageCatalog): CircuitAst[] {
  return catalog.circuits.map((entry) => entry.ast);
}


/**
 * The default package catalog used by the editor and docs. Compilation builds
 * its own catalog from the current options, so this constant is safe to use for
 * read-only metadata such as completions.
 */
export const DEFAULT_PACKAGE_CATALOG = createPackageCatalog([DEFAULT_PACKAGE_BUNDLE]);

/** Public macros from the default packages, in manifest order. */
export const DEFAULT_PACKAGE_MACROS = [...DEFAULT_PACKAGE_CATALOG.macros.values()].filter(
  (macro) => !macro.internal,
);

/** Public package circuits from the default packages, in manifest order. */
export const DEFAULT_PACKAGE_CIRCUITS = DEFAULT_PACKAGE_CATALOG.circuits;
