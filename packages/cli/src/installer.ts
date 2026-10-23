import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import semver from "semver";
import type { PackageManifest } from "@shortcircuit/engine/core";
import {
  emptyLock,
  findLocalPackage,
  type LockFile,
  type LockedPackage,
  type RootContext,
  type RootState,
  readJsonObject,
  readLock,
  readRootState,
  relativeDependencyPath,
  relativePackagePath,
  resolveDependencyPath,
  storePackageDirectory,
  writeLock,
  writeRootDependencies,
} from "./project";
import {
  findRegistryPackage,
  findRegistryVersion,
  latestRegistryVersion,
  loadRegistryIndex,
  normalizePackageFile,
  fetchPackageManifest,
  fetchRemotePackage,
  cachedRemotePackage,
  versionSatisfying,
  type FetchLike,
  type RegistryIndex,
  type RegistryPackageEntry,
  type RegistryVersion,
  type RemotePackage,
} from "./registry";
import {
  isPathSpec as isPathDependencySpec,
  packageShortName,
  parsePackageRequest,
  validatePackageName,
  validateRange,
} from "./packageSpec";
import { loadLocalPackages } from "./packages";

export interface ManagerOptions {
  registryUrl: string;
  cacheDir: string;
  fetch?: FetchLike;
  offline?: boolean;
  refresh?: boolean;
  force?: boolean;
  saveExact?: boolean;
  latest?: boolean;
  frozen?: boolean;
  preferLock?: boolean;
  updateNames?: string[] | "all";
}

export interface InstallSummary {
  lock: LockFile;
  installed: string[];
  removed: string[];
}

export interface InstalledPackageRow {
  name: string;
  version: string;
  origin: "local" | "registry";
  path: string;
  exports: number | null;
  state: "ok" | "missing" | "not installed";
}

export interface UpstreamPackageRow {
  name: string;
  version: string;
  description?: string;
  exports: number | null;
  installedVersion?: string;
  state: "ok" | "error";
  error?: string;
}

interface ResolvedPackage {
  name: string;
  version: string;
  type: "path" | "registry";
  path?: string;
  resolved?: string;
  integrity?: string;
  dependencies: Record<string, string>;
  manifest?: PackageManifest;
  remote?: RemotePackage;
}

function fail(message: string): never {
  throw new Error(message);
}

function packageContext(directory: string): RootContext {
  return {
    kind: "package",
    root: resolve(directory),
    manifestPath: join(resolve(directory), "manifest.json"),
    lockPath: join(resolve(directory), "shortcircuit.lock.json"),
  };
}

function readPackageStateAt(directory: string): RootState {
  return readRootState(packageContext(directory));
}

function shouldUpdate(options: ManagerOptions, name: string): boolean {
  return (
    options.updateNames === "all" ||
    (Array.isArray(options.updateNames) && options.updateNames.includes(name))
  );
}

function satisfies(version: string, ranges: string[]): boolean {
  return ranges.every((range) => semver.satisfies(version, range));
}

function remoteDependencies(remote: RemotePackage): Record<string, string> {
  const dependencies: Record<string, string> = {};
  for (const [rawName, rawRange] of Object.entries(remote.manifest.dependencies ?? {})) {
    const name = validatePackageName(rawName);
    if (isPathDependencySpec(rawRange)) {
      fail(
        `Registry package ${remote.name}@${remote.version} cannot use path dependency ${name}.`,
      );
    }
    dependencies[name] = validateRange(rawRange);
  }
  return dependencies;
}

function remoteResolved(remote: RemotePackage): ResolvedPackage {
  return {
    name: remote.name,
    version: remote.version,
    type: "registry",
    resolved: remote.resolved,
    integrity: remote.integrity,
    dependencies: remoteDependencies(remote),
    manifest: remote.manifest,
    remote,
  };
}

function storedResolved(
  name: string,
  lock: LockedPackage,
  state: RootState,
): ResolvedPackage {
  return {
    name,
    version: state.version ?? lock.version,
    type: "registry",
    ...(lock.resolved ? { resolved: lock.resolved } : {}),
    ...(lock.integrity ? { integrity: lock.integrity } : {}),
    dependencies: state.dependencies,
  };
}

/**
 * Resolve root path dependencies and path dependencies declared by other path
 * packages. Path packages are read in place and never copied or symlinked.
 */
function buildPathPackages(state: RootState): Map<string, ResolvedPackage> {
  const root = state.context.root;
  const packages = new Map<string, ResolvedPackage>();
  const queue: Array<{ name: string; spec: string; base: string }> = [];
  for (const [name, spec] of Object.entries(state.dependencies)) {
    if (isPathDependencySpec(spec)) queue.push({ name, spec, base: root });
  }

  while (queue.length > 0) {
    const entry = queue.shift()!;
    const directory = resolveDependencyPath(entry.base, entry.spec);
    if (directory === root) {
      fail(`Package ${entry.name} cannot link to itself.`);
    }
    if (!existsSync(directory)) {
      fail(`Path dependency ${entry.name} points to ${directory}, which does not exist.`);
    }
    const dependencyState = readPackageStateAt(directory);
    if (dependencyState.name !== entry.name) {
      fail(
        `Path dependency ${entry.name} points to a package named ${dependencyState.name}. ` +
          "The dependency name and manifest name must match.",
      );
    }
    const existing = packages.get(entry.name);
    if (existing) {
      if (existing.path !== relativePackagePath(root, directory)) {
        fail(
          `Package ${entry.name} is linked from both ${existing.path} and ` +
            `${relativePackagePath(root, directory)}.`,
        );
      }
      continue;
    }
    packages.set(entry.name, {
      name: entry.name,
      version: dependencyState.version ?? "0.0.0",
      type: "path",
      path: relativePackagePath(root, directory),
      dependencies: dependencyState.dependencies,
    });
    for (const [dependencyName, dependencySpec] of Object.entries(
      dependencyState.dependencies,
    )) {
      if (isPathDependencySpec(dependencySpec)) {
        queue.push({ name: dependencyName, spec: dependencySpec, base: directory });
      }
    }
  }

  return packages;
}

function collectRequirements(
  state: RootState,
  pathPackages: Map<string, ResolvedPackage>,
  selected: Map<string, ResolvedPackage>,
): Map<string, string[]> {
  const requirements = new Map<string, string[]>();
  const add = (name: string, rawRange: string, source: string) => {
    const range = validateRange(rawRange);
    if (isPathDependencySpec(range)) {
      if (!pathPackages.has(name)) {
        fail(`${source} uses a path dependency for ${name}, but it is not linked.`);
      }
      return;
    }
    const ranges = requirements.get(name) ?? [];
    if (!ranges.includes(range)) ranges.push(range);
    requirements.set(name, ranges);
  };

  for (const [name, spec] of Object.entries(state.dependencies)) {
    if (isPathDependencySpec(spec)) {
      if (!pathPackages.has(name)) fail(`Path dependency ${name} is not linked.`);
      continue;
    }
    add(name, spec, "The root manifest");
  }

  for (const entry of pathPackages.values()) {
    for (const [name, spec] of Object.entries(entry.dependencies)) {
      if (isPathDependencySpec(spec)) {
        if (!pathPackages.has(name)) {
          fail(`Package ${entry.name} uses a path dependency for ${name}, but it is not linked.`);
        }
        continue;
      }
      add(name, spec, `Package ${entry.name}`);
    }
  }

  for (const entry of selected.values()) {
    if (entry.type === "path") continue;
    for (const [name, spec] of Object.entries(entry.dependencies)) {
      if (isPathDependencySpec(spec)) {
        fail(
          `Registry package ${entry.name}@${entry.version} cannot use path dependency ${name}.`,
        );
      }
      add(name, spec, `Package ${entry.name}@${entry.version}`);
    }
  }

  return requirements;
}

function sameSelections(
  left: Map<string, ResolvedPackage>,
  right: Map<string, ResolvedPackage>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [name, entry] of left) {
    const other = right.get(name);
    if (!other || other.version !== entry.version || other.type !== entry.type) return false;
  }
  return true;
}

function sameRequirements(
  left: Map<string, string[]>,
  right: Map<string, string[]>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [name, ranges] of left) {
    const other = right.get(name);
    if (!other || other.length !== ranges.length) return false;
    const sorted = [...ranges].sort();
    const otherSorted = [...other].sort();
    if (sorted.some((range, index) => range !== otherSorted[index])) return false;
  }
  return true;
}

function chooseVersionError(
  name: string,
  ranges: string[],
  entry: RegistryPackageEntry,
): never {
  const available = entry.versions.map((version) => version.version).join(", ");
  fail(
    `No version of ${name} satisfies ${ranges.map((range) => `"${range}"`).join(" and ")}. ` +
      `Available versions: ${available || "none"}.`,
  );
}

async function getIndex(
  options: ManagerOptions,
  holder: { value?: RegistryIndex },
): Promise<RegistryIndex> {
  if (!holder.value) {
    holder.value = await loadRegistryIndex({
      url: options.registryUrl,
      cacheDir: options.cacheDir,
      fetch: options.fetch,
      offline: options.offline,
      refresh: options.refresh,
    });
  }
  return holder.value;
}

async function choosePackage(
  state: RootState,
  name: string,
  ranges: string[],
  lock: LockFile,
  options: ManagerOptions,
  indexHolder: { value?: RegistryIndex },
): Promise<ResolvedPackage> {
  const locked = lock.packages[name];
  const update = shouldUpdate(options, name);
  const preferLock = options.preferLock !== false;
  const canReuseLock =
    preferLock &&
    !update &&
    locked?.type === "registry" &&
    satisfies(locked.version, ranges);

  if (canReuseLock) {
    const directory = storePackageDirectory(state.context.root, name);
    if (existsSync(join(directory, "manifest.json"))) {
      try {
        const stored = readPackageStateAt(directory);
        if (stored.name === name && stored.version === locked.version) {
          return storedResolved(name, locked, stored);
        }
      } catch {
        // Fall through to the registry if the store is damaged.
      }
    }
    const cached = cachedRemotePackage(options.cacheDir, name, locked.version);
    if (cached) return remoteResolved(cached);
    if (options.offline) {
      fail(
        `Package ${name}@${locked.version} is not installed and is not in the cache. ` +
          "Run the command once online, or remove --offline.",
      );
    }
    const index = await getIndex(options, indexHolder);
    const entry = findRegistryPackage(index, name);
    const version = findRegistryVersion(entry, locked.version);
    const remote = await fetchRemotePackage(index, entry, version, {
      cacheDir: options.cacheDir,
      fetch: options.fetch,
      offline: options.offline,
      refresh: options.refresh,
    });
    return remoteResolved(remote);
  }

  const index = await getIndex(options, indexHolder);
  const entry = findRegistryPackage(index, name);
  const version = versionSatisfying(entry, ranges);
  if (!version) chooseVersionError(name, ranges, entry);
  const remote = await fetchRemotePackage(index, entry, version, {
    cacheDir: options.cacheDir,
    fetch: options.fetch,
    offline: options.offline,
    refresh: options.refresh,
  });
  return remoteResolved(remote);
}

function lockFor(selected: Map<string, ResolvedPackage>): LockFile {
  const lock = emptyLock();
  for (const [name, entry] of selected) {
    if (entry.type === "path") {
      lock.packages[name] = {
        version: entry.version,
        type: "path",
        path: entry.path ?? ".",
        dependencies: entry.dependencies,
      };
      continue;
    }
    lock.packages[name] = {
      version: entry.version,
      type: "registry",
      ...(entry.resolved ? { resolved: entry.resolved } : {}),
      ...(entry.integrity ? { integrity: entry.integrity } : {}),
      dependencies: entry.dependencies,
    };
  }
  return lock;
}

async function writeRemotePackage(
  root: string,
  remote: RemotePackage,
): Promise<void> {
  const target = storePackageDirectory(root, remote.name);
  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  const temporary = await mkdtemp(join(parent, ".shortcircuit-package-"));
  try {
    for (const [rawPath, contents] of Object.entries(remote.files)) {
      const path = normalizePackageFile(rawPath);
      const file = join(temporary, path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, contents);
    }
    await rm(target, { recursive: true, force: true });
    await rename(temporary, target);
    try {
      loadLocalPackages([target]);
    } catch (error) {
      await rm(target, { recursive: true, force: true });
      throw error;
    }
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

function oldRegistryEntries(lock: LockFile): Map<string, LockedPackage> {
  return new Map(
    Object.entries(lock.packages).filter(([, entry]) => entry.type === "registry"),
  );
}

async function installResolvedPackages(
  state: RootState,
  selected: Map<string, ResolvedPackage>,
  oldLock: LockFile,
  options: ManagerOptions,
  indexHolder: { value?: RegistryIndex },
): Promise<{ installed: string[]; removed: string[] }> {
  const installed: string[] = [];
  for (const entry of selected.values()) {
    if (entry.type !== "registry") continue;
    const target = storePackageDirectory(state.context.root, entry.name);
    const old = oldLock.packages[entry.name];
    const alreadyCurrent =
      old?.type === "registry" &&
      old.version === entry.version &&
      old.integrity === entry.integrity &&
      existsSync(join(target, "manifest.json"));
    if (alreadyCurrent) continue;

    let remote = entry.remote;
    if (!remote) {
      remote = cachedRemotePackage(options.cacheDir, entry.name, entry.version) ?? undefined;
    }
    if (!remote) {
      if (existsSync(join(target, "manifest.json"))) {
        const stored = readPackageStateAt(target);
        if (stored.version === entry.version) continue;
      }
      if (options.offline) {
        fail(
          `Package ${entry.name}@${entry.version} is not installed and is not cached. ` +
            "Run the command once online, or remove --offline.",
        );
      }
      const index = await getIndex(options, indexHolder);
      const registryEntry = findRegistryPackage(index, entry.name);
      const version = findRegistryVersion(registryEntry, entry.version);
      remote = await fetchRemotePackage(index, registryEntry, version, {
        cacheDir: options.cacheDir,
        fetch: options.fetch,
        offline: options.offline,
        refresh: options.refresh,
      });
    }
    await writeRemotePackage(state.context.root, remote);
    installed.push(entry.name);
  }

  const newLock = lockFor(selected);
  writeLock(state.context, newLock);
  const removed: string[] = [];
  for (const [name, entry] of oldRegistryEntries(oldLock)) {
    const current = newLock.packages[name];
    if (current?.type !== "registry") {
      rmSync(storePackageDirectory(state.context.root, name), {
        recursive: true,
        force: true,
      });
      removed.push(name);
    }
  }
  return { installed, removed };
}

export async function installAll(
  state: RootState,
  options: ManagerOptions,
): Promise<InstallSummary> {
  if (options.frozen) {
    verifyFrozen(state);
    return { lock: readLock(state.context), installed: [], removed: [] };
  }

  const lock = readLock(state.context);
  const oldLock = lock;
  const pathPackages = buildPathPackages(state);
  let selected = new Map<string, ResolvedPackage>();
  const indexHolder: { value?: RegistryIndex } = {};

  for (let pass = 0; pass < 100; pass += 1) {
    const requirements = collectRequirements(state, pathPackages, selected);
    const next = new Map<string, ResolvedPackage>();

    for (const [name, entry] of pathPackages) {
      const ranges = requirements.get(name);
      if (ranges && !satisfies(entry.version, ranges)) {
        fail(
          `Linked package ${name}@${entry.version} does not satisfy ` +
            `${ranges.map((range) => `"${range}"`).join(" and ")}. ` +
            "Update the dependency range or link a compatible package.",
        );
      }
      next.set(name, entry);
    }

    for (const [name, ranges] of requirements) {
      if (pathPackages.has(name)) continue;
      const current = selected.get(name);
      if (
        current &&
        current.type === "registry" &&
        satisfies(current.version, ranges) &&
        !shouldUpdate(options, name)
      ) {
        next.set(name, current);
        continue;
      }
      next.set(
        name,
        await choosePackage(state, name, ranges, lock, options, indexHolder),
      );
    }

    const changed = !sameSelections(next, selected);
    selected = next;
    if (!changed) {
      const updatedRequirements = collectRequirements(state, pathPackages, selected);
      if (sameRequirements(requirements, updatedRequirements)) {
        const result = await installResolvedPackages(
          state,
          selected,
          oldLock,
          options,
          indexHolder,
        );
        return { lock: lockFor(selected), ...result };
      }
    }
  }

  fail("Could not resolve package dependencies after 100 passes. Check for a dependency cycle.");
}

function verifyFrozen(state: RootState): void {
  const lock = readLock(state.context);
  const pathPackages = buildPathPackages(state);
  const selected = new Map<string, ResolvedPackage>();

  for (const [name, entry] of pathPackages) {
    const locked = lock.packages[name];
    if (!locked || locked.type !== "path") {
      fail(
        `Linked package ${name} is missing from the lockfile. ` +
          "Run shortcircuit package install without --frozen.",
      );
    }
    const lockedDirectory = resolve(state.context.root, locked.path ?? ".");
    const packageDirectory = resolve(state.context.root, entry.path ?? ".");
    if (lockedDirectory !== packageDirectory) {
      fail(
        `Package ${name} is locked at ${locked.path ?? "."}, but it is linked from ` +
          `${entry.path ?? "."}. Run shortcircuit package install.`,
      );
    }
    if (locked.version !== entry.version) {
      fail(
        `Package ${name} is locked at ${locked.version}, but the linked package has ` +
          `${entry.version}. Run shortcircuit package install.`,
      );
    }
    selected.set(name, entry);
  }

  for (const [name, entry] of Object.entries(lock.packages)) {
    if (entry.type === "path") {
      if (!pathPackages.has(name)) {
        fail(
          `Lockfile path package ${name} is no longer linked by the manifest. ` +
            "Run shortcircuit package install.",
        );
      }
      continue;
    }
    const directory = storePackageDirectory(state.context.root, name);
    if (!existsSync(join(directory, "manifest.json"))) {
      fail(
        `Package ${name}@${entry.version} is missing from .shortcircuit/packages. ` +
          "Run shortcircuit package install without --frozen.",
      );
    }
    const stored = readPackageStateAt(directory);
    if (stored.name !== name) {
      fail(
        `Package ${name} is stored at ${directory}, but its manifest names ` +
          `${stored.name ?? "an unknown package"}.`,
      );
    }
    if (stored.version !== entry.version) {
      fail(
        `Package ${name} is locked at ${entry.version}, but the store has ` +
          `${stored.version ?? "an unknown version"}.`,
      );
    }
    selected.set(name, storedResolved(name, entry, stored));
  }

  const requirements = collectRequirements(state, pathPackages, selected);
  for (const [name, ranges] of requirements) {
    const entry = selected.get(name);
    if (!entry) {
      fail(
        `Package ${name} is required by the manifest but missing from the lockfile. ` +
          "Run shortcircuit package install.",
      );
    }
    if (!satisfies(entry.version, ranges)) {
      fail(
        `Locked package ${name}@${entry.version} does not satisfy ` +
          `${ranges.map((range) => `"${range}"`).join(" and ")}. ` +
          "Run shortcircuit package update.",
      );
    }
  }
}

function directDependencyName(
  dependencies: Record<string, string>,
  query: string,
): string {
  if (dependencies[query] !== undefined) return query;
  const matches = Object.keys(dependencies).filter(
    (name) => packageShortName(name) === query,
  );
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    fail(
      `Package name "${query}" matches more than one dependency: ${matches.join(", ")}. ` +
        "Use the full scoped name.",
    );
  }
  fail(`Package ${query} is not a direct dependency of this project.`);
}

export async function installPackage(
  state: RootState,
  request: string,
  options: ManagerOptions,
): Promise<InstallSummary> {
  if (options.frozen) fail("package install <name> cannot be used with --frozen.");
  const parsed = parsePackageRequest(request);
  const index = await loadRegistryIndex({
    url: options.registryUrl,
    cacheDir: options.cacheDir,
    fetch: options.fetch,
    offline: options.offline,
    refresh: options.offline ? false : true,
  });
  const entry = findRegistryPackage(index, parsed.name);
  const version = parsed.range
    ? versionSatisfying(entry, [parsed.range])
    : latestRegistryVersion(entry);
  if (!version) chooseVersionError(parsed.name, [parsed.range ?? "*"], entry);

  const existing = state.dependencies[parsed.name];
  if (existing !== undefined && isPathDependencySpec(existing) && !options.force) {
    fail(
      `Package ${parsed.name} is linked from ${existing}. ` +
        "Use --force to replace the link with a registry package.",
    );
  }

  const range = options.saveExact
    ? version.version
    : parsed.range && parsed.range !== "*"
      ? parsed.range
      : `^${version.version}`;
  const original = { ...state.dependencies };
  writeRootDependencies(state, { ...state.dependencies, [parsed.name]: range });
  try {
    return await installAll(
      { ...state, dependencies: { ...state.dependencies, [parsed.name]: range } },
      { ...options, preferLock: true, updateNames: [parsed.name], refresh: options.refresh },
    );
  } catch (error) {
    writeRootDependencies(state, original);
    throw error;
  }
}

export async function updatePackages(
  state: RootState,
  query: string | undefined,
  options: ManagerOptions,
): Promise<InstallSummary> {
  if (options.frozen) fail("package update cannot be used with --frozen.");
  const original = { ...state.dependencies };
  const dependencies = { ...state.dependencies };
  const registryNames = Object.entries(dependencies)
    .filter(([, spec]) => !isPathDependencySpec(spec))
    .map(([name]) => name);
  let names: string[];
  if (query) {
    const name = directDependencyName(dependencies, query);
    if (isPathDependencySpec(dependencies[name]!)) {
      fail(
        `Package ${name} is linked from ${dependencies[name]}. ` +
          "Update the linked package directory instead.",
      );
    }
    names = [name];
  } else {
    names = registryNames;
  }
  if (names.length === 0) {
    return { lock: readLock(state.context), installed: [], removed: [] };
  }

  // Refresh the index once for update operations so a new release is visible
  // even when the normal cache is still fresh. installAll then reuses this
  // cache instead of downloading the index a second time.
  const index = await loadRegistryIndex({
    url: options.registryUrl,
    cacheDir: options.cacheDir,
    fetch: options.fetch,
    offline: options.offline,
    refresh: options.offline ? false : true,
  });
  if (options.latest) {
    for (const name of names) {
      const entry = findRegistryPackage(index, name);
      const latest = latestRegistryVersion(entry);
      dependencies[name] = `^${latest.version}`;
    }
    writeRootDependencies(state, dependencies);
  }

  try {
    return await installAll(
      { ...state, dependencies },
      {
        ...options,
        preferLock: true,
        updateNames: names,
        refresh: options.refresh,
      },
    );
  } catch (error) {
    if (options.latest) writeRootDependencies(state, original);
    throw error;
  }
}

function reachablePackages(
  dependencies: Record<string, string>,
  lock: LockFile,
): Set<string> {
  const reachable = new Set<string>();
  const queue = Object.keys(dependencies);
  while (queue.length > 0) {
    const name = queue.pop()!;
    if (reachable.has(name)) continue;
    reachable.add(name);
    const entry = lock.packages[name];
    if (entry?.dependencies) queue.push(...Object.keys(entry.dependencies));
  }
  return reachable;
}

export function uninstallPackage(
  state: RootState,
  query: string,
): { removed: string; lock: LockFile } {
  const name = directDependencyName(state.dependencies, query);
  const dependencies = { ...state.dependencies };
  delete dependencies[name];
  writeRootDependencies(state, dependencies);

  const oldLock = readLock(state.context);
  const reachable = reachablePackages(dependencies, oldLock);
  const newLock = emptyLock();
  for (const [entryName, entry] of Object.entries(oldLock.packages)) {
    if (reachable.has(entryName)) newLock.packages[entryName] = entry;
  }
  writeLock(state.context, newLock);

  for (const [entryName, entry] of Object.entries(oldLock.packages)) {
    if (entry.type === "registry" && !reachable.has(entryName)) {
      rmSync(storePackageDirectory(state.context.root, entryName), {
        recursive: true,
        force: true,
      });
    }
  }
  return { removed: name, lock: newLock };
}

export async function linkPackage(
  state: RootState,
  query: string,
  options: ManagerOptions,
): Promise<InstallSummary> {
  const identity = findLocalPackage(state.context.root, query);
  if (identity.dir === state.context.root) {
    fail("A package cannot link to itself.");
  }
  const spec = relativeDependencyPath(state.context.root, identity.dir);
  const existing = state.dependencies[identity.name];
  if (existing !== undefined && existing !== spec && !options.force) {
    fail(
      `Package ${identity.name} is already a dependency (${existing}). ` +
        "Use --force to replace it with a path link.",
    );
  }

  const original = { ...state.dependencies };
  const dependencies = { ...state.dependencies, [identity.name]: spec };
  writeRootDependencies(state, dependencies);
  try {
    return await installAll(
      { ...state, dependencies },
      { ...options, preferLock: true, updateNames: undefined },
    );
  } catch (error) {
    writeRootDependencies(state, original);
    throw error;
  }
}

function manifestExportCount(directory: string): number | null {
  try {
    const raw = readJsonObject(join(directory, "manifest.json"), "Package manifest");
    return Array.isArray(raw.exports) ? raw.exports.length : null;
  } catch {
    return null;
  }
}

export function listInstalledPackages(state: RootState): InstalledPackageRow[] {
  const lock = readLock(state.context);
  const rows = new Map<string, InstalledPackageRow>();

  for (const [name, spec] of Object.entries(state.dependencies)) {
    const entry = lock.packages[name];
    if (!entry) {
      const local = isPathDependencySpec(spec);
      rows.set(name, {
        name,
        version: "-",
        origin: local ? "local" : "registry",
        path: local
          ? (spec.slice("path:".length) || ".")
          : relative(state.context.root, storePackageDirectory(state.context.root, name)),
        exports: null,
        state: "not installed",
      });
    }
  }

  for (const [name, entry] of Object.entries(lock.packages)) {
    const directory =
      entry.type === "path"
        ? resolve(state.context.root, entry.path ?? ".")
        : storePackageDirectory(state.context.root, name);
    const present = existsSync(join(directory, "manifest.json"));
    let version = entry.version;
    let exports: number | null = null;
    let status: InstalledPackageRow["state"] = present ? "ok" : "missing";
    if (present) {
      try {
        const stored = readPackageStateAt(directory);
        if (stored.version) version = stored.version;
        exports = manifestExportCount(directory);
      } catch {
        status = "missing";
      }
    }
    rows.set(name, {
      name,
      version,
      origin: entry.type === "path" ? "local" : "registry",
      path:
        entry.type === "path"
          ? (entry.path ?? ".")
          : relative(state.context.root, directory),
      exports,
      state: status,
    });
  }

  return [...rows.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function listUpstreamPackages(
  state: RootState | null,
  options: ManagerOptions,
): Promise<UpstreamPackageRow[]> {
  const index = await loadRegistryIndex({
    url: options.registryUrl,
    cacheDir: options.cacheDir,
    fetch: options.fetch,
    offline: options.offline,
    refresh: options.refresh,
  });
  const lock = state ? readLock(state.context) : null;

  const rows = await Promise.all(
    index.packages.map(async (entry): Promise<UpstreamPackageRow> => {
      const version = latestRegistryVersion(entry);
      try {
        const fetched = await fetchPackageManifest(index, entry, version, {
          cacheDir: options.cacheDir,
          fetch: options.fetch,
          offline: options.offline,
          refresh: options.refresh,
        });
        return {
          name: entry.name,
          version: version.version,
          ...(entry.description ?? fetched.manifest.description
            ? { description: entry.description ?? fetched.manifest.description }
            : {}),
          exports: Array.isArray(fetched.manifest.exports)
            ? fetched.manifest.exports.length
            : null,
          ...(lock?.packages[entry.name]
            ? { installedVersion: lock.packages[entry.name]!.version }
            : {}),
          state: "ok",
        };
      } catch (error) {
        return {
          name: entry.name,
          version: version.version,
          ...(entry.description ? { description: entry.description } : {}),
          exports: null,
          ...(lock?.packages[entry.name]
            ? { installedVersion: lock.packages[entry.name]!.version }
            : {}),
          state: "error",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  return rows.sort((left, right) => left.name.localeCompare(right.name));
}

export function readPackageManifestAt(directory: string): PackageManifest {
  const raw = readJsonObject(join(directory, "manifest.json"), "Package manifest");
  return raw as unknown as PackageManifest;
}

export function readPackageFiles(directory: string): Record<string, string> {
  const files: Record<string, string> = {};
  const visit = (relativePath: string) => {
    const normalized = normalizePackageFile(relativePath);
    const path = join(directory, normalized);
    if (!existsSync(path)) return;
    const contents = readFileSync(path, "utf8");
    files[normalized] = contents;
  };
  const manifest = readJsonObject(join(directory, "manifest.json"), "Package manifest");
  visit("manifest.json");
  visit("package.json");
  if (typeof manifest.tests === "string") visit(manifest.tests);
  if (Array.isArray(manifest.exports)) {
    for (const item of manifest.exports) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
      const entry = item as Record<string, unknown>;
      if (typeof entry.source === "string") visit(entry.source);
      if (typeof entry.docs === "string") visit(entry.docs);
      if (entry.kind === "circuit" && typeof entry.tests === "string") {
        visit(entry.tests);
      }
    }
  }
  for (const optional of ["README.md", "LICENSE", "LICENSE.md"]) visit(optional);
  return files;
}
