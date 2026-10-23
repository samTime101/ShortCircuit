import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  loadLocalPackages,
  type LocalPackageLoad,
} from "./packages";
import {
  emptyLock,
  PACKAGE_SCHEMA,
  readLock,
  readRootState,
  storePackageDirectory,
  writeJson,
  writeLock,
  type RootContext,
  type RootState,
} from "./project";
import {
  defaultExportName,
  packageDirectoryName,
  parseDependencies,
  slugify,
  validateExportName,
  validatePackageName,
  validateVersion,
} from "./packageSpec";
import {
  packageIntegrity,
} from "./registry";
import { readPackageFiles } from "./installer";
import { runPackageTestsCore as runPackageTests } from "@shortcircuit/engine/core";
import type { CommandResult } from "./commands";

export interface PackageInitOptions {
  directory: string;
  name?: string;
  exportName?: string;
  kind?: string;
  description?: string;
  version?: string;
  license?: string;
  dependencies?: string;
  force?: boolean;
  yes?: boolean;
  interactive?: boolean;
}

interface Prompter {
  ask(label: string, defaultValue?: string): Promise<string>;
  close(): void;
}

function prompter(): Prompter {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  return {
    async ask(label: string, defaultValue = ""): Promise<string> {
      const suffix = defaultValue ? ` (${defaultValue})` : "";
      const answer = (await readline.question(`${label}${suffix}: `)).trim();
      return answer || defaultValue;
    },
    close() {
      readline.close();
    },
  };
}

const MACRO_EXPLANATION = `Package exports come in two kinds:

  MACRO   A reusable expression, such as AND(a, b) or XOR(a, b).
          Macros are expanded into the circuit that uses them.
  CIRCUIT A reusable circuit with ports, such as ADD4.
          Circuits are instantiated as nodes.

Choose CIRCUIT when the export needs named ports, internal state, or a stable
block boundary. Choose MACRO for small combinational expressions.`;

function packageJsonFor(options: {
  name: string;
  version: string;
  description: string;
  license: string;
  dependencies: string[];
}): Record<string, unknown> {
  return {
    name: options.name,
    version: options.version,
    description: options.description,
    license: options.license,
    ...(options.dependencies.length > 0
      ? {
          dependencies: Object.fromEntries(
            options.dependencies.map((dependency) => [dependency, "^0.1.0"]),
          ),
        }
      : {}),
  };
}

function manifestFor(options: {
  name: string;
  version: string;
  exportName: string;
  kind: "macro" | "circuit";
  description: string;
  dependencies: string[];
}): Record<string, unknown> {
  const macro = options.kind === "macro";
  const slug = slugify(options.exportName);
  const source = macro ? `macros/${slug}/macro.lf` : `circuits/${slug}/circuit.lf`;
  const docs = macro ? `docs/${slug}.md` : `circuits/${slug}/docs.md`;
  const tests = `tests/${packageDirectoryName(options.name)}.test.lf`;
  return {
    schema: PACKAGE_SCHEMA,
    name: options.name,
    version: options.version,
    engine: "^0.1.0",
    description: options.description,
    ...(options.dependencies.length > 0
      ? {
          dependencies: Object.fromEntries(
            options.dependencies.map((dependency) => [dependency, "^0.1.0"]),
          ),
        }
      : {}),
    tests,
    exports: [
      {
        kind: options.kind,
        name: options.exportName,
        source,
        group: macro ? "Macros" : "Circuits",
        summary: options.description,
        docs,
        examples: macro
          ? [`y = ${options.exportName}(a, b)`]
          : [`inst = ${options.exportName}(a, b)`, `y = inst.y`],
        ...(macro
          ? { widthRule: "Result width = common input width" }
          : {
              ports: {
                inputs: [
                  { name: "a", width: 1 },
                  { name: "b", width: 1 },
                ],
                outputs: [{ name: "y", width: 1 }],
              },
            }),
      },
    ],
  };
}

function macroSource(name: string): string {
  return `MACRO ${name}(a, b)
  BODY NAND(a, b)
END
`;
}

function circuitSource(name: string): string {
  return `CIRCUIT ${name}
  INPUT a
  INPUT b

  y = NAND(a, b)

  OUTPUT y
END
`;
}

function macroDocs(name: string): string {
  return `# ${name}

Describe what \`${name}\` does.

This scaffold uses the kernel \`NAND\` operation. Replace the body and this
documentation with the real behavior.

\`\`\`logicflow
y = ${name}(a, b)
\`\`\`
`;
}

function circuitDocs(name: string): string {
  return `# ${name}

Describe what \`${name}\` does.

## Ports

| Port | Direction | Width |
| --- | --- | --- |
| \`a\` | input | 1 |
| \`b\` | input | 1 |
| \`y\` | output | 1 |

This scaffold uses the kernel \`NAND\` operation. Replace the circuit and this
documentation with the real behavior.
`;
}

function macroTest(name: string): string {
  return `CIRCUIT ${name}_TEST
  INPUT a
  INPUT b

  y = ${name}(a, b)

  OUTPUT y
END

TEST ${name}_TEST
  CASE "both high"
    INPUT a = 1
    INPUT b = 1
    EXPECT y = 0
  END

  CASE "one high"
    INPUT a = 1
    INPUT b = 0
    EXPECT y = 1
  END
END
`;
}

function circuitTest(name: string): string {
  return `CIRCUIT ${name}_TEST
  INPUT a
  INPUT b

  gate = ${name}(a, b)
  y = gate.y

  OUTPUT y
END

TEST ${name}_TEST
  CASE "both high"
    INPUT a = 1
    INPUT b = 1
    EXPECT y = 0
  END

  CASE "one high"
    INPUT a = 1
    INPUT b = 0
    EXPECT y = 1
  END
END
`;
}

function ensureGitignore(directory: string): void {
  const path = join(directory, ".gitignore");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const entries = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  for (const entry of [".shortcircuit/", "dist/"]) entries.add(entry);
  writeFileSync(path, `${[...entries].join("\n")}\n`);
}

function writePackageFile(directory: string, path: string, contents: string): void {
  const file = join(directory, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

async function promptValue(
  interactive: boolean,
  prompt: Prompter | null,
  label: string,
  defaultValue: string,
): Promise<string> {
  if (!interactive || !prompt) return defaultValue;
  return prompt.ask(label, defaultValue);
}

export async function initPackage(options: PackageInitOptions): Promise<CommandResult> {
  const directory = resolve(options.directory);
  const interactive = options.interactive === true;
  const prompt = interactive ? prompter() : null;
  const output: string[] = [];
  if (interactive) process.stdout.write(`${MACRO_EXPLANATION}\n\n`);

  try {
    let name = options.name?.trim();
    if (!name) {
      if (!interactive || !prompt) {
        throw new Error(
          "Missing --name. Use --name @scope/package, or run interactively.",
        );
      }
      name = await prompt.ask("Package name", "@acme/parity");
    }
    name = validatePackageName(name);

    let exportName = options.exportName?.trim();
    if (!exportName) {
      exportName = await promptValue(
        interactive,
        prompt,
        "Public export name",
        defaultExportName(name),
      );
    }
    exportName = validateExportName(exportName);

    let kind = (options.kind ?? "macro").trim().toLowerCase();
    if (interactive && prompt && options.kind === undefined) {
      kind = (await prompt.ask("Export kind (macro or circuit)", "macro"))
        .trim()
        .toLowerCase();
    }
    if (kind !== "macro" && kind !== "circuit") {
      throw new Error(`Unknown export kind "${kind}". Use macro or circuit.`);
    }

    const description =
      (options.description ?? "").trim() ||
      (await promptValue(
        interactive,
        prompt,
        "Description",
        "A Short Circuit package.",
      ));
    const version = validateVersion(
      (options.version ?? "").trim() ||
        (await promptValue(interactive, prompt, "Version", "0.1.0")),
    );
    const license =
      (options.license ?? "").trim() ||
      (await promptValue(interactive, prompt, "License", "MIT"));
    const dependencyText =
      options.dependencies ??
      (interactive && prompt ? await prompt.ask("Dependencies (comma separated)", "") : "");
    const dependencies = parseDependencies(dependencyText);
    if (dependencies.includes(name)) {
      throw new Error("A package cannot depend on itself.");
    }

    if (existsSync(join(directory, "manifest.json")) && !options.force) {
      throw new Error(
        `A package already exists at ${directory}. Use --force to replace its generated files.`,
      );
    }
    mkdirSync(directory, { recursive: true });

    const manifest = manifestFor({
      name,
      version,
      exportName,
      kind: kind as "macro" | "circuit",
      description,
      dependencies,
    });
    const exported = (manifest.exports as Array<Record<string, unknown>>)[0]!;
    const sourcePath = String(exported.source);
    const docsPath = String(exported.docs);
    const testPath = String(manifest.tests);

    writeJson(join(directory, "package.json"), packageJsonFor({
      name,
      version,
      description,
      license,
      dependencies,
    }));
    writeJson(join(directory, "manifest.json"), manifest);
    writePackageFile(
      directory,
      sourcePath,
      kind === "macro" ? macroSource(exportName) : circuitSource(exportName),
    );
    writePackageFile(
      directory,
      docsPath,
      kind === "macro" ? macroDocs(exportName) : circuitDocs(exportName),
    );
    writePackageFile(
      directory,
      testPath,
      kind === "macro" ? macroTest(exportName) : circuitTest(exportName),
    );
    writeLock(
      {
        kind: "package",
        root: directory,
        manifestPath: join(directory, "manifest.json"),
        lockPath: join(directory, "shortcircuit.lock.json"),
      },
      emptyLock(),
    );
    ensureGitignore(directory);

    if (!interactive) output.push(`${MACRO_EXPLANATION}\n`);
    output.push(`Created package ${name}@${version} in ${directory}`);
    output.push(`  ${sourcePath}`);
    output.push(`  ${docsPath}`);
    output.push(`  ${testPath}`);
    output.push("");
    output.push("Next:");
    output.push("  shortcircuit package test");
    output.push("  shortcircuit package check");
    output.push(`  shortcircuit package link ${name}   # from a project root`);
    return { code: 0, stdout: `${output.join("\n")}\n`, stderr: "" };
  } finally {
    prompt?.close();
  }
}

export interface PackageEnvironment {
  load: LocalPackageLoad;
  state: RootState;
}

export function loadPackageEnvironment(context: RootContext): PackageEnvironment {
  const state = readRootState(context);
  const lock = readLock(context);
  const paths = [context.root];

  for (const [name, entry] of Object.entries(lock.packages)) {
    if (name === state.name) continue;
    const directory =
      entry.type === "path"
        ? resolve(context.root, entry.path ?? ".")
        : storePackageDirectory(context.root, name);
    if (!existsSync(join(directory, "manifest.json"))) {
      throw new Error(
        `Package ${name} is not installed at ${directory}. Run shortcircuit package install.`,
      );
    }
    paths.push(directory);
  }

  for (const name of Object.keys(state.dependencies)) {
    if (name === state.name) continue;
    if (!lock.packages[name]) {
      throw new Error(
        `Dependency ${name} is not installed. Run shortcircuit package install.`,
      );
    }
  }

  return { load: loadLocalPackages(paths), state };
}

export function buildPackage(context: RootContext): CommandResult {
  const load = loadLocalPackages([context.root]);
  const state = readRootState(context);
  const manifest = load.bundle.packages.find((entry) => entry.name === state.name);
  if (!manifest) {
    throw new Error(`Package ${state.name ?? context.root} was not loaded.`);
  }
  const out = join(context.root, "dist", "packages.json");
  writeJson(out, {
    schema: "shortcircuit.packages/v1",
    generatedAt: new Date().toISOString(),
    packages: [manifest],
  });
  return {
    code: 0,
    stdout:
      `Built ${manifest.name}@${manifest.version}: ${manifest.exports.length} export` +
      `${manifest.exports.length === 1 ? "" : "s"}.\n${out}\n`,
    stderr: "",
  };
}

export function testPackage(context: RootContext): CommandResult {
  const { load, state } = loadPackageEnvironment(context);
  const report = runPackageTests({
    packages: load.bundle,
    disableDefaultPackages: true,
  });
  const lines: string[] = [];
  for (const file of report.files) {
    const label =
      file.kind === "package"
        ? `${file.packageName}@${file.packageVersion} package tests`
        : `${file.packageName}@${file.packageVersion} ${file.exportName} tests`;
    lines.push(`${file.ok ? "PASS" : "FAIL"}  ${label}`);
    for (const diagnostic of file.diagnostics) {
      lines.push(
        `  ${diagnostic.severity}  ${diagnostic.code}  ${diagnostic.line}:${diagnostic.column}  ${diagnostic.message}`,
      );
    }
    if (file.run) {
      for (const suite of file.run.suites) {
        lines.push(`  ${suite.pass ? "pass" : "fail"}  ${suite.name}`);
      }
    }
  }
  lines.push("");
  lines.push(
    `${report.passed} passed, ${report.failed} failed, ${report.unsupported} unsupported (${report.elapsedMs.toFixed(1)} ms)`,
  );
  if (report.files.length === 0) {
    lines.push(`No tests declared by ${state.name ?? context.root}.`);
  }
  return {
    code: report.ok ? 0 : 1,
    stdout: `${lines.join("\n")}\n`,
    stderr: "",
  };
}

export function checkPackage(context: RootContext): CommandResult {
  const build = buildPackage(context);
  if (build.code !== 0) return build;
  const test = testPackage(context);
  return {
    code: test.code,
    stdout: `${build.stdout}\n${test.stdout}`,
    stderr: test.stderr,
  };
}

export interface RegisterOptions {
  dryRun?: boolean;
  out?: string;
  json?: boolean;
}

export function registerPackage(
  context: RootContext,
  options: RegisterOptions = {},
): CommandResult {
  const state = readRootState(context);
  if (!state.name || !state.version) {
    throw new Error("A package manifest needs a name and version before registering.");
  }
  for (const [name, spec] of Object.entries(state.dependencies)) {
    if (spec.startsWith("path:")) {
      throw new Error(
        `Package ${state.name} depends on ${name} through a path link. ` +
          "Replace path dependencies with registry versions before registering.",
      );
    }
  }

  const check = checkPackage(context);
  if (check.code !== 0) return check;

  const files = readPackageFiles(context.root);
  const integrity = packageIntegrity(files);
  const directory = packageDirectoryName(state.name);
  const registryEntry = {
    name: state.name,
    version: state.version,
    manifest: `packages/${directory}/manifest.json`,
  };
  const submission = {
    schema: "shortcircuit.submission/v1",
    generatedAt: new Date().toISOString(),
    registryEntry,
    integrity,
    files,
  };

  if (options.dryRun) {
    return {
      code: 0,
      stdout: `${JSON.stringify(
        {
          registryEntry,
          integrity,
          files: Object.keys(files).sort(),
        },
        null,
        2,
      )}\n`,
      stderr: "",
    };
  }

  const outDirectory = resolve(
    context.root,
    options.out ?? join(".shortcircuit", "register", `${directory}-${state.version}`),
  );
  const submissionPath = join(outDirectory, "submission.json");
  writeJson(submissionPath, submission);
  for (const [path, contents] of Object.entries(files)) {
    writePackageFile(join(outDirectory, "package"), path, contents);
  }

  if (options.json) {
    return {
      code: 0,
      stdout: `${JSON.stringify({ submission: submissionPath, registryEntry, integrity }, null, 2)}\n`,
      stderr: "",
    };
  }
  return {
    code: 0,
    stdout:
      `Created registration submission for ${state.name}@${state.version}.\n` +
      `  ${submissionPath}\n` +
      `  integrity ${integrity}\n\n` +
      "Open a pull request against the package registry and copy the package files " +
      "and registry entry from the submission.\n",
    stderr: "",
  };
}
