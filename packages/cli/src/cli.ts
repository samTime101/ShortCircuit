import { readFileSync, writeFileSync } from "node:fs";
import type { PackageBundle } from "@shortcircuit/engine";
import { helpText, listFlag, parseArgs, packageHelpText, packageInitHelpText } from "./args";
import type { FlagValue, ParsedArgs } from "./args";
import {
  findPackageRegistry,
  initArguments,
  packageDelegate,
  packageRegistryCommand,
} from "./authoring";
import {
  compileCommand,
  exportIrCommand,
  exportVerilogCommand,
  formatCommand,
  packageListCommand,
  testCommand,
  truthTableCommand,
  type CommandOptions,
  type CommandResult,
} from "./commands";
import { loadLocalPackages, type LocalPackageLoad } from "./packages";

export type FileReader = (file: string) => string;
export type FileWriter = (file: string, contents: string) => void;

const COMPILE_COMMANDS = new Set([
  "compile",
  "test",
  "truth-table",
  "export-ir",
  "export-verilog",
]);

function failure(message: string): CommandResult {
  return { code: 1, stdout: "", stderr: `${message}\n` };
}

function loadPackages(paths: string[] | undefined): LocalPackageLoad {
  return loadLocalPackages(paths ?? []);
}

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
}

function optionValue(
  flags: Record<string, FlagValue>,
  name: string,
): string | undefined {
  if (flags[name] === undefined) return undefined;
  const values = listFlag(flags, name);
  return values?.[0];
}

function runPackageCommand(
  parsed: ParsedArgs,
  cwd: string,
  env: Record<string, string | undefined>,
  packagePaths: string[] | undefined,
): CommandResult {
  const subcommand = parsed.positionals[0] ?? "help";
  const rest = parsed.positionals.slice(1);
  const json = parsed.flags.json === true;

  if (subcommand === "help") {
    return {
      code: 0,
      stdout: rest[0] === "init" ? packageInitHelpText() : packageHelpText(),
      stderr: "",
    };
  }

  if (parsed.flags.help === true) {
    return {
      code: 0,
      stdout: subcommand === "init" ? packageInitHelpText() : packageHelpText(),
      stderr: "",
    };
  }

  if (subcommand === "list") {
    if (rest.length > 0) return failure("package list does not take a file.");
    let loaded: LocalPackageLoad;
    try {
      loaded = loadPackages(packagePaths);
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error));
    }
    return packageListCommand({
      json,
      packages: loaded.bundle,
      packageOrigins: loaded.origins,
    });
  }

  if (
    subcommand !== "init" &&
    subcommand !== "build" &&
    subcommand !== "test" &&
    subcommand !== "check" &&
    subcommand !== "registry"
  ) {
    return failure(
      `Unknown package command "${subcommand}". Use "shortcircuit package help".`,
    );
  }

  if (rest.length > 0) {
    return failure(`package ${subcommand} does not take a file.`);
  }

  let root: string;
  try {
    root = findPackageRegistry(cwd, optionValue(parsed.flags, "root"));
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }

  if (subcommand === "registry") {
    return packageRegistryCommand(root, json);
  }

  let main: string | undefined;
  try {
    main = optionValue(parsed.flags, "main");
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }

  const childEnv = main ? { ...env, SHORTCIRCUIT_ROOT: main } : env;

  if (subcommand === "init") {
    let args: string[];
    try {
      args = initArguments(parsed.flags);
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error));
    }
    return {
      code: 0,
      stdout: "",
      stderr: "",
      delegate: packageDelegate(root, "init", args, childEnv),
    };
  }

  return {
    code: 0,
    stdout: "",
    stderr: "",
    delegate: packageDelegate(root, subcommand, [], childEnv),
  };
}

export function run(
  argv: string[],
  read: FileReader = (file) => readFileSync(file, "utf8"),
  write: FileWriter = (file, contents) => writeFileSync(file, contents),
  runOptions: RunOptions = {},
): CommandResult {
  const parsed = parseArgs(argv);
  const cwd = runOptions.cwd ?? process.cwd();
  const env = runOptions.env ?? process.env;

  if (parsed.command === "help") {
    return { code: 0, stdout: helpText(), stderr: "" };
  }

  if (parsed.command === "package") {
    let packagePaths: string[] | undefined;
    try {
      packagePaths = listFlag(parsed.flags, "package");
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error));
    }
    return runPackageCommand(parsed, cwd, env, packagePaths);
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
    circuit: typeof parsed.flags.circuit === "string" ? parsed.flags.circuit : undefined,
    out: typeof parsed.flags.out === "string" ? parsed.flags.out : undefined,
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
  let packageOrigins: Map<string, string> | undefined;
  if (COMPILE_COMMANDS.has(parsed.command) && packagePaths !== undefined) {
    try {
      const loaded = loadPackages(packagePaths);
      packages = loaded.bundle;
      packageOrigins = loaded.origins;
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error));
    }
  }

  const options: CommandOptions = {
    ...baseOptions,
    packages,
    packageOrigins,
  };

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
      return exportIrCommand(source, options);
    case "export-verilog":
      return exportVerilogCommand(source, options);
    default:
      return { code: 1, stdout: helpText(), stderr: `Unknown command "${parsed.command}".\n` };
  }
}
