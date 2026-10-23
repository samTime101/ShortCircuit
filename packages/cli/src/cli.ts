import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { PackageBundle } from "@shortcircuit/engine/core";
import {
  helpText,
  initHelpText,
  listFlag,
  packageHelpText,
  packageInitHelpText,
  packageAddExportHelpText,
  packageListHelpText,
  parseArgs,
} from "./args";
import type { FlagValue, ParsedArgs } from "./args";
import {
  buildPackage,
  checkPackage,
  initPackage,
  addExport,
  registerPackage,
  testPackage,
} from "./authoring";
import {
  compileCommand,
  exportIrCommand,
  exportVerilogCommand,
  formatCommand,
  packageListCommand,
  packageUpstreamListCommand,
  testCommand,
  truthTableCommand,
  type CommandOptions,
  type CommandResult,
} from "./commands";
import {
  cacheDirectory,
  findLocalPackage,
  findRoot,
  readLock,
  readRootState,
  registryUrlFor,
  requirePackageRoot,
  requireRoot,
  storePackageDirectory,
  type RootContext,
  type RootState,
} from "./project";
import {
  installAll,
  installPackage,
  linkPackage,
  listInstalledPackages,
  listUpstreamPackages,
  uninstallPackage,
  updatePackages,
  type InstallSummary,
  type ManagerOptions,
} from "./installer";
import { DEFAULT_REGISTRY_URL } from "./project";
import { loadLocalPackages, type LocalPackageLoad } from "./packages";
import { initProject } from "./projectInit";
import type { FetchLike } from "./registry";

export type FileReader = (file: string) => string;
export type FileWriter = (file: string, contents: string) => void;

const COMPILE_COMMANDS = new Set([
  "compile",
  "test",
  "truth-table",
  "export-ir",
  "export-verilog",
]);

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  fetch?: FetchLike;
  /** Hosts and tests can disable the interactive package wizard. */
  interactive?: boolean;
}

function failure(message: string): CommandResult {
  return { code: 1, stdout: "", stderr: `${message}\n` };
}

function writeExportOutput(
  result: CommandResult,
  out: string | undefined,
  cwd: string,
  write: FileWriter,
): CommandResult {
  if (result.code !== 0 || !out) return result;
  const path = resolve(cwd, out);
  try {
    write(path, result.stdout);
    return { code: 0, stdout: `Wrote ${out}.\n`, stderr: result.stderr };
  } catch {
    return failure(`Could not write ${out}.`);
  }
}

function optionValue(
  flags: Record<string, FlagValue>,
  name: string,
): string | undefined {
  if (flags[name] === undefined) return undefined;
  const values = listFlag(flags, name);
  return values?.[0];
}

function rootOrNull(start: string): RootContext | null {
  return findRoot(start);
}

function loadSourcePackages(
  cwd: string,
  file: string,
  explicit: string[] | undefined,
): LocalPackageLoad {
  const root =
    rootOrNull(dirname(resolve(cwd, file))) ??
    rootOrNull(cwd);
  const paths: string[] = [];
  const seen = new Set<string>();

  const add = (path: string) => {
    const resolved = resolve(path);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    paths.push(resolved);
  };

  if (root) {
    const state = readRootState(root);
    const lock = readLock(root);
    for (const name of Object.keys(state.dependencies)) {
      if (!lock.packages[name] && name !== state.name) {
        throw new Error(
          `Dependency ${name} is not installed. Run shortcircuit package install.`,
        );
      }
    }
    for (const [name, entry] of Object.entries(lock.packages)) {
      if (root.kind === "package" && name === state.name) continue;
      if (entry.type === "path") {
        add(resolve(root.root, entry.path ?? "."));
      } else {
        add(storePackageDirectory(root.root, name));
      }
    }
    if (root.kind === "package") add(root.root);
  }

  for (const path of explicit ?? []) add(resolve(cwd, path));
  return loadLocalPackages(paths);
}

function managerOptions(
  parsed: ParsedArgs,
  state: RootState | null,
  runOptions: RunOptions,
): ManagerOptions {
  const env = runOptions.env ?? process.env;
  const registryUrl =
    optionValue(parsed.flags, "registry") ??
    (state ? registryUrlFor(state, env) : (env.SHORTCIRCUIT_REGISTRY_URL ?? DEFAULT_REGISTRY_URL));
  return {
    registryUrl,
    cacheDir: cacheDirectory(env),
    fetch: runOptions.fetch,
    offline: parsed.flags.offline === true,
    refresh: parsed.flags.refresh === true,
    force: parsed.flags.force === true,
    saveExact: parsed.flags["save-exact"] === true,
    latest: parsed.flags.latest === true,
    frozen: parsed.flags.frozen === true,
  };
}

function installMessage(summary: InstallSummary, action: string, frozen = false): string {
  if (frozen) return "Lockfile and package store are up to date.\n";
  const lines: string[] = [];
  if (summary.installed.length > 0) {
    lines.push(
      `${action} ${summary.installed.length} package${summary.installed.length === 1 ? "" : "s"}: ${summary.installed.join(", ")}`,
    );
  } else {
    lines.push("Dependencies are already installed.");
  }
  if (summary.removed.length > 0) {
    lines.push(`Removed ${summary.removed.join(", ")}.`);
  }
  lines.push("Updated shortcircuit.lock.json.");
  return `${lines.join("\n")}\n`;
}

async function runPackageCommand(
  parsed: ParsedArgs,
  cwd: string,
  runOptions: RunOptions,
): Promise<CommandResult> {
  const subcommand = parsed.positionals[0] ?? "help";
  const rest = parsed.positionals.slice(1);
  const json = parsed.flags.json === true;
  const verbose = parsed.flags.verbose === true;

  if (subcommand === "help") {
    return {
      code: 0,
      stdout:
        rest[0] === "init"
          ? packageInitHelpText()
          : rest[0] === "add-export"
            ? packageAddExportHelpText()
            : rest[0] === "list"
              ? packageListHelpText()
              : packageHelpText(),
      stderr: "",
    };
  }

  if (parsed.flags.help === true) {
    return {
      code: 0,
      stdout:
        subcommand === "init"
          ? packageInitHelpText()
          : subcommand === "add-export"
            ? packageAddExportHelpText()
            : subcommand === "list"
              ? packageListHelpText()
              : packageHelpText(),
      stderr: "",
    };
  }

  if (subcommand === "init") {
    if (rest.length > 1) return failure("package init takes at most one directory.");
    const interactive =
      parsed.flags.yes === true
        ? false
        : (runOptions.interactive ?? Boolean(process.stdin.isTTY));
    return initPackage({
      directory: resolve(cwd, rest[0] ?? "."),
      name: optionValue(parsed.flags, "name"),
      exportName: optionValue(parsed.flags, "export"),
      kind: optionValue(parsed.flags, "kind"),
      description: optionValue(parsed.flags, "description"),
      version: optionValue(parsed.flags, "version"),
      license: optionValue(parsed.flags, "license"),
      dependencies: optionValue(parsed.flags, "dependencies"),
      force: parsed.flags.force === true,
      yes: parsed.flags.yes === true,
      interactive,
    });
  }

  if (subcommand === "add-export") {
    if (rest.length > 0) return failure("package add-export takes no directory.");
    if (parsed.flags.help !== undefined) {
      return { code: 0, stdout: packageAddExportHelpText(), stderr: "" };
    }
    const interactive =
      parsed.flags.yes === true
        ? false
        : (runOptions.interactive ?? Boolean(process.stdin.isTTY));
    const kindValue = optionValue(parsed.flags, "kind");
    const kind = kindValue === "circuit" || kindValue === "macro" ? kindValue : "macro";
    return addExport({
      directory: cwd,
      exportName: optionValue(parsed.flags, "export"),
      kind,
      force: parsed.flags.force === true,
      yes: parsed.flags.yes === true,
      interactive,
    });
  }

  if (subcommand === "list") {
    if (rest[0] === "upstream") {
      if (rest.length > 1) return failure("package list upstream takes no file.");
      const root = rootOrNull(cwd);
      const state = root ? readRootState(root) : null;
      const rows = await listUpstreamPackages(state, managerOptions(parsed, state, runOptions));
      return packageUpstreamListCommand(rows, { json, verbose });
    }
    if (rest.length > 0) {
      return failure(
        `Unknown package list target "${rest[0]}". Use "package list" or "package list upstream".`,
      );
    }
    const root = requireRoot(cwd);
    const rows = listInstalledPackages(readRootState(root));
    return packageListCommand(rows, { json, verbose });
  }

  if (subcommand === "install") {
    if (rest.length > 1) return failure("package install takes at most one package name.");
    const root = requireRoot(cwd);
    const state = readRootState(root);
    const options = managerOptions(parsed, state, runOptions);
    if (rest.length === 0) {
      return {
        code: 0,
        stdout: installMessage(
          await installAll(state, options),
          "Installed",
          parsed.flags.frozen === true,
        ),
        stderr: "",
      };
    }
    return {
      code: 0,
      stdout: installMessage(
        await installPackage(state, rest[0]!, options),
        "Installed",
        parsed.flags.frozen === true,
      ),
      stderr: "",
    };
  }

  if (subcommand === "uninstall") {
    if (rest.length !== 1) return failure("package uninstall needs one package name.");
    if (parsed.flags.frozen === true) {
      return failure("package uninstall cannot be used with --frozen.");
    }
    const root = requireRoot(cwd);
    const result = uninstallPackage(readRootState(root), rest[0]!);
    return {
      code: 0,
      stdout: `Removed ${result.removed} from dependencies. Path-linked files were not deleted.\n`,
      stderr: "",
    };
  }

  if (subcommand === "update") {
    if (rest.length > 1) return failure("package update takes at most one package name.");
    const root = requireRoot(cwd);
    const state = readRootState(root);
    const summary = await updatePackages(
      state,
      rest[0],
      managerOptions(parsed, state, runOptions),
    );
    return {
      code: 0,
      stdout: installMessage(summary, "Updated"),
      stderr: "",
    };
  }

  if (subcommand === "link") {
    if (rest.length !== 1) return failure("package link needs one package name or path.");
    if (parsed.flags.frozen === true) {
      return failure("package link cannot be used with --frozen.");
    }
    const root = requireRoot(cwd);
    const state = readRootState(root);
    const identity = findLocalPackage(root.root, rest[0]!);
    const summary = await linkPackage(
      state,
      rest[0]!,
      managerOptions(parsed, state, runOptions),
    );
    return {
      code: 0,
      stdout:
        `Linked ${identity.name}@${identity.version} from ${identity.dir}.\n` +
        "The manifest stores a path dependency; no files were copied or symlinked.\n" +
        installMessage(summary, "Installed"),
      stderr: "",
    };
  }

  if (subcommand === "build") {
    if (rest.length > 0) return failure("package build takes no file.");
    return buildPackage(requirePackageRoot(cwd));
  }

  if (subcommand === "test") {
    if (rest.length > 0) return failure("package test takes no file.");
    return testPackage(requirePackageRoot(cwd));
  }

  if (subcommand === "check") {
    if (rest.length > 0) return failure("package check takes no file.");
    return checkPackage(requirePackageRoot(cwd));
  }

  if (subcommand === "register") {
    if (rest.length > 0) return failure("package register takes no file.");
    return registerPackage(requirePackageRoot(cwd), {
      dryRun: parsed.flags["dry-run"] === true,
      out: optionValue(parsed.flags, "out"),
      json,
    });
  }

  return failure(
    `Unknown package command "${subcommand}". Use "shortcircuit package help".`,
  );
}

export async function run(
  argv: string[],
  read: FileReader = (file) => readFileSync(file, "utf8"),
  write: FileWriter = (file, contents) => writeFileSync(file, contents),
  runOptions: RunOptions = {},
): Promise<CommandResult> {
  try {
    const parsed = parseArgs(argv);
    const cwd = runOptions.cwd ?? process.cwd();

    if (parsed.command === "help") {
      return { code: 0, stdout: helpText(), stderr: "" };
    }

    if (parsed.command === "init") {
      if (parsed.flags.help === true) {
        return { code: 0, stdout: initHelpText(), stderr: "" };
      }
      if (parsed.positionals.length > 1) {
        return failure("init takes at most one directory.");
      }
      return initProject({
        directory: resolve(cwd, parsed.positionals[0] ?? "."),
        force: parsed.flags.force === true,
        registry: optionValue(parsed.flags, "registry"),
      });
    }

    if (parsed.command === "package") {
      return await runPackageCommand(parsed, cwd, runOptions);
    }

    if (parsed.flags.help === true) {
      return { code: 0, stdout: helpText(), stderr: "" };
    }

    let packagePaths: string[] | undefined;
    try {
      packagePaths = listFlag(parsed.flags, "package");
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error));
    }

    const baseOptions: CommandOptions = {
      json: parsed.flags.json === true,
      verbose: parsed.flags.verbose === true,
      circuit: optionValue(parsed.flags, "circuit"),
      out: optionValue(parsed.flags, "out"),
      write: parsed.flags.write === true,
    };

    const file = parsed.positionals[0];
    if (!file) {
      return { code: 1, stdout: helpText(), stderr: "No file given.\n" };
    }

    let source: string;
    try {
      source = read(file);
    } catch {
      return { code: 1, stdout: "", stderr: `Could not read ${file}.\n` };
    }

    let packages: PackageBundle | undefined;
    if (COMPILE_COMMANDS.has(parsed.command)) {
      try {
        const loaded = loadSourcePackages(cwd, file, packagePaths);
        packages = loaded.bundle;
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    }

    const options: CommandOptions = { ...baseOptions, packages };

    switch (parsed.command) {
      case "compile":
        return compileCommand(source, options);
      case "test":
        return testCommand(source, options);
      case "truth-table":
        return truthTableCommand(source, options);
      case "format": {
        const result = formatCommand(source, options);
        if (options.write && result.code === 0) {
          try {
            write(file, result.stdout);
            return { code: 0, stdout: `Formatted ${file}.\n`, stderr: "" };
          } catch {
            return { code: 1, stdout: "", stderr: `Could not write ${file}.\n` };
          }
        }
        return result;
      }
      case "export-ir":
        return writeExportOutput(exportIrCommand(source, options), options.out, cwd, write);
      case "export-verilog":
        return writeExportOutput(
          exportVerilogCommand(source, options),
          options.out,
          cwd,
          write,
        );
      default:
        return {
          code: 1,
          stdout: helpText(),
          stderr: `Unknown command "${parsed.command}".\n`,
        };
    }
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}
