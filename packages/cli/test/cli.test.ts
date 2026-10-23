import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listFlag, parseArgs } from "../src/args";
import { run } from "../src/cli";
import type { FetchLike } from "../src/registry";
import {
  cleanupTempDirs,
  readJson,
  tempDir,
  writeDoublePackage,
  writeProject,
} from "./helpers";
import { RegistryFixture } from "./registryFixture";

afterEach(cleanupTempDirs);

const NAND_SOURCE = `CIRCUIT NandOnly
  INPUT a
  INPUT b

  y = NAND(a, b)

  OUTPUT y
END`;

const NAND_TEST_SOURCE = `${NAND_SOURCE}

TEST NandOnly
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
END`;

const BROKEN_SOURCE = `CIRCUIT Broken
  INPUT a
  x = NAND(a, missing)
  OUTPUT x
END`;

const DOUBLE_SOURCE = `IMPORT "@test/double"

CIRCUIT LocalDouble
  INPUT a
  y = TWICE(a)
  OUTPUT y
END`;

interface CliOptions {
  cwd: string;
  read?: (file: string) => string;
  write?: (file: string, contents: string) => void;
  fetch?: FetchLike;
  env?: Record<string, string | undefined>;
}

function runCli(args: string[], options: CliOptions) {
  const read =
    options.read ??
    ((file: string) => readFileSync(join(options.cwd, file), "utf8"));
  return run(args, read, options.write ?? (() => undefined), {
    cwd: options.cwd,
    env: options.env ?? process.env,
    fetch: options.fetch,
    interactive: false,
  });
}

function runPackage(args: string[], options: CliOptions) {
  return runCli(
    ["package", ...args],
    {
      ...options,
      read: () => {
        throw new Error("package commands do not read source files");
      },
    },
  );
}

describe("argument parsing", () => {
  it("parses repeatable value flags and equals values", () => {
    const parsed = parseArgs([
      "compile",
      "main.lf",
      "--package",
      "a",
      "--package",
      "b",
      "--out=result.json",
    ]);

    expect(parsed.command).toBe("compile");
    expect(parsed.positionals).toEqual(["main.lf"]);
    expect(listFlag(parsed.flags, "package")).toEqual(["a", "b"]);
    expect(parsed.flags.out).toBe("result.json");
  });

  it("keeps a package path whole", () => {
    const parsed = parseArgs(["compile", "main.lf", "--package", "packages/a,b"]);
    expect(listFlag(parsed.flags, "package")).toEqual(["packages/a,b"]);
  });

  it("reports a missing value flag", () => {
    const parsed = parseArgs(["compile", "main.lf", "--package"]);
    expect(parsed.flags.package).toBe(true);
    expect(() => listFlag(parsed.flags, "package")).toThrow(/needs a value/);
  });
});

describe("core commands", () => {
  it("compiles a circuit with the kernel NAND", async () => {
    const result = await runCli(["compile", "circuit.lf"], {
      cwd: tempDir(),
      read: () => NAND_SOURCE,
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("Compiled 1 circuit, 3 nodes.\n");
  });

  it("reports compile diagnostics", async () => {
    const result = await runCli(["compile", "circuit.lf"], {
      cwd: tempDir(),
      read: () => BROKEN_SOURCE,
    });

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("E201");
    expect(result.stderr).toContain("Failed with 1 error");
  });

  it("runs tests and reports each case", async () => {
    const result = await runCli(["test", "circuit.lf"], {
      cwd: tempDir(),
      read: () => NAND_TEST_SOURCE,
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("PASS  NandOnly");
    expect(result.stdout).toContain("pass  both high");
    expect(result.stdout).toContain("2 passed, 0 failed");
  });

  it("prints a truth table", async () => {
    const result = await runCli(["truth-table", "circuit.lf"], {
      cwd: tempDir(),
      read: () => NAND_SOURCE,
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("a | b | y");
    expect(result.stdout).toContain("1 | 1 | 0");
  });

  it("prints JSON diagnostics", async () => {
    const result = await runCli(["compile", "circuit.lf", "--json"], {
      cwd: tempDir(),
      read: () => BROKEN_SOURCE,
    });

    expect(result.code).toBe(1);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      diagnostics: Array<{ code: string }>;
    };
    expect(payload.ok).toBe(false);
    expect(payload.diagnostics.some((diagnostic) => diagnostic.code === "E201")).toBe(true);
  });

  it("formats a file in place with --write", async () => {
    const cwd = tempDir();
    let written = "";
    const result = await runCli(["format", "circuit.lf", "--write"], {
      cwd,
      read: () => "CIRCUIT   Formatted\n INPUT a\n OUTPUT a\nEND\n",
      write: (_file, contents) => {
        written = contents;
      },
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Formatted circuit.lf");
    expect(written).toContain("CIRCUIT");
    expect(written).toContain("Formatted");
  });

  it("exports IR and Verilog through the kernel", async () => {
    const ir = await runCli(["export-ir", "circuit.lf"], {
      cwd: tempDir(),
      read: () => NAND_SOURCE,
    });
    const verilog = await runCli(["export-verilog", "circuit.lf"], {
      cwd: tempDir(),
      read: () => NAND_SOURCE,
    });

    expect(ir.code).toBe(0);
    expect(JSON.parse(ir.stdout)).toMatchObject({ schema: "shortcircuit.ir/v1" });
    expect(verilog.code).toBe(0);
    expect(verilog.stdout).toContain("module NandOnly");
  });

  it("writes export output with --out", async () => {
    const cwd = tempDir();
    let writtenPath = "";
    let written = "";
    const result = await runCli(["export-ir", "circuit.lf", "--out", "build/circuit.json"], {
      cwd,
      read: () => NAND_SOURCE,
      write: (file, contents) => {
        writtenPath = file;
        written = contents;
      },
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Wrote build/circuit.json");
    expect(writtenPath).toBe(join(cwd, "build/circuit.json"));
    expect(JSON.parse(written)).toMatchObject({ schema: "shortcircuit.ir/v1" });
  });

  it("rejects an unknown command and a missing file", async () => {
    const unknown = await runCli(["nope", "circuit.lf"], { cwd: tempDir(), read: () => NAND_SOURCE });
    const missing = await runCli(["compile"], { cwd: tempDir() });

    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('Unknown command "nope"');
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("No file given");
  });

  it("prints help for the new command surface", async () => {
    const result = await runCli(["help"], { cwd: tempDir() });

    expect(result.code).toBe(0);
    for (const text of [
      "shortcircuit init",
      "shortcircuit package list",
      "shortcircuit package install",
      "shortcircuit package link",
      "shortcircuit package register",
    ]) {
      expect(result.stdout).toContain(text);
    }
    expect(result.stdout).not.toContain("--root");
    expect(result.stdout).not.toContain("--main");
    expect(result.stdout).not.toContain("shortcircuit package registry");
  });
});

describe("project packages", () => {
  it("does not load the former bundled package snapshot", async () => {
    const cwd = tempDir();
    await runCli(["init"], { cwd });
    const result = await runCli(["compile", "gates.lf"], {
      cwd,
      read: () => `IMPORT "@shortcircuit/gates"\n\nCIRCUIT Gates\n  INPUT a\n  INPUT b\n  y = AND(a, b)\n  OUTPUT y\nEND`,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("E602");
    expect(result.stderr).toContain('Cannot import "@shortcircuit/gates"');
  });

  it("loads an explicit local package for a single compile", async () => {
    const cwd = tempDir();
    writeDoublePackage(join(cwd, "packages/double"));

    const result = await runCli(
      ["compile", "hello.lf", "--package", "packages/double"],
      { cwd, read: () => DOUBLE_SOURCE },
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("links a local package by name and compiles against it", async () => {
    const cwd = tempDir();
    await runCli(["init"], { cwd });
    const packageDir = join(cwd, "packages/double");
    writeDoublePackage(packageDir);

    const link = await runPackage(["link", "double"], { cwd });
    expect(link.code).toBe(0);
    expect(link.stdout).toContain("Linked @test/double@0.1.0");
    expect(link.stdout).toContain("no files were copied or symlinked");

    const manifest = readJson<{ dependencies: Record<string, string> }>(
      join(cwd, "shortcircuit.json"),
    );
    expect(manifest.dependencies).toEqual({ "@test/double": "path:packages/double" });

    const lock = readJson<{
      packages: Record<string, { type: string; path: string; version: string }>;
    }>(join(cwd, "shortcircuit.lock.json"));
    expect(lock.packages["@test/double"]).toMatchObject({
      type: "path",
      path: "packages/double",
      version: "0.1.0",
    });
    expect(existsSync(join(cwd, ".shortcircuit/packages"))).toBe(false);
    expect(lstatSync(packageDir).isSymbolicLink()).toBe(false);

    const compile = await runCli(["compile", "hello.lf"], {
      cwd,
      read: () => DOUBLE_SOURCE,
    });
    expect(compile.code).toBe(0);

    const list = await runPackage(["list"], { cwd });
    expect(list.code).toBe(0);
    expect(list.stdout).toContain("@test/double");
    expect(list.stdout).toContain("local");
    expect(list.stdout).toContain("packages/double");

    const json = await runPackage(["list", "--json"], { cwd });
    expect(JSON.parse(json.stdout)).toMatchObject({
      packages: [
        {
          name: "@test/double",
          version: "0.1.0",
          origin: "local",
          path: "packages/double",
          state: "ok",
        },
      ],
    });
  });

  it("links a local package by directory", async () => {
    const cwd = tempDir();
    await runCli(["init"], { cwd });
    writeDoublePackage(join(cwd, "packages/double"));

    const link = await runPackage(["link", "packages/double"], { cwd });
    expect(link.code).toBe(0);
    expect(link.stdout).toContain("Linked @test/double@0.1.0");

    const manifest = readJson<{ dependencies: Record<string, string> }>(
      join(cwd, "shortcircuit.json"),
    );
    expect(manifest.dependencies).toEqual({ "@test/double": "path:packages/double" });
  });

  it("verifies path-linked packages with --frozen", async () => {
    const cwd = tempDir();
    await runCli(["init"], { cwd });
    const packageDir = join(cwd, "packages/double");
    writeDoublePackage(packageDir);
    await runPackage(["link", "double"], { cwd });

    const frozen = await runPackage(["install", "--frozen"], { cwd });
    expect(frozen.code).toBe(0);
    expect(frozen.stdout).toContain("up to date");

    writeDoublePackage(packageDir, { version: "0.2.0" });
    const stale = await runPackage(["install", "--frozen"], { cwd });
    expect(stale.code).toBe(1);
    expect(stale.stderr).toContain("locked at 0.1.0");
  });

  it("rejects package update for a path-linked package", async () => {
    const cwd = tempDir();
    await runCli(["init"], { cwd });
    writeDoublePackage(join(cwd, "packages/double"));
    await runPackage(["link", "double"], { cwd });

    const result = await runPackage(["update", "double"], { cwd });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("linked from path:packages/double");
  });

  it("does not delete path-linked files when uninstalling", async () => {
    const cwd = tempDir();
    await runCli(["init"], { cwd });
    const packageDir = join(cwd, "packages/double");
    writeDoublePackage(packageDir);
    await runPackage(["link", "double"], { cwd });

    const removed = await runPackage(["uninstall", "double"], { cwd });
    expect(removed.code).toBe(0);
    expect(removed.stdout).toContain("Path-linked files were not deleted");
    expect(existsSync(join(packageDir, "manifest.json"))).toBe(true);

    const manifest = readJson<{ dependencies: Record<string, string> }>(
      join(cwd, "shortcircuit.json"),
    );
    expect(manifest.dependencies).toEqual({});
    const lock = readJson<{ packages: Record<string, unknown> }>(
      join(cwd, "shortcircuit.lock.json"),
    );
    expect(lock.packages).toEqual({});
  });

  it("prints an empty package list and rejects an unknown list target", async () => {
    const cwd = tempDir();
    await runCli(["init"], { cwd });

    const list = await runPackage(["list"], { cwd });
    expect(list.code).toBe(0);
    expect(list.stdout).toContain("No packages installed");

    const unknown = await runPackage(["list", "bundled"], { cwd });
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("Unknown package list target");
  });

  it("requires an installed dependency before compiling against it", async () => {
    const cwd = tempDir();
    writeProject(cwd, { "@test/double": "^0.1.0" });

    const result = await runCli(["compile", "hello.lf"], {
      cwd,
      read: () => DOUBLE_SOURCE,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("@test/double is not installed");
  });
});

describe("registry-backed package commands", () => {
  function setupRegistry() {
    const registry = new RegistryFixture();
    registry.addPackage({
      name: "@test/double",
      version: "0.1.0",
      description: "Double inversion.",
      manifest: {
        exports: [
          {
            kind: "macro",
            name: "TWICE",
            source: "macros/twice/macro.lf",
            summary: "Double inversion.",
          },
        ],
      },
      files: {
        "macros/twice/macro.lf":
          "MACRO TWICE(x)\n  BODY NAND(NAND(x, x), NAND(x, x))\nEND\n",
      },
    });
    return registry;
  }

  it("lists upstream packages and installs one from the registry", async () => {
    const cwd = tempDir();
    await runCli(["init"], { cwd });
    const registry = setupRegistry();
    const env = { ...process.env, SHORTCIRCUIT_CACHE: join(cwd, ".cache") };

    const upstream = await runPackage(
      ["list", "upstream", "--registry", registry.url, "--refresh"],
      { cwd, fetch: registry.fetch, env },
    );
    expect(upstream.code).toBe(0);
    expect(upstream.stdout).toContain("@test/double");
    expect(upstream.stdout).toContain("0.1.0");
    expect(upstream.stdout).toContain("Double inversion.");

    const install = await runPackage(
      ["install", "@test/double", "--registry", registry.url],
      { cwd, fetch: registry.fetch, env },
    );
    expect(install.code).toBe(0);
    expect(install.stdout).toContain("Installed 1 package: @test/double");

    const manifest = readJson<{ dependencies: Record<string, string> }>(
      join(cwd, "shortcircuit.json"),
    );
    expect(manifest.dependencies).toEqual({ "@test/double": "^0.1.0" });
    const lock = readJson<{
      packages: Record<string, { type: string; resolved: string; integrity: string }>;
    }>(join(cwd, "shortcircuit.lock.json"));
    expect(lock.packages["@test/double"]).toMatchObject({
      type: "registry",
      resolved: expect.stringContaining("packages/test-double-0.1.0/"),
      integrity: expect.stringMatching(/^sha256-/),
    });
    expect(
      existsSync(join(cwd, ".shortcircuit/packages/@test/double/manifest.json")),
    ).toBe(true);

    const compile = await runCli(["compile", "hello.lf"], {
      cwd,
      read: () => DOUBLE_SOURCE,
    });
    expect(compile.code).toBe(0);

    const list = await runPackage(["list"], { cwd });
    expect(list.code).toBe(0);
    expect(list.stdout).toContain("registry");
    expect(list.stdout).toContain(".shortcircuit/packages/@test/double");

    const installedUpstream = await runPackage(
      ["list", "upstream", "--registry", registry.url],
      { cwd, fetch: registry.fetch, env },
    );
    expect(installedUpstream.stdout).toContain("0.1.0");
  });

  it("updates within a range and supports --latest", async () => {
    const cwd = tempDir();
    await runCli(["init"], { cwd });
    const registry = setupRegistry();
    const env = { ...process.env, SHORTCIRCUIT_CACHE: join(cwd, ".cache") };

    await runPackage(
      ["install", "@test/double@0.1.0", "--registry", registry.url],
      { cwd, fetch: registry.fetch, env },
    );
    let lock = readJson<{ packages: Record<string, { version: string }> }>(
      join(cwd, "shortcircuit.lock.json"),
    );
    expect(lock.packages["@test/double"]!.version).toBe("0.1.0");

    registry.addPackage({
      name: "@test/double",
      version: "0.1.1",
      description: "Double inversion.",
      manifest: {
        exports: [
          {
            kind: "macro",
            name: "TWICE",
            source: "macros/twice/macro.lf",
          },
        ],
      },
      files: {
        "macros/twice/macro.lf":
          "MACRO TWICE(x)\n  BODY NAND(NAND(x, x), NAND(x, x))\nEND\n",
      },
    });

    const update = await runPackage(
      ["update", "--latest", "--registry", registry.url],
      { cwd, fetch: registry.fetch, env },
    );
    expect(update.code).toBe(0);
    lock = readJson(join(cwd, "shortcircuit.lock.json"));
    expect(lock.packages["@test/double"]!.version).toBe("0.1.1");
    const manifest = readJson<{ dependencies: Record<string, string> }>(
      join(cwd, "shortcircuit.json"),
    );
    expect(manifest.dependencies["@test/double"]).toBe("^0.1.1");
  });

  it("updates within the saved range without --latest", async () => {
    const cwd = tempDir();
    await runCli(["init"], { cwd });
    const registry = setupRegistry();
    const env = { ...process.env, SHORTCIRCUIT_CACHE: join(cwd, ".cache") };

    await runPackage(
      ["install", "@test/double@^0.1.0", "--registry", registry.url],
      { cwd, fetch: registry.fetch, env },
    );
    registry.addPackage({
      name: "@test/double",
      version: "0.1.1",
      description: "Double inversion.",
      manifest: {
        exports: [
          {
            kind: "macro",
            name: "TWICE",
            source: "macros/twice/macro.lf",
          },
        ],
      },
      files: {
        "macros/twice/macro.lf":
          "MACRO TWICE(x)\n  BODY NAND(NAND(x, x), NAND(x, x))\nEND\n",
      },
    });

    const update = await runPackage(
      ["update", "@test/double", "--registry", registry.url],
      { cwd, fetch: registry.fetch, env },
    );
    expect(update.code).toBe(0);
    const lock = readJson<{ packages: Record<string, { version: string }> }>(
      join(cwd, "shortcircuit.lock.json"),
    );
    expect(lock.packages["@test/double"]!.version).toBe("0.1.1");
    const manifest = readJson<{ dependencies: Record<string, string> }>(
      join(cwd, "shortcircuit.json"),
    );
    expect(manifest.dependencies["@test/double"]).toBe("^0.1.0");
  });

  it("restores the manifest when --latest fails to install", async () => {
    const cwd = tempDir();
    await runCli(["init"], { cwd });
    const registry = setupRegistry();
    const env = { ...process.env, SHORTCIRCUIT_CACHE: join(cwd, ".cache") };

    await runPackage(
      ["install", "@test/double@0.1.0", "--registry", registry.url],
      { cwd, fetch: registry.fetch, env },
    );
    registry.addPackage({
      name: "@test/double",
      version: "0.1.1",
      description: "Broken update.",
      manifest: {
        dependencies: { "@test/missing": "^1.0.0" },
        exports: [
          {
            kind: "macro",
            name: "TWICE",
            source: "macros/twice/macro.lf",
          },
        ],
      },
      files: {
        "macros/twice/macro.lf":
          "MACRO TWICE(x)\n  BODY NAND(NAND(x, x), NAND(x, x))\nEND\n",
      },
    });

    const update = await runPackage(
      ["update", "--latest", "--registry", registry.url],
      { cwd, fetch: registry.fetch, env },
    );
    expect(update.code).toBe(1);
    expect(update.stderr).toContain("@test/missing");

    const manifest = readJson<{ dependencies: Record<string, string> }>(
      join(cwd, "shortcircuit.json"),
    );
    expect(manifest.dependencies["@test/double"]).toBe("0.1.0");
  });

  it("restores the manifest when a remote package is invalid", async () => {
    const cwd = tempDir();
    await runCli(["init"], { cwd });
    const registry = setupRegistry();
    const env = { ...process.env, SHORTCIRCUIT_CACHE: join(cwd, ".cache") };
    registry.addPackage({
      name: "@test/broken",
      version: "0.1.0",
      manifest: {
        exports: [{ kind: "macro", name: "BROKEN" }],
      },
    });

    const result = await runPackage(
      ["install", "@test/broken", "--registry", registry.url],
      { cwd, fetch: registry.fetch, env },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("needs a source");

    const manifest = readJson<{ dependencies: Record<string, string> }>(
      join(cwd, "shortcircuit.json"),
    );
    expect(manifest.dependencies).toEqual({});
  });

  it("restores an installed package from cache while offline", async () => {
    const cwd = tempDir();
    await runCli(["init"], { cwd });
    const registry = setupRegistry();
    const env = { ...process.env, SHORTCIRCUIT_CACHE: join(cwd, ".cache") };

    await runPackage(
      ["install", "@test/double", "--registry", registry.url],
      { cwd, fetch: registry.fetch, env },
    );
    rmSync(join(cwd, ".shortcircuit/packages"), { recursive: true, force: true });

    const offline = await runPackage(
      ["install", "--offline", "--registry", registry.url],
      { cwd, fetch: registry.fetch, env },
    );
    expect(offline.code).toBe(0);
    expect(offline.stdout).toContain("Installed 1 package");
    expect(
      existsSync(join(cwd, ".shortcircuit/packages/@test/double/manifest.json")),
    ).toBe(true);
  });

  it("verifies the lock and store with --frozen", async () => {
    const cwd = tempDir();
    await runCli(["init"], { cwd });
    const registry = setupRegistry();
    const env = { ...process.env, SHORTCIRCUIT_CACHE: join(cwd, ".cache") };

    await runPackage(
      ["install", "@test/double", "--registry", registry.url],
      { cwd, fetch: registry.fetch, env },
    );
    const frozen = await runPackage(
      ["install", "--frozen", "--registry", registry.url],
      { cwd, fetch: registry.fetch, env },
    );
    expect(frozen.code).toBe(0);
    expect(frozen.stdout).toContain("up to date");

    rmSync(join(cwd, ".shortcircuit/packages"), { recursive: true, force: true });
    const missing = await runPackage(
      ["install", "--frozen", "--registry", registry.url],
      { cwd, fetch: registry.fetch, env },
    );
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("missing from .shortcircuit/packages");
  });

  it("installs transitive dependencies and prunes them on uninstall", async () => {
    const cwd = tempDir();
    await runCli(["init"], { cwd });
    const registry = setupRegistry();
    registry.addPackage({
      name: "@test/parent",
      version: "0.1.0",
      description: "Parent package.",
      manifest: {
        dependencies: { "@test/double": "^0.1.0" },
        exports: [
          {
            kind: "macro",
            name: "FOUR",
            source: "macros/four/macro.lf",
          },
        ],
      },
      files: {
        "macros/four/macro.lf": "MACRO FOUR(x)\n  BODY TWICE(TWICE(x))\nEND\n",
      },
    });
    const env = { ...process.env, SHORTCIRCUIT_CACHE: join(cwd, ".cache") };

    const install = await runPackage(
      ["install", "@test/parent", "--registry", registry.url],
      { cwd, fetch: registry.fetch, env },
    );
    expect(install.code).toBe(0);
    expect(install.stdout).toContain("@test/parent");
    expect(install.stdout).toContain("@test/double");
    let lock = readJson<{ packages: Record<string, unknown> }>(
      join(cwd, "shortcircuit.lock.json"),
    );
    expect(Object.keys(lock.packages).sort()).toEqual(["@test/double", "@test/parent"]);

    const uninstall = await runPackage(["uninstall", "@test/parent"], { cwd });
    expect(uninstall.code).toBe(0);
    lock = readJson(join(cwd, "shortcircuit.lock.json"));
    expect(lock.packages).toEqual({});
    expect(existsSync(join(cwd, ".shortcircuit/packages/@test/double"))).toBe(false);
    expect(existsSync(join(cwd, ".shortcircuit/packages/@test/parent"))).toBe(false);
  });

  it("reports a dependency conflict clearly", async () => {
    const cwd = tempDir();
    await runCli(["init"], { cwd });
    const registry = setupRegistry();
    registry.addPackage({
      name: "@test/parent",
      version: "0.1.0",
      manifest: {
        dependencies: { "@test/double": "^2.0.0" },
        exports: [
          {
            kind: "macro",
            name: "FOUR",
            source: "macros/four/macro.lf",
          },
        ],
      },
      files: {
        "macros/four/macro.lf": "MACRO FOUR(x)\n  BODY NAND(x, x)\nEND\n",
      },
    });
    const env = { ...process.env, SHORTCIRCUIT_CACHE: join(cwd, ".cache") };

    const install = await runPackage(
      ["install", "@test/parent", "--registry", registry.url],
      { cwd, fetch: registry.fetch, env },
    );
    expect(install.code).toBe(1);
    expect(install.stderr).toContain("No version of @test/double satisfies");
  });

  it("reports missing cache entries in offline mode", async () => {
    const cwd = tempDir();
    await runCli(["init"], { cwd });
    const registry = setupRegistry();
    const env = { ...process.env, SHORTCIRCUIT_CACHE: join(cwd, ".cache") };

    const result = await runPackage(
      ["install", "@test/double", "--offline", "--registry", registry.url],
      { cwd, fetch: registry.fetch, env },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("No cached registry index");
  });

  it("rejects conflicting path and registry dependencies without --force", async () => {
    const cwd = tempDir();
    await runCli(["init"], { cwd });
    writeDoublePackage(join(cwd, "packages/double"));
    await runPackage(["link", "double"], { cwd });
    const registry = setupRegistry();
    const env = { ...process.env, SHORTCIRCUIT_CACHE: join(cwd, ".cache") };

    const install = await runPackage(
      ["install", "@test/double", "--registry", registry.url],
      { cwd, fetch: registry.fetch, env },
    );
    expect(install.code).toBe(1);
    expect(install.stderr).toContain("is linked from");
  });
});
