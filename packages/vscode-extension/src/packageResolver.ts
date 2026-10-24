import * as fs from "fs";
import * as path from "path";
import {
  type PackageBundle,
  type PackageManifest,
  type PackageExport,
  type PackageCircuitExport,
} from "@shortcircuit/engine";

export interface ResolvedWorkspaceContext {
  bundle: PackageBundle;
  implicitImports: string[];
  enclosingPackageName?: string;
  projectRoot?: string;
  packageRoot?: string;
}

export interface ResolveWorkspaceOptions {
  /**
   * Unsaved editor buffers keyed by absolute file path. Package sources are
   * normally cached; this overlay keeps imports of a dirty package file in
   * sync without re-reading every package on each keystroke.
   */
  openSources?: ReadonlyMap<string, string>;
}

interface PackageCacheEntry {
  manifestMtimeMs: number;
  manifestSize: number;
  manifest: PackageManifest;
}

interface LoadedPackage {
  dir: string;
  manifest: PackageManifest;
}

interface ContextCacheEntry {
  packages: LoadedPackage[];
  implicitImports: string[];
  enclosingPackageName?: string;
  projectRoot?: string;
  packageRoot?: string;
}

/** Parsed manifests and source files, keyed by package directory. */
const packageCache = new Map<string, PackageCacheEntry>();

/** Discovered workspace shape, keyed by the directory of the open file. */
const contextCache = new Map<string, ContextCacheEntry>();

/** Cached upward searches, keyed by start directory and file name. */
const upwardCache = new Map<string, string | null>();

const CONTEXT_CACHE_LIMIT = 64;

/** Clear all package and workspace caches (e.g. when a manifest changes). */
export function invalidatePackageCache(): void {
  packageCache.clear();
  contextCache.clear();
  upwardCache.clear();
}

/**
 * Searches upward from a starting directory to find a file.
 */
function findUpward(startDir: string, fileName: string): string | null {
  const key = `${startDir}\0${fileName}`;
  if (upwardCache.has(key)) return upwardCache.get(key) ?? null;

  const visited: string[] = [];
  let current = path.resolve(startDir);
  let found: string | null = null;
  while (true) {
    const candidate = path.join(current, fileName);
    if (fs.existsSync(candidate)) {
      found = candidate;
      break;
    }
    visited.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  for (const directory of visited) {
    upwardCache.set(`${directory}\0${fileName}`, found);
  }
  upwardCache.set(key, found);
  return found;
}

function readText(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Loads a package from a directory containing manifest.json.
 *
 * The manifest and its source files are cached until {@link invalidatePackageCache}
 * is called. That keeps completion, hover, and live compilation from touching
 * the disk on every keystroke.
 */
export function loadPackageFromDir(packageDir: string): PackageManifest | null {
  const resolvedDir = path.resolve(packageDir);
  const manifestPath = path.join(resolvedDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const stats = fs.statSync(manifestPath);
    const cached = packageCache.get(resolvedDir);
    if (
      cached &&
      cached.manifestMtimeMs === stats.mtimeMs &&
      cached.manifestSize === stats.size
    ) {
      return cached.manifest;
    }

    const raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
    if (raw.schema !== "shortcircuit.package/v1" || typeof raw.name !== "string") {
      return null;
    }

    const name = raw.name;
    const version = (raw.version as string) || "0.1.0";
    const rawExports = Array.isArray(raw.exports)
      ? (raw.exports as Array<Record<string, unknown>>)
      : [];
    const dependencies = (raw.dependencies as Record<string, string>) || {};

    const exports: PackageExport[] = [];
    for (const entry of rawExports) {
      const exportName = entry.name as string;
      const exportSource = entry.source as string;
      const exportKind = (entry.kind as "circuit" | "macro") || "circuit";

      if (!exportName || !exportSource) continue;

      const sourceFullPath = path.resolve(resolvedDir, exportSource);
      const sourceText = readText(sourceFullPath);

      if (exportKind === "circuit") {
        exports.push({
          kind: "circuit",
          name: exportName,
          source: exportSource,
          sourceText,
          docs: entry.docs as string | undefined,
          tests: entry.tests as string | undefined,
          ports: entry.ports as PackageCircuitExport["ports"],
          summary: entry.summary as string | undefined,
          group: entry.group as string | undefined,
        });
      } else {
        exports.push({
          kind: "macro",
          name: exportName,
          source: exportSource,
          sourceText,
          internal: entry.internal as boolean | undefined,
          docs: entry.docs as string | undefined,
          summary: entry.summary as string | undefined,
          group: entry.group as string | undefined,
          widthRule: entry.widthRule as string | undefined,
          tip: entry.tip as string | undefined,
          examples: entry.examples as string[] | undefined,
        });
      }
    }

    const loadedManifest: PackageManifest = {
      ...(raw as unknown as PackageManifest),
      name,
      version,
      dependencies,
      exports,
    };

    packageCache.set(resolvedDir, {
      manifestMtimeMs: stats.mtimeMs,
      manifestSize: stats.size,
      manifest: loadedManifest,
    });
    return loadedManifest;
  } catch (err) {
    console.warn(`[ShortCircuit] Error loading package from ${resolvedDir}:`, err);
    return null;
  }
}

function addPackageDir(results: string[], packageDir: string): void {
  const resolved = path.resolve(packageDir);
  if (!results.includes(resolved)) results.push(resolved);
}

/** Recursively scan for directories containing manifest.json up to 3 levels deep. */
function scanPackageDirs(baseDir: string, results: string[], depth = 0): void {
  if (depth > 3) return;
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(baseDir, entry.name);
      if (fs.existsSync(path.join(fullPath, "manifest.json"))) {
        addPackageDir(results, fullPath);
      } else {
        scanPackageDirs(fullPath, results, depth + 1);
      }
    }
  } catch {
    // Ignore unreadable directories.
  }
}

function discoverContext(dir: string): ContextCacheEntry {
  const manifestFile = findUpward(dir, "manifest.json");
  const projectFile = findUpward(dir, "shortcircuit.json");

  const packageDirs: string[] = [];
  let enclosingPackageName: string | undefined;
  const implicitImports: string[] = [];
  let packageRoot: string | undefined;
  let projectRoot: string | undefined;

  // 1. If inside an enclosing package (e.g. circuits/add4/circuit.lf)
  if (manifestFile) {
    packageRoot = path.dirname(manifestFile);
    addPackageDir(packageDirs, packageRoot);

    const enclosingPkg = loadPackageFromDir(packageRoot);
    if (enclosingPkg) {
      enclosingPackageName = enclosingPkg.name;
      implicitImports.push(enclosingPkg.name);
      for (const dependency of Object.keys(enclosingPkg.dependencies ?? {})) {
        if (!implicitImports.includes(dependency)) implicitImports.push(dependency);
      }
    }

    // Installed dependencies in .shortcircuit/packages/
    const packageStoreDir = path.join(packageRoot, ".shortcircuit", "packages");
    if (fs.existsSync(packageStoreDir)) scanPackageDirs(packageStoreDir, packageDirs);

    // Sibling packages if this package is inside a packages/ collection or monorepo
    const parentDir = path.dirname(packageRoot);
    if (path.basename(parentDir) === "packages" && fs.existsSync(parentDir)) {
      scanPackageDirs(parentDir, packageDirs);
    }
  }

  // 2. If inside a project (shortcircuit.json)
  if (projectFile) {
    projectRoot = path.dirname(projectFile);

    const storeDir = path.join(projectRoot, ".shortcircuit", "packages");
    if (fs.existsSync(storeDir)) scanPackageDirs(storeDir, packageDirs);

    const localPackagesDir = path.join(projectRoot, "packages");
    if (fs.existsSync(localPackagesDir)) scanPackageDirs(localPackagesDir, packageDirs);

    try {
      const projectManifest = JSON.parse(fs.readFileSync(projectFile, "utf-8")) as {
        dependencies?: Record<string, string>;
      };
      if (projectManifest && typeof projectManifest.dependencies === "object") {
        for (const depSpec of Object.values(projectManifest.dependencies)) {
          if (typeof depSpec === "string" && depSpec.startsWith("path:")) {
            const relative = depSpec.slice(5).trim();
            const absolute = path.resolve(projectRoot, relative);
            if (fs.existsSync(path.join(absolute, "manifest.json"))) {
              addPackageDir(packageDirs, absolute);
            }
          }
        }
      }
    } catch {
      // Ignore invalid JSON in shortcircuit.json.
    }
  }

  const byName = new Map<string, LoadedPackage>();
  for (const packageDir of packageDirs) {
    const manifest = loadPackageFromDir(packageDir);
    if (manifest) byName.set(manifest.name, { dir: packageDir, manifest });
  }

  return {
    packages: Array.from(byName.values()),
    implicitImports,
    enclosingPackageName,
    projectRoot,
    packageRoot,
  };
}

function getContext(dir: string): ContextCacheEntry {
  const key = path.resolve(dir);
  const cached = contextCache.get(key);
  if (cached) {
    // Refresh recency for a small LRU.
    contextCache.delete(key);
    contextCache.set(key, cached);
    return cached;
  }

  const context = discoverContext(key);
  contextCache.set(key, context);
  while (contextCache.size > CONTEXT_CACHE_LIMIT) {
    const oldest = contextCache.keys().next().value;
    if (oldest === undefined) break;
    contextCache.delete(oldest);
  }
  return context;
}

/**
 * Builds the package bundle available to a file.
 *
 * Discovery is cached per directory, and only the export that points at the
 * file being compiled is filtered out. Unsaved buffers can override any
 * package source through {@link ResolveWorkspaceOptions.openSources}.
 */
export function resolveWorkspaceContext(
  filePath: string,
  fileContent?: string,
  options: ResolveWorkspaceOptions = {},
): ResolvedWorkspaceContext {
  const resolvedPath = path.resolve(filePath);
  const context = getContext(path.dirname(resolvedPath));

  const overrides = new Map<string, string>(options.openSources ?? []);
  if (fileContent !== undefined) overrides.set(resolvedPath, fileContent);

  const packages = context.packages.map(({ dir, manifest }) => {
    let changed = false;
    const exports: PackageExport[] = [];

    for (const entry of manifest.exports) {
      const sourcePath = path.resolve(dir, entry.source);
      if (sourcePath === resolvedPath) {
        // The file is compiled by the editor itself; keeping its package copy
        // would define the same circuit twice.
        changed = true;
        continue;
      }

      const openText = overrides.get(sourcePath);
      if (openText !== undefined && openText !== entry.sourceText) {
        changed = true;
        exports.push({ ...entry, sourceText: openText });
      } else {
        exports.push(entry);
      }
    }

    return changed ? { ...manifest, exports } : manifest;
  });

  const bundle: PackageBundle = {
    schema: "shortcircuit.packages/v1",
    packages,
  };

  return {
    bundle,
    implicitImports: context.implicitImports,
    enclosingPackageName: context.enclosingPackageName,
    projectRoot: context.projectRoot,
    packageRoot: context.packageRoot,
  };
}
