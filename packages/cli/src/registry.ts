import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import semver from "semver";
import type { PackageManifest } from "@shortcircuit/engine/core";
import { PACKAGE_SCHEMA } from "./project";
import { validatePackageName, validateVersion } from "./packageSpec";

const REGISTRY_SCHEMA_PREFIX = "shortcircuit.registry/";
const INDEX_CACHE_TTL_MS = 60 * 60 * 1000;
const JSON_CACHE_TTL_MS = 60 * 60 * 1000;

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type FetchLike = (url: string) => Promise<FetchResponseLike>;

export interface RegistryVersion {
  version: string;
  /** Registry-root-relative path to manifest.json. */
  manifest: string;
  tarball?: string;
  integrity?: string;
}

export interface RegistryPackageEntry {
  name: string;
  description?: string;
  versions: RegistryVersion[];
}

export interface RegistryIndex {
  schema: string;
  url: string;
  baseUrl: string;
  packages: RegistryPackageEntry[];
}

export interface RemotePackage {
  name: string;
  version: string;
  description?: string;
  /** Package-relative path to file contents. */
  files: Record<string, string>;
  integrity: string;
  manifest: PackageManifest;
  resolved: string;
}

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryError";
  }
}

function fail(message: string): never {
  throw new RegistryError(message);
}

export const defaultFetch: FetchLike = (url) => globalThis.fetch(url);

function normalizeUrl(value: string): string {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return value;
  return pathToFileURL(resolve(value)).toString();
}

function cacheKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cachePath(cacheDir: string, kind: string, key: string): string {
  return join(cacheDir, kind, `${key}.json`);
}

function readCache(path: string): { fetchedAt: number; data: unknown } | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      schema?: unknown;
      fetchedAt?: unknown;
      data?: unknown;
    };
    if (raw.schema !== "shortcircuit.cache/v1" || typeof raw.fetchedAt !== "number") {
      return null;
    }
    return { fetchedAt: raw.fetchedAt, data: raw.data };
  } catch {
    return null;
  }
}

function writeCache(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify(
      { schema: "shortcircuit.cache/v1", fetchedAt: Date.now(), data },
      null,
      2,
    )}\n`,
  );
}

async function readUrlText(url: string, fetchImpl: FetchLike): Promise<string> {
  if (url.startsWith("file:")) {
    try {
      return readFileSync(fileURLToPath(url), "utf8");
    } catch (error) {
      fail(
        `Could not read ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  let response: FetchResponseLike;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    fail(
      `Could not reach the package registry at ${url}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!response.ok) {
    fail(`Could not fetch ${url}: HTTP ${response.status}.`);
  }
  try {
    return await response.text();
  } catch (error) {
    fail(
      `Could not read the response from ${url}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function readOptionalUrlText(
  url: string,
  fetchImpl: FetchLike,
): Promise<string | null> {
  if (url.startsWith("file:")) {
    const path = fileURLToPath(url);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  }
  let response: FetchResponseLike;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    fail(
      `Could not reach the package registry at ${url}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (response.status === 404) return null;
  if (!response.ok) fail(`Could not fetch ${url}: HTTP ${response.status}.`);
  return response.text();
}

function parseJsonText(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(
      `${label} is not valid JSON.${error instanceof Error ? ` ${error.message}` : ""}`,
    );
  }
}

function parseVersionEntry(
  name: string,
  version: string,
  value: unknown,
): RegistryVersion {
  validateVersion(version);
  if (typeof value === "string") {
    return { version, manifest: value };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`Registry entry ${name}@${version} must be a manifest path or object.`);
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.manifest !== "string" || !raw.manifest.trim()) {
    fail(`Registry entry ${name}@${version} needs a manifest path.`);
  }
  if (raw.tarball !== undefined && typeof raw.tarball !== "string") {
    fail(`Registry entry ${name}@${version} tarball must be a URL.`);
  }
  if (raw.integrity !== undefined && typeof raw.integrity !== "string") {
    fail(`Registry entry ${name}@${version} integrity must be a string.`);
  }
  return {
    version,
    manifest: raw.manifest,
    ...(typeof raw.tarball === "string" ? { tarball: raw.tarball } : {}),
    ...(typeof raw.integrity === "string" ? { integrity: raw.integrity } : {}),
  };
}

function parseRegistryPackage(raw: unknown, index: number): RegistryPackageEntry {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail(`Registry package ${index + 1} must be an object.`);
  }
  const entry = raw as Record<string, unknown>;
  if (typeof entry.name !== "string") {
    fail(`Registry package ${index + 1} needs a name.`);
  }
  const name = validatePackageName(entry.name);
  const versions: RegistryVersion[] = [];

  if (entry.versions !== undefined) {
    if (Array.isArray(entry.versions)) {
      for (const value of entry.versions) {
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
          fail(`Registry entry ${name} versions must be objects.`);
        }
        const version = (value as Record<string, unknown>).version;
        if (typeof version !== "string") {
          fail(`Registry entry ${name} has a version without a version string.`);
        }
        versions.push(parseVersionEntry(name, version, value));
      }
    } else if (typeof entry.versions === "object" && entry.versions !== null) {
      for (const [version, value] of Object.entries(
        entry.versions as Record<string, unknown>,
      )) {
        versions.push(parseVersionEntry(name, version, value));
      }
    } else {
      fail(`Registry entry ${name} versions must be an object or array.`);
    }
  } else if (typeof entry.version === "string" && typeof entry.manifest === "string") {
    versions.push(parseVersionEntry(name, entry.version, { manifest: entry.manifest }));
  } else {
    fail(`Registry entry ${name} needs versions.`);
  }

  if (versions.length === 0) fail(`Registry entry ${name} has no versions.`);
  versions.sort((left, right) => semver.rcompare(left.version, right.version));
  return {
    name,
    versions,
    ...(typeof entry.description === "string" ? { description: entry.description } : {}),
  };
}

export function parseRegistryIndex(text: string, url: string): RegistryIndex {
  const value = parseJsonText(text, `Registry index at ${url}`);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`Registry index at ${url} must be a JSON object.`);
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.schema !== "string" || !raw.schema.startsWith(REGISTRY_SCHEMA_PREFIX)) {
    fail(`Registry index at ${url} does not use ${REGISTRY_SCHEMA_PREFIX}v1.`);
  }
  if (!Array.isArray(raw.packages)) {
    fail(`Registry index at ${url} packages must be an array.`);
  }
  const packages = raw.packages.map((entry, index) => parseRegistryPackage(entry, index));
  const seen = new Set<string>();
  for (const entry of packages) {
    if (seen.has(entry.name)) fail(`Registry index lists ${entry.name} more than once.`);
    seen.add(entry.name);
  }
  const normalizedUrl = normalizeUrl(url);
  return {
    schema: raw.schema,
    url: normalizedUrl,
    baseUrl: new URL(".", normalizedUrl).toString(),
    packages,
  };
}

export interface RegistryClientOptions {
  url: string;
  cacheDir: string;
  fetch?: FetchLike;
  offline?: boolean;
  refresh?: boolean;
}

function indexCachePath(cacheDir: string, url: string): string {
  return cachePath(cacheDir, "registry-index", cacheKey(url));
}

export async function loadRegistryIndex(
  options: RegistryClientOptions,
): Promise<RegistryIndex> {
  const fetchImpl = options.fetch ?? defaultFetch;
  const normalizedUrl = normalizeUrl(options.url);
  const path = indexCachePath(options.cacheDir, normalizedUrl);
  const cached = readCache(path);

  if (!options.refresh && cached && (options.offline || Date.now() - cached.fetchedAt < INDEX_CACHE_TTL_MS)) {
    return parseRegistryIndex(JSON.stringify(cached.data), normalizedUrl);
  }
  if (options.offline) {
    fail(
      `No cached registry index for ${normalizedUrl}. Run the command once online, or remove --offline.`,
    );
  }

  let text: string;
  try {
    text = await readUrlText(normalizedUrl, fetchImpl);
  } catch (error) {
    if (cached) return parseRegistryIndex(JSON.stringify(cached.data), normalizedUrl);
    throw error;
  }
  const index = parseRegistryIndex(text, normalizedUrl);
  writeCache(path, JSON.parse(text) as unknown);
  return index;
}

export function findRegistryPackage(
  index: RegistryIndex,
  name: string,
): RegistryPackageEntry {
  const entry = index.packages.find((candidate) => candidate.name === name);
  if (!entry) {
    fail(
      `Package ${name} is not in the registry at ${index.url}. ` +
        "Run shortcircuit package list upstream to see available packages.",
    );
  }
  return entry;
}

export function latestRegistryVersion(entry: RegistryPackageEntry): RegistryVersion {
  const version = entry.versions[0];
  if (!version) fail(`Package ${entry.name} has no versions in the registry.`);
  return version;
}

export function versionSatisfying(
  entry: RegistryPackageEntry,
  ranges: string[],
): RegistryVersion | undefined {
  const range = ranges.length === 0 ? "*" : ranges.join(" ");
  const version = semver.maxSatisfying(
    entry.versions.map((candidate) => candidate.version),
    range,
  );
  return version
    ? entry.versions.find((candidate) => candidate.version === version)
    : undefined;
}

export function findRegistryVersion(
  entry: RegistryPackageEntry,
  version: string,
): RegistryVersion {
  const found = entry.versions.find((candidate) => candidate.version === version);
  if (!found) {
    fail(`Package ${entry.name}@${version} is not in the registry.`);
  }
  return found;
}

function manifestUrl(index: RegistryIndex, version: RegistryVersion): string {
  return new URL(version.manifest, index.baseUrl).toString();
}

export async function fetchPackageManifest(
  index: RegistryIndex,
  entry: RegistryPackageEntry,
  version: RegistryVersion,
  options: { cacheDir: string; fetch?: FetchLike; offline?: boolean; refresh?: boolean },
): Promise<{ manifest: PackageManifest; url: string; text: string }> {
  const url = manifestUrl(index, version);
  const fetchImpl = options.fetch ?? defaultFetch;
  const path = cachePath(options.cacheDir, "manifests", cacheKey(url));
  const cached = readCache(path);
  let text: string | null = null;

  if (!options.refresh && cached && (options.offline || Date.now() - cached.fetchedAt < JSON_CACHE_TTL_MS)) {
    text = JSON.stringify(cached.data);
  } else if (options.offline) {
    fail(`No cached manifest for ${entry.name}@${version.version}. Run once online, or remove --offline.`);
  } else {
    try {
      text = await readUrlText(url, fetchImpl);
      writeCache(path, JSON.parse(text) as unknown);
    } catch (error) {
      if (cached) {
        text = JSON.stringify(cached.data);
      } else {
        throw error;
      }
    }
  }

  const value = parseJsonText(text, `Package manifest at ${url}`);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`Package manifest at ${url} must be a JSON object.`);
  }
  const raw = value as Record<string, unknown>;
  if (raw.schema !== PACKAGE_SCHEMA) {
    fail(`Package manifest at ${url} does not use ${PACKAGE_SCHEMA}.`);
  }
  if (raw.name !== entry.name) {
    fail(`Package manifest at ${url} names ${String(raw.name)}, expected ${entry.name}.`);
  }
  if (raw.version !== version.version) {
    fail(
      `Package manifest at ${url} has version ${String(raw.version)}, expected ${version.version}.`,
    );
  }
  if (raw.description !== undefined && typeof raw.description !== "string") {
    fail(`Package manifest at ${url} description must be a string.`);
  }
  if (raw.tests !== undefined && typeof raw.tests !== "string") {
    fail(`Package manifest at ${url} tests must be a path string.`);
  }
  if (raw.dependencies !== undefined) {
    if (
      raw.dependencies === null ||
      typeof raw.dependencies !== "object" ||
      Array.isArray(raw.dependencies)
    ) {
      fail(`Package manifest at ${url} dependencies must be an object.`);
    }
    for (const [dependency, range] of Object.entries(
      raw.dependencies as Record<string, unknown>,
    )) {
      if (typeof range !== "string") {
        fail(`Package manifest at ${url} dependency ${dependency} must be a string.`);
      }
    }
  }
  if (!Array.isArray(raw.exports)) {
    fail(`Package manifest at ${url} exports must be an array.`);
  }
  for (const [index, value] of raw.exports.entries()) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      fail(`Package manifest at ${url} export ${index + 1} must be an object.`);
    }
    const exported = value as Record<string, unknown>;
    if (exported.kind !== "macro" && exported.kind !== "circuit") {
      fail(`Package manifest at ${url} export ${index + 1} has an invalid kind.`);
    }
    for (const field of ["name", "source"] as const) {
      if (typeof exported[field] !== "string" || !exported[field].trim()) {
        fail(`Package manifest at ${url} export ${index + 1} needs a ${field}.`);
      }
    }
    for (const field of ["docs", "tests"] as const) {
      if (exported[field] !== undefined && typeof exported[field] !== "string") {
        fail(`Package manifest at ${url} export ${index + 1} ${field} must be a path.`);
      }
    }
  }
  return { manifest: raw as unknown as PackageManifest, url, text };
}

export function normalizePackageFile(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (
    !normalized ||
    isAbsolute(normalized) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized) ||
    normalized.includes("?") ||
    normalized.includes("#")
  ) {
    fail(`Package file path ${path} must be relative.`);
  }
  const parts = normalized.split("/");
  if (parts.some((part) => part === "..")) {
    fail(`Package file path ${path} must stay inside the package directory.`);
  }
  return normalized;
}

export function packageIntegrity(files: Record<string, string>): string {
  const hash = createHash("sha256");
  for (const [path, contents] of Object.entries(files).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    hash.update(path);
    hash.update("\0");
    hash.update(contents);
    hash.update("\0");
  }
  return `sha256-${hash.digest("hex")}`;
}

function packageCachePath(cacheDir: string, name: string, version: string): string {
  return cachePath(cacheDir, "packages", cacheKey(`${name}@${version}`));
}

function cachedPackage(value: unknown): RemotePackage | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.name !== "string" ||
    typeof raw.version !== "string" ||
    typeof raw.integrity !== "string" ||
    typeof raw.resolved !== "string" ||
    raw.files === null ||
    typeof raw.files !== "object" ||
    Array.isArray(raw.files) ||
    raw.manifest === null ||
    typeof raw.manifest !== "object"
  ) {
    return null;
  }
  return {
    name: raw.name,
    version: raw.version,
    integrity: raw.integrity,
    resolved: raw.resolved,
    files: raw.files as Record<string, string>,
    manifest: raw.manifest as PackageManifest,
    ...(typeof raw.description === "string" ? { description: raw.description } : {}),
  };
}

export async function fetchRemotePackage(
  index: RegistryIndex,
  entry: RegistryPackageEntry,
  version: RegistryVersion,
  options: { cacheDir: string; fetch?: FetchLike; offline?: boolean; refresh?: boolean },
): Promise<RemotePackage> {
  const cachePathValue = packageCachePath(options.cacheDir, entry.name, version.version);
  const cached = readCache(cachePathValue);
  if (!options.refresh && cached) {
    const parsed = cachedPackage(cached.data);
    if (parsed) return parsed;
  }
  if (options.offline) {
    fail(
      `Package ${entry.name}@${version.version} is not cached. Run the command once online, or remove --offline.`,
    );
  }

  const fetchedManifest = await fetchPackageManifest(index, entry, version, options);
  const packageRoot = new URL(".", fetchedManifest.url).toString();
  const optionalPaths = new Set(["package.json", "README.md", "LICENSE", "LICENSE.md"]);
  const filePaths = new Set<string>(["manifest.json", ...optionalPaths]);
  const manifest = fetchedManifest.manifest;
  if (manifest.tests) filePaths.add(normalizePackageFile(manifest.tests));
  for (const exported of manifest.exports) {
    filePaths.add(normalizePackageFile(exported.source));
    if (exported.docs) filePaths.add(normalizePackageFile(exported.docs));
    if (exported.kind === "circuit" && exported.tests) {
      filePaths.add(normalizePackageFile(exported.tests));
    }
  }

  const fetchImpl = options.fetch ?? defaultFetch;
  const files: Record<string, string> = {};
  for (const path of [...filePaths].sort()) {
    const url = new URL(path, packageRoot).toString();
    const text =
      path === "manifest.json"
        ? fetchedManifest.text
        : await readOptionalUrlText(url, fetchImpl);
    if (text === null) {
      if (optionalPaths.has(path)) continue;
      fail(`Package ${entry.name}@${version.version} is missing ${path}.`);
    }
    files[path] = text;
  }

  const remote: RemotePackage = {
    name: entry.name,
    version: version.version,
    ...(manifest.description ? { description: manifest.description } : {}),
    files,
    integrity: packageIntegrity(files),
    manifest,
    resolved: packageRoot,
  };
  writeCache(cachePathValue, remote);
  return remote;
}

export function cachedRemotePackage(
  cacheDir: string,
  name: string,
  version: string,
): RemotePackage | null {
  const cached = readCache(packageCachePath(cacheDir, name, version));
  return cached ? cachedPackage(cached.data) : null;
}
