import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { FlagValue } from "./args";
import type { CommandResult, DelegatedCommand } from "./commands";

const PACKAGE_ROOT_NAME = "@shortcircuit/packages";

const INIT_VALUE_FLAGS = [
  "name",
  "export",
  "kind",
  "description",
  "version",
  "license",
  "dependencies",
] as const;

const INIT_BOOLEAN_FLAGS = ["no-registry", "force", "yes", "auto-import"] as const;

function readPackageName(directory: string): string | null {
  try {
    const raw = readFileSync(join(directory, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { name?: unknown };
    return typeof parsed.name === "string" ? parsed.name : null;
  } catch {
    return null;
  }
}

/** Check whether a directory is the Short Circuit package registry checkout. */
export function isPackageRegistryRoot(directory: string): boolean {
  return (
    readPackageName(directory) === PACKAGE_ROOT_NAME &&
    existsSync(join(directory, "registry.json")) &&
    existsSync(join(directory, "scripts", "package.mjs"))
  );
}

function registryCandidate(directory: string): string | null {
  if (isPackageRegistryRoot(directory)) return directory;
  const nested = join(directory, "vendor", "ShortCircuit-Packages");
  return isPackageRegistryRoot(nested) ? nested : null;
}

/**
 * Find the package registry checkout. The search starts at the working
 * directory and walks up, so the CLI works from the repository root, a nested
 * app directory, or the package repository itself.
 */
export function findPackageRegistry(cwd: string, explicitRoot?: string): string {
  const start = resolve(cwd);
  if (explicitRoot !== undefined) {
    const requested = resolve(start, explicitRoot);
    const found = registryCandidate(requested);
    if (found) return found;
    throw new Error(
      `Could not find the Short Circuit package registry at ${requested}. ` +
        "Pass --root with a package registry checkout or the main repository.",
    );
  }

  let directory = start;
  while (true) {
    const found = registryCandidate(directory);
    if (found) return found;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  throw new Error(
    "Could not find the Short Circuit package registry. Run this inside a " +
      "Short Circuit checkout with the package submodule initialized, or pass " +
      "--root /path/to/ShortCircuit-Packages. To initialize the submodule, run " +
      "git submodule update --init --recursive.",
  );
}

/** Convert parsed init flags back into the authoring CLI's argument list. */
export function initArguments(flags: Record<string, FlagValue>): string[] {
  const args: string[] = [];
  for (const name of INIT_VALUE_FLAGS) {
    const value = flags[name];
    if (value === undefined) continue;
    if (typeof value === "string") {
      args.push(`--${name}`, value);
    } else if (Array.isArray(value)) {
      const last = value[value.length - 1];
      if (last === undefined) throw new Error(`Option --${name} needs a value.`);
      args.push(`--${name}`, last);
    } else {
      throw new Error(`Option --${name} needs a value.`);
    }
  }
  for (const name of INIT_BOOLEAN_FLAGS) {
    if (flags[name] === true) args.push(`--${name}`);
  }
  return args;
}

export function packageDelegate(
  root: string,
  subcommand: "init" | "build" | "test" | "check",
  args: string[],
  env: Record<string, string | undefined>,
): DelegatedCommand {
  return {
    command: process.execPath,
    args: [join(root, "scripts", "package.mjs"), subcommand, ...args],
    cwd: root,
    env,
  };
}

type ManifestState = "ok" | "missing" | "invalid";

interface RegistryRow {
  name: string;
  version: string;
  manifest: string;
  exports: number | null;
  state: ManifestState;
}

function registryRows(root: string): RegistryRow[] | CommandResult {
  const registryPath = join(root, "registry.json");
  let registry: { packages?: unknown };
  try {
    registry = JSON.parse(readFileSync(registryPath, "utf8")) as { packages?: unknown };
  } catch {
    return {
      code: 1,
      stdout: "",
      stderr: `Could not read ${registryPath}.\n`,
    };
  }

  if (!Array.isArray(registry.packages)) {
    return {
      code: 1,
      stdout: "",
      stderr: `Invalid registry file at ${registryPath}: packages must be an array.\n`,
    };
  }

  return registry.packages.map((raw) => {
    const entry = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
      string,
      unknown
    >;
    const name = typeof entry.name === "string" ? entry.name : "unknown";
    const version = typeof entry.version === "string" ? entry.version : "0.0.0";
    const manifest = typeof entry.manifest === "string" ? entry.manifest : "";
    let exports: number | null = null;
    let state: ManifestState = "missing";

    if (manifest) {
      const manifestPath = resolve(root, manifest);
      if (existsSync(manifestPath)) {
        try {
          const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as {
            exports?: unknown;
          };
          exports = Array.isArray(parsed.exports) ? parsed.exports.length : 0;
          state = "ok";
        } catch {
          state = "invalid";
        }
      }
    }

    return { name, version, manifest, exports, state };
  });
}

export function packageRegistryCommand(root: string, json: boolean): CommandResult {
  const rows = registryRows(root);
  if (!Array.isArray(rows)) return rows;

  if (json) {
    return {
      code: 0,
      stdout: `${JSON.stringify({ packages: rows }, null, 2)}\n`,
      stderr: "",
    };
  }

  if (rows.length === 0) {
    return { code: 0, stdout: "No packages registered.\n", stderr: "" };
  }

  const lines = ["Packages:"];
  for (const row of rows) {
    const detail =
      row.state === "missing"
        ? " (manifest missing)"
        : row.state === "invalid"
          ? " (invalid manifest)"
          : ` (${row.exports} export${row.exports === 1 ? "" : "s"})`;
    lines.push(`  ${row.name}@${row.version}${detail}`);
  }
  return { code: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
}
