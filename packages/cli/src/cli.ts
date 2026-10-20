import { readFileSync, writeFileSync } from "node:fs";
import { helpText, parseArgs, type ParsedArgs } from "./args";
import {
  compileCommand,
  exportIrCommand,
  exportVerilogCommand,
  formatCommand,
  testCommand,
  truthTableCommand,
  type CommandOptions,
  type CommandResult,
} from "./commands";

export type FileReader = (file: string) => string;
export type FileWriter = (file: string, contents: string) => void;

export function run(
  argv: string[],
  read: FileReader = (file) => readFileSync(file, "utf8"),
  write: FileWriter = (file, contents) => writeFileSync(file, contents),
): CommandResult {
  const parsed: ParsedArgs = parseArgs(argv);
  const file = parsed.positionals[0];

  if (parsed.command === "help" || parsed.flags.help) {
    return { code: 0, stdout: helpText(), stderr: "" };
  }

  if (!file) {
    return { code: 1, stdout: helpText(), stderr: "No file given.\n" };
  }

  let source: string;
  try {
    source = read(file);
  } catch {
    return { code: 1, stdout: "", stderr: `Could not read ${file}.\n` };
  }

  const options: CommandOptions = {
    json: parsed.flags.json === true,
    circuit: typeof parsed.flags.circuit === "string" ? parsed.flags.circuit : undefined,
    out: typeof parsed.flags.out === "string" ? parsed.flags.out : undefined,
    write: parsed.flags.write === true,
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
