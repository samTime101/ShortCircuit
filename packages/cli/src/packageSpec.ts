import semver from "semver";

const NAME_PATTERN = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const EXPORT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class PackageSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageSpecError";
  }
}

function fail(message: string): never {
  throw new PackageSpecError(message);
}

export function validatePackageName(name: string): string {
  const value = name.trim();
  if (!NAME_PATTERN.test(value)) {
    fail(
      `Invalid package name "${value}". Use a scoped npm-style name such as @acme/parity.`,
    );
  }
  return value;
}

export function validateExportName(name: string): string {
  const value = name.trim();
  if (!EXPORT_PATTERN.test(value)) {
    fail(
      `Invalid export name "${value}". Use a LogicFlow name such as PARITY3 or MyCircuit.`,
    );
  }
  return value;
}

export function validateVersion(version: string): string {
  const value = version.trim();
  if (!semver.valid(value)) {
    fail(`Invalid package version "${value}". Use semver such as 0.1.0.`);
  }
  return value;
}

export function validateRange(range: string): string {
  const value = range.trim();
  if (value === "" || value === "*" || value === "latest") return "*";
  if (value.startsWith("path:")) {
    const path = pathSpecValue(value);
    if (!path) {
      fail(`Invalid path dependency "${value}". Provide a package directory.`);
    }
    return `path:${path}`;
  }
  if (!semver.validRange(value)) {
    fail(`Invalid dependency range "${value}". Use a semver range such as ^0.1.0.`);
  }
  return value;
}

export function packageDirectoryName(name: string): string {
  validatePackageName(name);
  const base = name.slice(name.indexOf("/") + 1);
  return base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/_/g, "-")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "package"
  );
}

export function defaultExportName(name: string): string {
  const directory = packageDirectoryName(name);
  const upper = directory.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return /^[A-Z_]/.test(upper) ? upper : `_${upper}`;
}

export function parseDependencies(raw: string | undefined): string[] {
  if (!raw) return [];
  const dependencies: string[] = [];
  for (const value of raw.split(/[,\s]+/)) {
    const name = value.trim();
    if (!name) continue;
    validatePackageName(name);
    if (!dependencies.includes(name)) dependencies.push(name);
  }
  return dependencies;
}

export interface PackageRequest {
  name: string;
  range: string | null;
}

/**
 * Parse `@scope/name@^1.2.3`. Scoped names contain a leading `@`, so the
 * version separator is the last `@` after the first character.
 */
export function parsePackageRequest(request: string): PackageRequest {
  const value = request.trim();
  if (!value) fail("A package name is required.");
  const separator = value.lastIndexOf("@");
  if (separator > 0) {
    return {
      name: validatePackageName(value.slice(0, separator)),
      range: validateRange(value.slice(separator + 1)),
    };
  }
  return { name: validatePackageName(value), range: null };
}

export function packageShortName(name: string): string {
  const slash = name.indexOf("/");
  return slash >= 0 ? name.slice(slash + 1) : name;
}

export function isPathSpec(spec: string): boolean {
  return spec.startsWith("path:");
}

export function pathSpecValue(spec: string): string {
  return spec.slice("path:".length).trim();
}

export function makePathSpec(relativePath: string): string {
  const normalized = relativePath.replaceAll("\\", "/");
  return `path:${normalized || "."}`;
}
