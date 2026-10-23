import * as fs from "fs";
import * as path from "path";
import {
  DEFAULT_PACKAGE_BUNDLE,
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

/** Cache of loaded packages by directory to avoid re-reading disk on every keystroke */
interface CacheEntry {
  mtime: number;
  manifest: PackageManifest;
}
const packageCache = new Map<string, CacheEntry>();

/** Clear the package cache (e.g. when manifest files change) */
export function invalidatePackageCache(): void {
  packageCache.clear();
}

/**
 * Searches upward from a starting directory to find a file matching predicate
 */
function findUpward(startDir: string, fileName: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, fileName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

/**
 * Loads a package from a directory containing manifest.json
 */
export function loadPackageFromDir(
  packageDir: string,
  currentFilePath?: string,
  currentFileSource?: string
): PackageManifest | null {
  const manifestPath = path.join(packageDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const stats = fs.statSync(manifestPath);
    const cached = packageCache.get(packageDir);
    let raw: Record<string, unknown>;

    if (cached && cached.mtime === stats.mtimeMs && !currentFileSource) {
      return cached.manifest;
    }

    const manifestText = fs.readFileSync(manifestPath, "utf-8");
    raw = JSON.parse(manifestText);
    if (raw.schema !== "shortcircuit.package/v1" || typeof raw.name !== "string") {
      return null;
    }

    const name = raw.name as string;
    const version = (raw.version as string) || "0.1.0";
    const rawExports = Array.isArray(raw.exports) ? (raw.exports as Array<Record<string, unknown>>) : [];
    const dependencies = (raw.dependencies as Record<string, string>) || {};

    const exports: PackageExport[] = [];
    for (const entry of rawExports) {
      const exportName = entry.name as string;
      const exportSource = entry.source as string;
      const exportKind = (entry.kind as "circuit" | "macro") || "circuit";

      if (!exportName || !exportSource) continue;

      const sourceFullPath = path.resolve(packageDir, exportSource);
      let sourceText = "";

      // If this is the file currently open in the editor, use unsaved buffer
      if (
        currentFilePath &&
        path.resolve(currentFilePath) === sourceFullPath &&
        currentFileSource !== undefined
      ) {
        sourceText = currentFileSource;
      } else if (fs.existsSync(sourceFullPath)) {
        try {
          sourceText = fs.readFileSync(sourceFullPath, "utf-8");
        } catch {
          sourceText = "";
        }
      }

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
          docs: entry.docs as string | undefined,
          summary: entry.summary as string | undefined,
          group: entry.group as string | undefined,
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

    if (!currentFileSource) {
      packageCache.set(packageDir, { mtime: stats.mtimeMs, manifest: loadedManifest });
    }

    return loadedManifest;
  } catch (err) {
    console.warn(`[ShortCircuit] Error loading package from ${packageDir}:`, err);
    return null;
  }
}

/**
 * Discovers and resolves all packages available to a given file
 */
export function resolveWorkspaceContext(
  filePath: string,
  fileContent?: string
): ResolvedWorkspaceContext {
  const dir = path.dirname(path.resolve(filePath));
  const manifestFile = findUpward(dir, "manifest.json");
  const projectFile = findUpward(dir, "shortcircuit.json");

  const packageRoots: string[] = [];
  let enclosingPackageName: string | undefined;
  const implicitImports: string[] = [];
  let packageRoot: string | undefined;
  let projectRoot: string | undefined;

  // 1. If inside an enclosing package (e.g. circuits/add4/circuit.lf)
  if (manifestFile) {
    packageRoot = path.dirname(manifestFile);
    packageRoots.push(packageRoot);

    const enclosingPkg = loadPackageFromDir(packageRoot, filePath, fileContent);
    if (enclosingPkg) {
      enclosingPackageName = enclosingPkg.name;
      implicitImports.push(enclosingPkg.name);

      // Also implicitly import package dependencies so intra-package circuits can use them
      if (enclosingPkg.dependencies) {
        for (const dep of Object.keys(enclosingPkg.dependencies)) {
          if (!implicitImports.includes(dep)) {
            implicitImports.push(dep);
          }
        }
      }
    }
  }

  // 2. If inside a project (shortcircuit.json)
  if (projectFile) {
    projectRoot = path.dirname(projectFile);

    // Installed registry packages in .shortcircuit/packages/
    const storeDir = path.join(projectRoot, ".shortcircuit", "packages");
    if (fs.existsSync(storeDir)) {
      scanPackageDirs(storeDir, packageRoots);
    }

    // Local packages in packages/
    const localPackagesDir = path.join(projectRoot, "packages");
    if (fs.existsSync(localPackagesDir)) {
      scanPackageDirs(localPackagesDir, packageRoots);
    }

    // Path dependencies from shortcircuit.json
    try {
      const projManifest = JSON.parse(fs.readFileSync(projectFile, "utf-8"));
      if (projManifest && typeof projManifest.dependencies === "object") {
        for (const depSpec of Object.values(projManifest.dependencies as Record<string, string>)) {
          if (typeof depSpec === "string" && depSpec.startsWith("path:")) {
            const relPath = depSpec.slice(5).trim();
            const absPath = path.resolve(projectRoot, relPath);
            if (fs.existsSync(path.join(absPath, "manifest.json")) && !packageRoots.includes(absPath)) {
              packageRoots.push(absPath);
            }
          }
        }
      }
    } catch {
      // Ignore invalid JSON in shortcircuit.json
    }
  }

  // Load all manifests
  const loadedPackages = new Map<string, PackageManifest>();

  // Add default bundled packages first as fallback baseline
  for (const pkg of DEFAULT_PACKAGE_BUNDLE.packages) {
    loadedPackages.set(pkg.name, pkg);
  }

  // Override / augment with workspace packages from disk
  const resolvedCurrentPath = path.resolve(filePath);
  for (const pkgDir of packageRoots) {
    const pkg = loadPackageFromDir(pkgDir, filePath, fileContent);
    if (pkg) {
      // Exclude the current file's export from the package to prevent
      // duplicate circuit definitions with the file currently being compiled
      const filteredExports = pkg.exports.filter((exp) => {
        const exportAbsPath = path.resolve(pkgDir, exp.source);
        return exportAbsPath !== resolvedCurrentPath;
      });
      loadedPackages.set(pkg.name, {
        ...pkg,
        exports: filteredExports,
      });
    }
  }

  const bundle: PackageBundle = {
    schema: "shortcircuit.packages/v1",
    packages: Array.from(loadedPackages.values()),
  };

  return {
    bundle,
    implicitImports,
    enclosingPackageName,
    projectRoot,
    packageRoot,
  };
}

/** Recursively scan for directories containing manifest.json up to 3 levels deep */
function scanPackageDirs(baseDir: string, results: string[], depth = 0): void {
  if (depth > 3) return;
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(baseDir, entry.name);
      if (fs.existsSync(path.join(fullPath, "manifest.json"))) {
        if (!results.includes(fullPath)) {
          results.push(fullPath);
        }
      } else {
        scanPackageDirs(fullPath, results, depth + 1);
      }
    }
  } catch {
    // Ignore read errors
  }
}
