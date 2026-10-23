import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../src/cli";
import {
  cleanupTempDirs,
  readJson,
  tempDir,
  writeDoublePackage,
  writeProject,
  writeText,
} from "./helpers";

afterEach(cleanupTempDirs);

const noRead = () => {
  throw new Error("package commands should not read a source file");
};

function runPackage(
  args: string[],
  cwd: string,
  env: Record<string, string | undefined> = process.env,
) {
  return run(["package", ...args], noRead, () => undefined, {
    cwd,
    env,
    interactive: false,
  });
}

function runCli(
  args: string[],
  cwd: string,
  env: Record<string, string | undefined> = process.env,
) {
  return run(args, noRead, () => undefined, {
    cwd,
    env,
    interactive: false,
  });
}

describe("package authoring commands", () => {
  it("scaffolds a package locally without a registry checkout", async () => {
    const root = tempDir();
    const result = await runPackage(
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
        "--yes",
      ],
      root,
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("MACRO");
    expect(result.stdout).toContain("CIRCUIT");
    expect(result.stdout).toContain("Created package @acme/parity@0.2.0");

    const manifest = readJson<Record<string, unknown>>(join(root, "manifest.json"));
    expect(manifest).toMatchObject({
      schema: "shortcircuit.package/v1",
      name: "@acme/parity",
      version: "0.2.0",
      dependencies: { "@shortcircuit/gates": "^0.1.0" },
    });
    expect(existsSync(join(root, "package.json"))).toBe(true);
    expect(existsSync(join(root, "shortcircuit.lock.json"))).toBe(true);
    expect(existsSync(join(root, "macros/parity3/macro.lf"))).toBe(true);
    expect(existsSync(join(root, "docs/parity3.md"))).toBe(true);
    expect(existsSync(join(root, "tests/parity.test.lf"))).toBe(true);
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain(".shortcircuit/");
  });

  it("requires a name when not prompting", async () => {
    const result = await runPackage(["init", "--yes"], tempDir());
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Missing --name");
  });

  it("does not overwrite an existing package without --force", async () => {
    const root = tempDir();
    await runPackage(["init", "--name", "@acme/parity", "--yes"], root);
    const again = await runPackage(["init", "--name", "@acme/parity", "--yes"], root);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain("already exists");

    const forced = await runPackage(
      ["init", "--name", "@acme/parity", "--export", "PARITY4", "--force", "--yes"],
      root,
    );
    expect(forced.code).toBe(0);
  });

  it("scaffolds a circuit package", async () => {
    const root = tempDir();
    const result = await runPackage(
      ["init", "--name", "@acme/buffer", "--kind", "circuit", "--yes"],
      root,
    );

    expect(result.code).toBe(0);
    expect(existsSync(join(root, "circuits/buffer/circuit.lf"))).toBe(true);
    const manifest = readJson<{ exports: Array<{ kind: string; name: string }> }>(
      join(root, "manifest.json"),
    );
    expect(manifest.exports[0]).toMatchObject({ kind: "circuit", name: "BUFFER" });
  });

  it("builds and tests a package locally", async () => {
    const root = tempDir();
    await runPackage(
      ["init", "--name", "@test/example", "--export", "EXAMPLE", "--yes"],
      root,
    );

    const build = await runPackage(["build"], root);
    expect(build.code).toBe(0);
    expect(build.stdout).toContain("Built @test/example@0.1.0");
    const bundle = readJson<{ schema: string; packages: Array<{ name: string }> }>(
      join(root, "dist/packages.json"),
    );
    expect(bundle.schema).toBe("shortcircuit.packages/v1");
    expect(bundle.packages[0]!.name).toBe("@test/example");

    const test = await runPackage(["test"], root);
    expect(test.code).toBe(0);
    expect(test.stdout).toContain("PASS");
    expect(test.stdout).toContain("2 passed");

    const check = await runPackage(["check"], root);
    expect(check.code).toBe(0);
    expect(check.stdout).toContain("Built @test/example@0.1.0");
    expect(check.stdout).toContain("2 passed");
  });

  it("runs a package from a nested directory", async () => {
    const root = tempDir();
    await runPackage(["init", "--name", "@test/nested", "--yes"], root);
    const nested = join(root, "src");
    const result = await runPackage(["test"], nested);
    expect(result.code).toBe(0);
  });

  it("reports dependencies that are not installed", async () => {
    const root = tempDir();
    writeDoublePackage(root, { dependencies: { "@test/parent": "^0.1.0" } });
    const result = await runPackage(["test"], root);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("is not installed");
  });

  it("prepares a registration submission", async () => {
    const root = tempDir();
    await runPackage(["init", "--name", "@acme/parity", "--yes"], root);

    const dryRun = await runPackage(["register", "--dry-run"], root);
    expect(dryRun.code).toBe(0);
    const dryRunData = JSON.parse(dryRun.stdout) as {
      registryEntry: { name: string; version: string; manifest: string };
      integrity: string;
      files: string[];
    };
    expect(dryRunData.registryEntry).toEqual({
      name: "@acme/parity",
      version: "0.1.0",
      manifest: "packages/parity/manifest.json",
    });
    expect(dryRunData.integrity).toMatch(/^sha256-/);
    expect(dryRunData.files).toContain("manifest.json");
    expect(existsSync(join(root, ".shortcircuit/register/parity-0.1.0/submission.json"))).toBe(
      false,
    );

    const registered = await runPackage(["register"], root);
    expect(registered.code).toBe(0);
    expect(registered.stdout).toContain("Created registration submission");
    expect(existsSync(join(root, ".shortcircuit/register/parity-0.1.0/submission.json"))).toBe(
      true,
    );
  });

  it("rejects path dependencies when registering", async () => {
    const root = tempDir();
    const linked = join(root, "linked");
    writeDoublePackage(linked);
    writeDoublePackage(root, { dependencies: { "@test/double": "path:linked" } });

    const result = await runPackage(["register", "--dry-run"], root);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("path link");
  });

  it("shows package help without a project or registry", async () => {
    const result = await runPackage(["help"], tempDir());
    const init = await runPackage(["init", "--help"], tempDir());

    expect(result.code).toBe(0);
    for (const command of [
      "package list",
      "package list upstream",
      "package install",
      "package uninstall",
      "package update",
      "package link",
      "package init",
      "package build",
      "package test",
      "package check",
      "package register",
    ]) {
      expect(result.stdout).toContain(command);
    }
    expect(init.code).toBe(0);
    expect(init.stdout).toContain("--name <@scope/name>");
    expect(init.stdout).toContain("--dependencies <list>");
    expect(init.stdout).not.toContain("--root");
  });

  it("rejects unknown package commands and extra arguments", async () => {
    const unknown = await runPackage(["installable"], tempDir());
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("Unknown package command");

    const extra = await runPackage(["build", "circuit.lf"], tempDir());
    expect(extra.code).toBe(1);
    expect(extra.stderr).toContain("takes no file");
  });

  it("refuses to create a package at a project root", async () => {
    const root = tempDir();
    writeProject(root);

    const result = await runPackage(
      ["init", "--name", "@acme/parity", "--export", "PARITY3", "--yes"],
      root,
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("project root");
    expect(existsSync(join(root, "manifest.json"))).toBe(false);
    expect(existsSync(join(root, "macros/parity3/macro.lf"))).toBe(false);
  });

  it("refuses to create a project over a package root", async () => {
    const root = tempDir();
    await runPackage(["init", "--name", "@acme/parity", "--yes"], root);

    const result = await runCli(["init"], root);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("package root");
    expect(existsSync(join(root, "shortcircuit.json"))).toBe(false);
  });

  it("reports a directory that is both a project and package root", async () => {
    const root = tempDir();
    writeProject(root);
    writeDoublePackage(root);

    const result = await runPackage(["list"], root);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("contains both a Short Circuit project");
    expect(result.stderr).toContain("packages/<name>");
  });

  it("adds a second export to an existing package", async () => {
    const root = tempDir();
    await runPackage(
      ["init", "--name", "@acme/parity", "--export", "PARITY3", "--kind", "macro", "--yes"],
      root,
    );

    const result = await runPackage(
      ["add-export", "--export", "PARITY4", "--kind", "circuit", "--yes"],
      root,
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Added circuit export");

    const manifest = readJson<{ exports: Array<{ name: string; kind: string }> }>(
      join(root, "manifest.json"),
    );
    expect(manifest.exports).toHaveLength(2);
    expect(manifest.exports[0]).toMatchObject({ name: "PARITY3", kind: "macro" });
    expect(manifest.exports[1]).toMatchObject({ name: "PARITY4", kind: "circuit" });

    expect(existsSync(join(root, "circuits/parity4/circuit.lf"))).toBe(true);
    expect(existsSync(join(root, "circuits/parity4/docs.md"))).toBe(true);
    expect(existsSync(join(root, "tests/parity4.test.lf"))).toBe(true);
  });

  it("adds a macro export to a circuit package", async () => {
    const root = tempDir();
    await runPackage(
      ["init", "--name", "@acme/buffer", "--export", "BUFFER", "--kind", "circuit", "--yes"],
      root,
    );

    const result = await runPackage(
      ["add-export", "--export", "TWICE", "--kind", "macro", "--yes"],
      root,
    );

    expect(result.code).toBe(0);
    const manifest = readJson<{ exports: Array<{ name: string; kind: string }> }>(
      join(root, "manifest.json"),
    );
    expect(manifest.exports).toHaveLength(2);
    expect(manifest.exports[1]).toMatchObject({ name: "TWICE", kind: "macro" });
    expect(existsSync(join(root, "macros/twice/macro.lf"))).toBe(true);
  });

  it("rejects duplicate export name", async () => {
    const root = tempDir();
    await runPackage(
      ["init", "--name", "@acme/parity", "--export", "PARITY3", "--yes"],
      root,
    );

    const result = await runPackage(
      ["add-export", "--export", "PARITY3", "--yes"],
      root,
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("already exists");
  });

  it("refuses add-export outside a package", async () => {
    const root = tempDir();
    const result = await runPackage(
      ["add-export", "--export", "FOO", "--yes"],
      root,
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("No manifest.json found");
  });

  it("adds an export with interactive true when flags are provided without hanging", async () => {
    const root = tempDir();
    await runPackage(
      ["init", "--name", "@shortcircuit/arithmetic", "--export", "HALFADDER", "--kind", "circuit", "--yes"],
      root,
    );

    const result = await run(
      ["package", "add-export", "--export", "FULLADDER", "--kind", "circuit"],
      noRead,
      () => undefined,
      {
        cwd: root,
        interactive: true,
      },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Added circuit export "FULLADDER"');
    expect(existsSync(join(root, "circuits/fulladder/circuit.lf"))).toBe(true);
  });
});
