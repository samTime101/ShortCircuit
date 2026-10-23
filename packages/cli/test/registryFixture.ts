import type { FetchLike } from "../src/registry";

const BASE = "https://registry.test/";

export interface RegistryPackageOptions {
  name: string;
  version: string;
  manifest?: Record<string, unknown>;
  files?: Record<string, string>;
  packageJson?: boolean;
  description?: string;
}

export class RegistryFixture {
  readonly url = `${BASE}registry.json`;
  readonly files = new Map<string, string>();
  readonly versions = new Map<string, Map<string, string>>();
  readonly fetchCalls: string[] = [];

  readonly fetch: FetchLike = async (url) => {
    this.fetchCalls.push(url);
    const text = this.files.get(url);
    if (text === undefined) {
      return { ok: false, status: 404, text: async () => "" };
    }
    return { ok: true, status: 200, text: async () => text };
  };

  addPackage(options: RegistryPackageOptions): string {
    const directory = `packages/${slug(options.name)}-${options.version}`;
    const manifestPath = `${directory}/manifest.json`;
    const manifest = {
      schema: "shortcircuit.package/v1",
      name: options.name,
      version: options.version,
      ...(options.description ? { description: options.description } : {}),
      ...(options.manifest ?? {}),
    };
    this.files.set(`${BASE}${manifestPath}`, `${JSON.stringify(manifest, null, 2)}\n`);
    if (options.packageJson !== false) {
      this.files.set(
        `${BASE}${directory}/package.json`,
        `${JSON.stringify({ name: options.name, version: options.version }, null, 2)}\n`,
      );
    }
    for (const [path, contents] of Object.entries(options.files ?? {})) {
      this.files.set(`${BASE}${directory}/${path}`, contents);
    }
    const versions = this.versions.get(options.name) ?? new Map<string, string>();
    versions.set(options.version, manifestPath);
    this.versions.set(options.name, versions);
    this.refreshIndex();
    return directory;
  }

  addFile(path: string, contents: string): void {
    this.files.set(`${BASE}${path.replace(/^\/+/, "")}`, contents);
  }

  refreshIndex(): void {
    const packages = [...this.versions.entries()].map(([name, versions]) => ({
      name,
      versions: Object.fromEntries(
        [...versions.entries()].map(([version, manifest]) => [version, { manifest }]),
      ),
    }));
    this.files.set(
      this.url,
      `${JSON.stringify(
        { schema: "shortcircuit.registry/v2", packages },
        null,
        2,
      )}\n`,
    );
  }
}

function slug(name: string): string {
  return name.replace(/^@/, "").replaceAll("/", "-");
}
