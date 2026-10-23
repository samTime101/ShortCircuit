import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const cliDir = join(root, "packages", "cli");
const tempRoot = mkdtempSync(join(tmpdir(), "shortcircuit-cli-pack-"));
const tarballDir = join(tempRoot, "tarball");
const projectDir = join(tempRoot, "project");
const packageDir = join(projectDir, "packages", "double");
const registryDir = join(tempRoot, "registry");
const cacheDir = join(tempRoot, "cache");

function run(bin, args, cwd, env = process.env) {
  return execFileSync(bin, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function runFailure(bin, args, cwd, env = process.env) {
  const result = spawnSync(bin, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 0) {
    throw new Error(`expected ${args.join(" ")} to fail`);
  }
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

try {
  mkdirSync(tarballDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });

  run("npm", ["pack", "--pack-destination", tarballDir], cliDir);
  const tarball = readdirSync(tarballDir).find((file) => file.endsWith(".tgz"));
  if (!tarball) throw new Error("npm pack did not produce a tarball");
  const tarballPath = join(tarballDir, tarball);
  console.log(`Packed ${tarball}`);

  run("npm", ["init", "-y"], projectDir);
  run("npm", ["install", "--no-audit", "--no-fund", tarballPath], projectDir);

  const installedPath = join(
    projectDir,
    "node_modules",
    "@shortcircuitcli",
    "cli",
    "package.json",
  );
  const installed = JSON.parse(readFileSync(installedPath, "utf8"));
  if (installed.name !== "@shortcircuitcli/cli") {
    throw new Error(`unexpected package name ${installed.name}`);
  }

  const bin = join(
    projectDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "shortcircuit.cmd" : "shortcircuit",
  );

  const help = run(bin, ["help"], projectDir);
  if (!help.includes("Usage:") || !help.includes("shortcircuit compile")) {
    throw new Error("the installed binary did not print the command help");
  }
  if (help.includes("--disable-package") || help.includes("--only-packages")) {
    throw new Error(`the installed binary still documents package toggles:\n${help}`);
  }

  const packageHelp = run(bin, ["package", "help"], projectDir);
  for (const command of [
    "package list",
    "package install",
    "package link",
    "package init",
    "package build",
    "package test",
    "package check",
    "package register",
  ]) {
    if (!packageHelp.includes(`shortcircuit ${command}`)) {
      throw new Error(`package help is missing ${command}:\n${packageHelp}`);
    }
  }
  if (packageHelp.includes("package registry")) {
    throw new Error(`package help still documents the removed registry command:\n${packageHelp}`);
  }

  const distPath = join(
    projectDir,
    "node_modules",
    "@shortcircuitcli",
    "cli",
    "dist",
    "cli.js",
  );
  const bundle = readFileSync(distPath, "utf8");
  if (bundle.includes("macros/and/macro.lf")) {
    throw new Error("the packed CLI still ships the default package snapshot");
  }

  run(bin, ["init"], projectDir);
  if (!existsSync(join(projectDir, "shortcircuit.json"))) {
    throw new Error("shortcircuit init did not create a project manifest");
  }
  const compiledProject = run(bin, ["compile", "src/main.lf"], projectDir);
  if (!compiledProject.includes("Compiled 1 circuit")) {
    throw new Error(`unexpected project compile output:\n${compiledProject}`);
  }

  write(
    join(projectDir, "gates.lf"),
    `IMPORT "@shortcircuit/gates"\n\nCIRCUIT Gates\n  INPUT a\n  INPUT b\n  y = AND(a, b)\n  OUTPUT y\nEND\n`,
  );
  const noDefaults = runFailure(bin, ["compile", "gates.lf"], projectDir);
  if (!noDefaults.stderr.includes("E602")) {
    throw new Error(`the CLI unexpectedly loaded bundled packages:\n${noDefaults.stderr}`);
  }

  mkdirSync(packageDir, { recursive: true });
  const init = run(
    bin,
    [
      "package",
      "init",
      "--name",
      "@test/double",
      "--export",
      "TWICE",
      "--kind",
      "macro",
      "--description",
      "Double inversion for the packed CLI test.",
      "--yes",
    ],
    packageDir,
  );
  if (!init.includes("Created package @test/double@0.1.0")) {
    throw new Error(`unexpected package init output:\n${init}`);
  }
  if (!init.includes("MACRO")) {
    throw new Error(`package init did not explain MACRO vs CIRCUIT:\n${init}`);
  }

  const check = run(bin, ["package", "check"], packageDir);
  if (!check.includes("Built @test/double@0.1.0") || !check.includes("passed")) {
    throw new Error(`unexpected package check output:\n${check}`);
  }

  const registration = JSON.parse(
    run(bin, ["package", "register", "--dry-run", "--json"], packageDir),
  );
  if (registration.registryEntry?.name !== "@test/double") {
    throw new Error(`unexpected registration output:\n${JSON.stringify(registration)}`);
  }

  const linked = run(bin, ["package", "link", "packages/double"], projectDir);
  if (!linked.includes("no files were copied or symlinked")) {
    throw new Error(`unexpected package link output:\n${linked}`);
  }

  write(
    join(projectDir, "local.lf"),
    `IMPORT "@test/double"\n\nCIRCUIT Local\n  INPUT a\n  INPUT b\n  y = TWICE(a, b)\n  OUTPUT y\nEND\n`,
  );
  const localCompiled = run(bin, ["compile", "local.lf"], projectDir);
  if (!localCompiled.includes("Compiled 1 circuit")) {
    throw new Error(`unexpected local package compile output:\n${localCompiled}`);
  }

  const listed = run(bin, ["package", "list"], projectDir);
  if (!listed.includes("@test/double") || !listed.includes("local")) {
    throw new Error(`unexpected package list output:\n${listed}`);
  }

  write(
    join(registryDir, "registry.json"),
    `${JSON.stringify(
      {
        schema: "shortcircuit.registry/v1",
        packages: [
          {
            name: "@test/remote",
            version: "0.1.0",
            manifest: "packages/remote/manifest.json",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  write(
    join(registryDir, "packages", "remote", "manifest.json"),
    `${JSON.stringify(
      {
        schema: "shortcircuit.package/v1",
        name: "@test/remote",
        version: "0.1.0",
        description: "Remote test package.",
        exports: [
          {
            kind: "macro",
            name: "REMOTE",
            source: "macros/remote/macro.lf",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  write(
    join(registryDir, "packages", "remote", "package.json"),
    `${JSON.stringify({ name: "@test/remote", version: "0.1.0" }, null, 2)}\n`,
  );
  write(
    join(registryDir, "packages", "remote", "macros", "remote", "macro.lf"),
    "MACRO REMOTE(x)\n  BODY NAND(x, x)\nEND\n",
  );
  const registryUrl = pathToFileURL(join(registryDir, "registry.json")).href;
  const env = { ...process.env, SHORTCIRCUIT_CACHE: cacheDir };

  const installedRemote = run(
    bin,
    ["package", "install", "@test/remote", "--registry", registryUrl],
    projectDir,
    env,
  );
  if (!installedRemote.includes("@test/remote")) {
    throw new Error(`unexpected registry install output:\n${installedRemote}`);
  }

  write(
    join(projectDir, "remote.lf"),
    `IMPORT "@test/remote"\n\nCIRCUIT RemoteCircuit\n  INPUT a\n  y = REMOTE(a)\n  OUTPUT y\nEND\n`,
  );
  const remoteCompiled = run(bin, ["compile", "remote.lf"], projectDir);
  if (!remoteCompiled.includes("Compiled 1 circuit")) {
    throw new Error(`unexpected registry package compile output:\n${remoteCompiled}`);
  }

  const upstream = run(
    bin,
    ["package", "list", "upstream", "--registry", registryUrl, "--refresh"],
    projectDir,
    env,
  );
  if (!upstream.includes("@test/remote") || !upstream.includes("0.1.0")) {
    throw new Error(`unexpected upstream list output:\n${upstream}`);
  }

  const removed = run(bin, ["package", "uninstall", "remote"], projectDir);
  if (!removed.includes("Removed @test/remote")) {
    throw new Error(`unexpected uninstall output:\n${removed}`);
  }
  if (existsSync(join(projectDir, ".shortcircuit", "packages", "@test", "remote"))) {
    throw new Error("uninstall did not remove the registry package store");
  }
  if (!existsSync(join(packageDir, "manifest.json"))) {
    throw new Error("uninstall deleted path-linked package files");
  }

  console.log("Packed CLI package workflow passed.");
  console.log(`Installed ${installed.name}@${installed.version} in a clean project.`);
  console.log(compiledProject.trim());
  console.log(init.trim().split("\n")[0]);
  console.log(localCompiled.trim());
  console.log(remoteCompiled.trim());
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
