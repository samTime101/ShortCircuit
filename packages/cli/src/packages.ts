import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  type PackageBundle,
  type PackageExport,
  type PackageManifest,
} from "@shortcircuit/engine/core";
import { PACKAGE_SCHEMA } from "./project";
import {
  validateExportName,
  validatePackageName,
  validateRange,
  validateVersion,
} from "./packageSpec";

export class PackageLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageLoadError";
  }
}

export interface LocalPackageLoad {
  bundle: PackageBundle;
  /** Package name to package directory, used by `package list`. */
  origins: Map<string, string>;
}

function fail(message: string): never {
  throw new PackageLoadError(message);
}

function readText(path: string, label: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    fail(`Could not read ${label} at ${path}.`);
  }
}

function readJson(path: string, label: string): Record<string, unknown> {
  const text = readText(path, label);
  try {
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      fail(`${label} at ${path} must be a JSON object.`);
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof PackageLoadError) throw error;
    const detail = error instanceof Error ? ` ${error.message}` : "";
    fail(`${label} at ${path} is not valid JSON.${detail}`);
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string.`);
  }
  return value;
}

function locatePackage(input: string): { root: string; manifestPath: string } {
  const path = resolve(input);
  let stats;
  try {
    stats = statSync(path);
  } catch {
    fail(`Could not find package at ${input}.`);
  }
  if (stats.isDirectory()) {
    const manifestPath = join(path, "manifest.json");
    if (!existsSync(manifestPath)) fail(`No manifest.json found in ${input}.`);
    return { root: path, manifestPath };
  }
  if (stats.isFile() && basename(path) === "manifest.json") {
    return { root: dirname(path), manifestPath: path };
  }
  fail(`Package path ${input} must be a directory or a manifest.json file.`);
}

function validateExport(value: unknown, label: string): PackageExport {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  const item = value as Record<string, unknown>;
  const kind = item.kind;
  if (kind !== "macro" && kind !== "circuit") {
    fail(`${label} kind must be "macro" or "circuit".`);
  }
  requireString(item.name, `${label} name`);
  requireString(item.source, `${label} source`);
  if (item.docs !== undefined) requireString(item.docs, `${label} docs`);
  if (item.tests !== undefined) requireString(item.tests, `${label} tests`);
  return item as unknown as PackageExport;
}

function hasDeclaration(item: PackageExport, source: string): boolean {
  const name = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return item.kind === "macro"
    ? new RegExp(`\\bMACRO\\s+${name}\\s*\\(`).test(source)
    : new RegExp(`\\bCIRCUIT\\s+${name}\\b`).test(source);
}

function packageFilePath(root: string, path: string, label: string): string {
  const resolved = resolve(root, path);
  const relativePath = relative(root, resolved);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    fail(`${label} path ${path} must stay inside the package directory.`);
  }
  return resolved;
}

function loadManifest(root: string, manifestPath: string): PackageManifest {
  const label = `Package manifest at ${manifestPath}`;
  const raw = readJson(manifestPath, label);
  if (raw.schema !== PACKAGE_SCHEMA) {
    fail(`${label} does not use ${PACKAGE_SCHEMA}.`);
  }
  const name = validatePackageName(requireString(raw.name, `${label} name`));
  const version = validateVersion(requireString(raw.version, `${label} version`));
  if (raw.recommendedAutoImport !== undefined && typeof raw.recommendedAutoImport !== "boolean") {
    fail(`${name} recommendedAutoImport must be true or false.`);
  }
  const dependencies: Record<string, string> = {};
  if (raw.dependencies !== undefined) {
    if (raw.dependencies === null || typeof raw.dependencies !== "object" || Array.isArray(raw.dependencies)) {
      fail(`${name} dependencies must be an object.`);
    }
    for (const [dependency, range] of Object.entries(
      raw.dependencies as Record<string, unknown>,
    )) {
      const dependencyName = validatePackageName(dependency);
      if (typeof range !== "string") {
        fail(`${name} dependency ${dependencyName} must have a string version or path.`);
      }
      dependencies[dependencyName] = validateRange(range);
    }
  }

  const packageJsonPath = join(root, "package.json");
  if (existsSync(packageJsonPath)) {
    const packageJson = readJson(packageJsonPath, `${name} package.json`);
    const packageName = requireString(packageJson.name, `${name} package.json name`);
    const packageVersion = requireString(packageJson.version, `${name} package.json version`);
    if (packageName !== name) {
      fail(`Package ${name} does not match package.json name ${packageName}.`);
    }
    if (packageVersion !== version) {
      fail(
        `Package ${name} version ${version} does not match package.json version ${packageVersion}.`,
      );
    }
  }

  if (!Array.isArray(raw.exports)) {
    fail(`${label} exports must be an array.`);
  }

  const exports: PackageExport[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of raw.exports.entries()) {
    const item = validateExport(entry, `${name} export ${index + 1}`);
    const exportName = validateExportName(item.name);
    const key = `${item.kind}:${exportName}`;
    if (seen.has(key)) fail(`${name} exports ${key} more than once.`);
    seen.add(key);

    const sourceText = readText(
      packageFilePath(root, item.source, `${name} source`),
      `${name} source ${item.source}`,
    );
    if (!hasDeclaration({ ...item, name: exportName }, sourceText)) {
      fail(`${name} export ${exportName} is not declared in ${item.source}.`);
    }
    const docsText = item.docs
      ? readText(
          packageFilePath(root, item.docs, `${name} docs`),
          `${name} docs ${item.docs}`,
        )
      : undefined;
    const testText =
      item.kind === "circuit" && item.tests
        ? readText(
            packageFilePath(root, item.tests, `${name} tests`),
            `${name} tests ${item.tests}`,
          )
        : undefined;
    exports.push({
      ...item,
      name: exportName,
      sourceText,
      ...(docsText === undefined ? {} : { docsText }),
      ...(testText === undefined ? {} : { testText }),
    });
  }

  let testText: string | undefined;
  if (raw.tests !== undefined) {
    const tests = requireString(raw.tests, `${name} tests`);
    testText = readText(
      packageFilePath(root, tests, `${name} tests`),
      `${name} tests ${tests}`,
    );
  }

  return {
    ...(raw as unknown as PackageManifest),
    name,
    version,
    ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}),
    exports,
    ...(testText === undefined ? {} : { testText }),
  };
}

/**
 * Load local package directories and inline their source, docs, and test files
 * into the same shape as the bundled package snapshot.
 */
export function loadLocalPackages(paths: string[]): LocalPackageLoad {
  const packages: PackageManifest[] = [];
  const origins = new Map<string, string>();

  for (const input of paths) {
    const { root, manifestPath } = locatePackage(input);
    const manifest = loadManifest(root, manifestPath);
    const existing = origins.get(manifest.name);
    if (existing) {
      fail(`Package ${manifest.name} is defined by both ${existing} and ${root}.`);
    }
    packages.push(manifest);
    origins.set(manifest.name, root);
  }

  return {
    bundle: {
      schema: "shortcircuit.packages/v1",
      packages,
    },
    origins,
  };
}
