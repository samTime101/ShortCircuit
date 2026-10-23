import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  isPathSpec,
  makePathSpec,
  packageShortName,
  pathSpecValue,
  validatePackageName,
  validateRange,
  validateVersion,
} from "./packageSpec";

export const PROJECT_SCHEMA = "shortcircuit.project/v1";
export const PACKAGE_SCHEMA = "shortcircuit.package/v1";
export const LOCK_SCHEMA = "shortcircuit.lock/v1";
export const DEFAULT_REGISTRY_URL =
  "https://raw.githubusercontent.com/samTime101/ShortCircuit-Packages/main/registry.json";

export interface ProjectManifest {
  schema: typeof PROJECT_SCHEMA;
  dependencies: Record<string, string>;
  registry?: string;
}

export type RootKind = "project" | "package";

export interface RootContext {
  kind: RootKind;
  root: string;
  manifestPath: string;
  lockPath: string;
}

export interface RootState {
  context: RootContext;
  name?: string;
  version?: string;
  dependencies: Record<string, string>;
  registry?: string;
}

export interface LockedPackage {
  version: string;
  type: "path" | "registry";
  /** Project-relative directory for a path dependency. */
  path?: string;
  /** Registry package base URL. */
  resolved?: string;
  /** SHA-256 over the registry package payload. */
  integrity?: string;
  dependencies?: Record<string, string>;
}

export interface LockFile {
  schema: typeof LOCK_SCHEMA;
  packages: Record<string, LockedPackage>;
}

export interface LocalPackageIdentity {
  dir: string;
  name: string;
  version: string;
}

export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectError";
  }
}

function fail(message: string): never {
  throw new ProjectError(message);
}

export function readJsonObject(path: string, label: string): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    fail(`Could not read ${label} at ${path}.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    fail(`${label} at ${path} is not valid JSON.${detail}`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} at ${path} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function dependenciesFrom(
  raw: unknown,
  label: string,
): Record<string, string> {
  if (raw === undefined) return {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail(`${label} dependencies must be an object.`);
  }
  const dependencies: Record<string, string> = {};
  for (const [rawName, rawRange] of Object.entries(raw as Record<string, unknown>)) {
    const name = validatePackageName(rawName);
    if (typeof rawRange !== "string") {
      fail(`${label} dependency ${name} must have a string version or path.`);
    }
    dependencies[name] = validateRange(rawRange);
  }
  return dependencies;
}

function sortedDependencies(dependencies: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(dependencies).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function isPackageManifestFile(path: string): boolean {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { schema?: unknown };
    return raw.schema === PACKAGE_SCHEMA;
  } catch {
    return false;
  }
}

/**
 * Find the nearest project (`shortcircuit.json`) or package (`manifest.json`)
 * root. A project root wins when both files are in the same directory.
 */
export function findRoot(start: string): RootContext | null {
  let directory = resolve(start);
  while (true) {
    const projectManifest = join(directory, "shortcircuit.json");
    if (existsSync(projectManifest)) {
      return {
        kind: "project",
        root: directory,
        manifestPath: projectManifest,
        lockPath: join(directory, "shortcircuit.lock.json"),
      };
    }
    const packageManifest = join(directory, "manifest.json");
    if (existsSync(packageManifest) && isPackageManifestFile(packageManifest)) {
      return {
        kind: "package",
        root: directory,
        manifestPath: packageManifest,
        lockPath: join(directory, "shortcircuit.lock.json"),
      };
    }
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

export function requireRoot(start: string): RootContext {
  const context = findRoot(start);
  if (!context) {
    fail(
      "No Short Circuit project or package found. Run shortcircuit init for a project " +
        "or shortcircuit package init for a package.",
    );
  }
  return context;
}

export function requirePackageRoot(start: string): RootContext {
  const context = requireRoot(start);
  if (context.kind !== "package") {
    fail(
      "This command must run inside a package directory with a manifest.json. " +
        "Run shortcircuit package init to create one.",
    );
  }
  return context;
}

export function readProjectManifest(context: RootContext): ProjectManifest {
  const raw = readJsonObject(context.manifestPath, "Project manifest");
  if (raw.schema !== PROJECT_SCHEMA) {
    fail(`Project manifest at ${context.manifestPath} does not use ${PROJECT_SCHEMA}.`);
  }
  if (raw.registry !== undefined && typeof raw.registry !== "string") {
    fail(`Project manifest registry must be a URL string.`);
  }
  return {
    schema: PROJECT_SCHEMA,
    dependencies: sortedDependencies(dependenciesFrom(raw.dependencies, "Project manifest")),
    ...(typeof raw.registry === "string" ? { registry: raw.registry } : {}),
  };
}

export function writeProjectManifest(context: RootContext, manifest: ProjectManifest): void {
  writeJson(context.manifestPath, {
    schema: PROJECT_SCHEMA,
    dependencies: sortedDependencies(manifest.dependencies),
    ...(manifest.registry ? { registry: manifest.registry } : {}),
  });
}

export function readRootState(context: RootContext): RootState {
  if (context.kind === "project") {
    const manifest = readProjectManifest(context);
    return {
      context,
      dependencies: manifest.dependencies,
      ...(manifest.registry ? { registry: manifest.registry } : {}),
    };
  }

  const raw = readJsonObject(context.manifestPath, "Package manifest");
  if (raw.schema !== PACKAGE_SCHEMA) {
    fail(`Package manifest at ${context.manifestPath} does not use ${PACKAGE_SCHEMA}.`);
  }
  if (typeof raw.name !== "string" || !raw.name.trim()) {
    fail(`Package manifest at ${context.manifestPath} needs a name.`);
  }
  if (typeof raw.version !== "string" || !raw.version.trim()) {
    fail(`Package manifest at ${context.manifestPath} needs a version.`);
  }
  const name = validatePackageName(raw.name);
  const version = validateVersion(raw.version);
  return {
    context,
    name,
    version,
    dependencies: sortedDependencies(dependenciesFrom(raw.dependencies, `Package ${name}`)),
    ...(typeof raw.registry === "string" ? { registry: raw.registry } : {}),
  };
}

export function writeRootDependencies(
  state: RootState,
  dependencies: Record<string, string>,
): void {
  const context = state.context;
  if (context.kind === "project") {
    const manifest = readProjectManifest(context);
    writeProjectManifest(context, {
      ...manifest,
      dependencies: sortedDependencies(dependencies),
    });
    return;
  }

  const raw = readJsonObject(context.manifestPath, "Package manifest");
  writeJson(context.manifestPath, {
    ...raw,
    dependencies: sortedDependencies(dependencies),
  });
}

export function emptyLock(): LockFile {
  return { schema: LOCK_SCHEMA, packages: {} };
}

function validateLockedPackage(name: string, value: unknown): LockedPackage {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`Lockfile entry ${name} must be an object.`);
  }
  const raw = value as Record<string, unknown>;
  if (raw.type !== "path" && raw.type !== "registry") {
    fail(`Lockfile entry ${name} type must be "path" or "registry".`);
  }
  if (typeof raw.version !== "string") {
    fail(`Lockfile entry ${name} needs a version.`);
  }
  const version = validateVersion(raw.version);
  if (raw.type === "path") {
    if (typeof raw.path !== "string" || !raw.path.trim()) {
      fail(`Lockfile path entry ${name} needs a path.`);
    }
    return {
      version,
      type: "path",
      path: raw.path,
      ...(raw.dependencies === undefined
        ? {}
        : { dependencies: dependenciesFrom(raw.dependencies, `Lockfile entry ${name}`) }),
    };
  }
  if (raw.resolved !== undefined && typeof raw.resolved !== "string") {
    fail(`Lockfile entry ${name} resolved must be a URL.`);
  }
  if (raw.integrity !== undefined && typeof raw.integrity !== "string") {
    fail(`Lockfile entry ${name} integrity must be a string.`);
  }
  return {
    version,
    type: "registry",
    ...(typeof raw.resolved === "string" ? { resolved: raw.resolved } : {}),
    ...(typeof raw.integrity === "string" ? { integrity: raw.integrity } : {}),
    ...(raw.dependencies === undefined
      ? {}
      : { dependencies: dependenciesFrom(raw.dependencies, `Lockfile entry ${name}`) }),
  };
}

export function readLock(context: RootContext): LockFile {
  if (!existsSync(context.lockPath)) return emptyLock();
  const raw = readJsonObject(context.lockPath, "Lockfile");
  if (raw.schema !== LOCK_SCHEMA) {
    fail(`Lockfile at ${context.lockPath} does not use ${LOCK_SCHEMA}.`);
  }
  if (raw.packages === null || typeof raw.packages !== "object" || Array.isArray(raw.packages)) {
    fail(`Lockfile at ${context.lockPath} packages must be an object.`);
  }
  const packages: Record<string, LockedPackage> = {};
  for (const [rawName, value] of Object.entries(raw.packages as Record<string, unknown>)) {
    const name = validatePackageName(rawName);
    packages[name] = validateLockedPackage(name, value);
  }
  return { schema: LOCK_SCHEMA, packages };
}

export function writeLock(context: RootContext, lock: LockFile): void {
  const packages = Object.fromEntries(
    Object.entries(lock.packages).sort(([left], [right]) => left.localeCompare(right)),
  );
  writeJson(context.lockPath, { schema: LOCK_SCHEMA, packages });
}

export function storeDirectory(root: string): string {
  return join(root, ".shortcircuit", "packages");
}

export function storePackageDirectory(root: string, name: string): string {
  validatePackageName(name);
  return join(storeDirectory(root), ...name.split("/"));
}

export function relativeDependencyPath(root: string, directory: string): string {
  return makePathSpec(relativePackagePath(root, directory));
}

export function relativePackagePath(root: string, directory: string): string {
  return relative(root, directory).replaceAll("\\", "/") || ".";
}

export function resolveDependencyPath(root: string, spec: string): string {
  if (!isPathSpec(spec)) fail(`Dependency spec ${spec} is not a path dependency.`);
  const value = pathSpecValue(spec);
  if (!value) fail(`Path dependency ${spec} needs a directory.`);
  return resolve(root, value);
}

export function cacheDirectory(env: Record<string, string | undefined>): string {
  const configured = env.SHORTCIRCUIT_CACHE;
  if (configured) return resolve(configured);
  const xdg = env.XDG_CACHE_HOME;
  if (xdg) return join(xdg, "shortcircuit");
  return join(homedir(), ".cache", "shortcircuit");
}

export function registryUrlFor(
  state: RootState,
  env: Record<string, string | undefined>,
): string {
  return (
    env.SHORTCIRCUIT_REGISTRY_URL ??
    state.registry ??
    DEFAULT_REGISTRY_URL
  );
}

function packageIdentityAt(directory: string): LocalPackageIdentity | null {
  const manifestPath = join(directory, "manifest.json");
  if (!existsSync(manifestPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    if (
      raw.schema !== PACKAGE_SCHEMA ||
      typeof raw.name !== "string" ||
      typeof raw.version !== "string"
    ) {
      return null;
    }
    return {
      dir: resolve(directory),
      name: validatePackageName(raw.name),
      version: validateVersion(raw.version),
    };
  } catch {
    return null;
  }
}

function isPathLikeQuery(query: string): boolean {
  if (query.startsWith("@")) return false;
  return (
    query.startsWith(".") ||
    query.startsWith("/") ||
    query.startsWith("~") ||
    /^[A-Za-z]:[\\/]/.test(query) ||
    query.includes("/") ||
    query.includes("\\")
  );
}

function expandHomePath(query: string): string {
  if (query === "~") return homedir();
  if (query.startsWith("~/") || query.startsWith("~\\")) {
    return join(homedir(), query.slice(2));
  }
  return query;
}

function candidatePackageDirectories(root: string, query: string): string[] {
  const candidates = new Set<string>();
  if (isPathLikeQuery(query)) {
    const resolved = resolve(root, expandHomePath(query));
    let directory = resolved;
    if (existsSync(resolved) && statSync(resolved).isFile() && basename(resolved) === "manifest.json") {
      directory = dirname(resolved);
    }
    candidates.add(directory);
    return [...candidates];
  }

  const short = packageShortName(query);
  candidates.add(join(root, "packages", query));
  candidates.add(join(root, "packages", short));
  candidates.add(join(root, query));
  candidates.add(join(root, short));

  const packagesDirectory = join(root, "packages");
  if (existsSync(packagesDirectory)) {
    let entries: string[] = [];
    try {
      entries = readdirSync(packagesDirectory);
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const directory = join(packagesDirectory, entry);
      try {
        if (!statSync(directory).isDirectory()) continue;
      } catch {
        continue;
      }
      candidates.add(directory);
      if (entry.startsWith("@")) {
        try {
          for (const child of readdirSync(directory)) {
            candidates.add(join(directory, child));
          }
        } catch {
          // Ignore unreadable scope directories while discovering packages.
        }
      }
    }
  }

  return [...candidates];
}

/**
 * Resolve a local package by scoped name or by directory. The returned package
 * is read in place; nothing is copied or symlinked into the project.
 */
export function findLocalPackage(root: string, query: string): LocalPackageIdentity {
  const candidates = candidatePackageDirectories(root, query);
  const matches: LocalPackageIdentity[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const directory = resolve(candidate);
    if (seen.has(directory)) continue;
    seen.add(directory);
    const identity = packageIdentityAt(directory);
    if (!identity) continue;
    if (isPathLikeQuery(query)) {
      matches.push(identity);
      continue;
    }
    if (
      identity.name === query ||
      (!query.includes("/") && packageShortName(identity.name) === query)
    ) {
      matches.push(identity);
    }
  }

  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    fail(
      `Package name "${query}" matches more than one local package:\n` +
        matches.map((match) => `  ${match.name} (${match.dir})`).join("\n") +
        "\nPass the package directory instead.",
    );
  }

  if (isPathLikeQuery(query)) {
    const directory = resolve(root, expandHomePath(query));
    if (!existsSync(directory)) {
      fail(`Could not find a package at ${directory}.`);
    }
    fail(`No manifest.json found in ${directory}.`);
  }

  fail(
    `Could not find a local package named "${query}". ` +
      "Pass the package directory, or create it with shortcircuit package init.",
  );
}

export function isAbsolutePath(value: string): boolean {
  return isAbsolute(value);
}
