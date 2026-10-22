import { readFileSync, writeFileSync } from "node:fs";
import type { PackageBundle } from "@shortcircuit/engine";
import { helpText, listFlag, parseArgs } from "./args";
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

export function run(
  argv: string[],
  read: FileReader = (file) => readFileSync(file, "utf8"),
  write: FileWriter = (file, contents) => writeFileSync(file, contents),
): CommandResult {
  const parsed = parseArgs(argv);

  if (parsed.command === "help" || parsed.flags.help) {
    return { code: 0, stdout: helpText(), stderr: "" };
  }

  let packagePaths: string[] | undefined;
  let enabledPackages: string[] | undefined;
  let disabledPackages: string[] | undefined;
  let disableDefaultPackages: boolean;
  try {
    packagePaths = listFlag(parsed.flags, "package");
    enabledPackages = listFlag(parsed.flags, "only-packages", true);
    disabledPackages = listFlag(parsed.flags, "disable-package", true);
    disableDefaultPackages = parsed.flags["no-default-packages"] === true;
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }

  const baseOptions: CommandOptions = {
    json: parsed.flags.json === true,
    circuit: typeof parsed.flags.circuit === "string" ? parsed.flags.circuit : undefined,
    out: typeof parsed.flags.out === "string" ? parsed.flags.out : undefined,
    write: parsed.flags.write === true,
    disableDefaultPackages,
    enabledPackages,
    disabledPackages,
  };

  if (parsed.command === "package") {
    const subcommand = parsed.positionals[0];
    if (subcommand !== "list") {
      return failure(
        subcommand
          ? `Unknown package command "${subcommand}". Use "shortcircuit package list".`
          : 'No package command given. Use "shortcircuit package list".',
      );
    }
    if (parsed.positionals.length > 1) {
      return failure("package list does not take a file.");
    }
    let loaded: LocalPackageLoad;
    try {
      loaded = loadPackages(packagePaths);
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error));
    }
    return packageListCommand({
      ...baseOptions,
      packages: loaded.bundle,
      packageOrigins: loaded.origins,
    });
  }

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
