import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CommandResult } from "./commands";
import {
  emptyLock,
  hasPackageManifest,
  PROJECT_SCHEMA,
  writeJson,
  writeLock,
  type RootContext,
} from "./project";

export interface ProjectInitOptions {
  directory: string;
  force?: boolean;
  registry?: string;
}

const SAMPLE_SOURCE = `CIRCUIT Main
  INPUT a
  INPUT b

  y = NAND(a, b)

  OUTPUT y
END

TEST Main
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

export function initProject(options: ProjectInitOptions): CommandResult {
  const directory = resolve(options.directory);
  if (hasPackageManifest(directory)) {
    throw new Error(
      `This directory is already a Short Circuit package root (manifest.json). ` +
        "Create the project in a different directory, or move the package under " +
        "packages/<name> first.",
    );
  }
  const manifestPath = join(directory, "shortcircuit.json");
  if (existsSync(manifestPath) && !options.force) {
    throw new Error(
      `A Short Circuit project already exists at ${directory}. Use --force to replace its manifest.`,
    );
  }
  mkdirSync(directory, { recursive: true });

  const context: RootContext = {
    kind: "project",
    root: directory,
    manifestPath,
    lockPath: join(directory, "shortcircuit.lock.json"),
  };
  writeJson(manifestPath, {
    schema: PROJECT_SCHEMA,
    dependencies: {},
    ...(options.registry ? { registry: options.registry } : {}),
  });
  writeLock(context, emptyLock());
  ensureGitignore(directory);

  const sourcePath = join(directory, "src", "main.lf");
  const sourceCreated = !existsSync(sourcePath);
  if (sourceCreated) {
    mkdirSync(join(directory, "src"), { recursive: true });
    writeFileSync(sourcePath, SAMPLE_SOURCE);
  }

  const lines = [
    `Created Short Circuit project in ${directory}`,
    `  shortcircuit.json`,
    `  shortcircuit.lock.json`,
    ...(sourceCreated ? ["  src/main.lf"] : []),
    "",
    "Next:",
    "  shortcircuit compile src/main.lf",
    "  shortcircuit package install @shortcircuit/gates",
    "  shortcircuit package link ./packages/my-package",
  ];
  return { code: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
}
