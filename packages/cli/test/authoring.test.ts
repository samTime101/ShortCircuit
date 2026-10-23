import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../src/cli";
import { cleanupTempDirs, tempDir, writeText } from "./helpers";

afterEach(cleanupTempDirs);

function writeRegistryRepo(root: string): void {
  writeText(
    root,
    "package.json",
    `${JSON.stringify({ name: "@shortcircuit/packages", version: "0.1.0" }, null, 2)}\n`,
  );
  writeText(
    root,
    "registry.json",
    `${JSON.stringify({ schema: "shortcircuit.registry/v1", packages: [] }, null, 2)}\n`,
  );
  writeText(root, "scripts/package.mjs", "// test package authoring entry\n");
}

function writeManifest(root: string, relative: string, exportNames: string[]): void {
  writeText(
    root,
    relative,
    `${JSON.stringify(
      {
        schema: "shortcircuit.package/v1",
        name: "@test/package",
        version: "0.1.0",
        exports: exportNames.map((name) => ({
          kind: "macro",
          name,
          source: "macros/test/macro.lf",
        })),
      },
      null,
      2,
    )}\n`,
  );
}

function runPackage(
  args: string[],
  cwd: string,
  env: Record<string, string | undefined> = process.env,
) {
  return run(
    ["package", ...args],
    () => {
      throw new Error("package commands should not read a source file");
    },
    () => undefined,
    { cwd, env },
  );
}

describe("package authoring commands", () => {
  it("scaffolds through the package authoring delegate", () => {
    const root = tempDir();
    writeRegistryRepo(root);

    const result = runPackage(
      [
        "init",
        "--name",
        "@acme/parity",
        "--export",
        "PARITY3",
        "--kind",
        "macro",
        "--description",
        "Three-input parity.",
        "--version",
        "0.2.0",
        "--license",
        "MIT",
        "--dependencies",
        "@shortcircuit/gates",
        "--no-registry",
        "--force",
        "--yes",
        "--auto-import",
      ],
      root,
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.delegate?.command).toBe(process.execPath);
    expect(result.delegate?.cwd).toBe(root);
    expect(result.delegate?.args).toEqual([
      join(root, "scripts", "package.mjs"),
      "init",
      "--name",
      "@acme/parity",
      "--export",
      "PARITY3",
      "--kind",
      "macro",
      "--description",
      "Three-input parity.",
      "--version",
      "0.2.0",
      "--license",
      "MIT",
      "--dependencies",
      "@shortcircuit/gates",
      "--no-registry",
      "--force",
      "--yes",
      "--auto-import",
    ]);
  });

  it("consumes the root flag instead of forwarding it", () => {
    const root = tempDir();
    writeRegistryRepo(root);
    const outside = tempDir();

    const result = runPackage(
      ["init", "--root", root, "--name", "@acme/parity", "--yes"],
      outside,
    );

    expect(result.code).toBe(0);
    expect(result.delegate?.cwd).toBe(root);
    expect(result.delegate?.args).not.toContain("--root");
  });

  it("finds the registry from a nested directory", () => {
    const root = tempDir();
    writeRegistryRepo(root);
    const nested = join(root, "apps", "web");
    mkdirSync(nested, { recursive: true });

    const result = runPackage(["build"], nested);

    expect(result.code).toBe(0);
    expect(result.delegate?.cwd).toBe(root);
    expect(result.delegate?.args.slice(1)).toEqual(["build"]);
  });

  it("finds the vendored registry from the main checkout", () => {
    const main = tempDir();
    const root = join(main, "vendor", "ShortCircuit-Packages");
    writeRegistryRepo(root);
    const nested = join(main, "packages", "engine");
    mkdirSync(nested, { recursive: true });

    const result = runPackage(["check"], nested);

    expect(result.code).toBe(0);
    expect(result.delegate?.cwd).toBe(root);
    expect(result.delegate?.args.slice(1)).toEqual(["check"]);
  });

  it("passes the main checkout to test and check commands", () => {
    const root = tempDir();
    writeRegistryRepo(root);
    const main = tempDir();

    for (const subcommand of ["test", "check"]) {
      const result = runPackage([subcommand, "--main", main], root, {
        PATH: process.env.PATH,
      });

      expect(result.code).toBe(0);
      expect(result.delegate?.args.slice(1)).toEqual([subcommand]);
      expect(result.delegate?.env?.SHORTCIRCUIT_ROOT).toBe(main);
    }
  });

  it("reports a missing registry", () => {
    const empty = tempDir();

    const result = runPackage(["build"], empty);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Could not find the Short Circuit package registry");
    expect(result.stderr).toContain("--root");
  });

  it("accepts the main checkout as an explicit root", () => {
    const main = tempDir();
    const root = join(main, "vendor", "ShortCircuit-Packages");
    writeRegistryRepo(root);

    const result = runPackage(["build", "--root", main], tempDir());

    expect(result.code).toBe(0);
    expect(result.delegate?.cwd).toBe(root);
  });

  it("reports an invalid explicit root", () => {
    const empty = tempDir();

    const result = runPackage(["build", "--root", empty], tempDir());

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Could not find the Short Circuit package registry at");
  });

  it("lists registry packages as text", () => {
    const root = tempDir();
    writeRegistryRepo(root);
    writeManifest(root, "packages/gates/manifest.json", ["AND", "OR"]);
    writeText(root, "packages/broken/manifest.json", "{");
    writeText(
      root,
      "registry.json",
      `${JSON.stringify(
        {
          schema: "shortcircuit.registry/v1",
          packages: [
            {
              name: "@shortcircuit/gates",
              version: "0.1.0",
              manifest: "packages/gates/manifest.json",
            },
            {
              name: "@acme/broken",
              version: "0.2.0",
              manifest: "packages/broken/manifest.json",
            },
            {
              name: "@acme/missing",
              version: "0.3.0",
              manifest: "packages/missing/manifest.json",
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    const result = runPackage(["registry"], root);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("@shortcircuit/gates@0.1.0 (2 exports)");
    expect(result.stdout).toContain("@acme/broken@0.2.0 (invalid manifest)");
    expect(result.stdout).toContain("@acme/missing@0.3.0 (manifest missing)");
  });

  it("lists registry packages as JSON", () => {
    const root = tempDir();
    writeRegistryRepo(root);
    writeManifest(root, "packages/gates/manifest.json", ["AND"]);
    writeText(
      root,
      "registry.json",
      `${JSON.stringify(
        {
          schema: "shortcircuit.registry/v1",
          packages: [
            {
              name: "@shortcircuit/gates",
              version: "0.1.0",
              manifest: "packages/gates/manifest.json",
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    const result = runPackage(["registry", "--json"], root);
    const data = JSON.parse(result.stdout) as {
      packages: Array<Record<string, unknown>>;
    };

    expect(result.code).toBe(0);
    expect(data.packages).toEqual([
      {
        name: "@shortcircuit/gates",
        version: "0.1.0",
        manifest: "packages/gates/manifest.json",
        exports: 1,
        state: "ok",
      },
    ]);
  });

  it("reports an empty registry", () => {
    const root = tempDir();
    writeRegistryRepo(root);

    const result = runPackage(["registry"], root);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("No packages registered.\n");
  });

  it("shows package help without a registry", () => {
    const empty = tempDir();

    const result = runPackage(["help"], empty);
    const init = runPackage(["init", "--help"], empty);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("shortcircuit package init");
    expect(result.stdout).toContain("shortcircuit package build");
    expect(result.stdout).toContain("shortcircuit package test");
    expect(result.stdout).toContain("shortcircuit package check");
    expect(result.stdout).toContain("shortcircuit package registry");
    expect(init.code).toBe(0);
    expect(init.stdout).toContain("--name <@scope/name>");
    expect(init.stdout).toContain("--dependencies <list>");
    expect(init.stdout).toContain("--root <dir>");
  });

  it("shows package help when no subcommand is given", () => {
    const result = runPackage([], tempDir());

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Short Circuit package commands");
  });

  it("rejects an unknown package command", () => {
    const result = runPackage(["install"], tempDir());

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unknown package command");
    expect(result.stderr).toContain("shortcircuit package help");
  });

  it("rejects extra arguments", () => {
    const root = tempDir();
    writeRegistryRepo(root);

    const result = runPackage(["build", "circuit.lf"], root);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("does not take a file");
  });

  it("requires values for options", () => {
    const root = tempDir();
    writeRegistryRepo(root);

    const main = runPackage(["test", "--main"], root);
    const name = runPackage(["init", "--name"], root);
    const packageRoot = runPackage(["build", "--root"], tempDir());

    expect(main.code).toBe(1);
    expect(main.stderr).toContain("Option --main needs a value");
    expect(name.code).toBe(1);
    expect(name.stderr).toContain("Option --name needs a value");
    expect(packageRoot.code).toBe(1);
    expect(packageRoot.stderr).toContain("Option --root needs a value");
  });
});
