import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const cliDir = join(root, "packages", "cli");
const tempRoot = mkdtempSync(join(tmpdir(), "shortcircuit-cli-pack-"));
const tarballDir = join(tempRoot, "tarball");
const projectDir = join(tempRoot, "project");

const SOURCE = `IMPORT "@shortcircuit/gates"

CIRCUIT HalfAdder
  INPUT a
  INPUT b

  sum = XOR(a, b)
  carry = AND(a, b)

  OUTPUT sum
  OUTPUT carry
END

TEST HalfAdder
  CASE "both high"
    INPUT a = 1
    INPUT b = 1
    EXPECT sum = 0
    EXPECT carry = 1
  END
END
`;

function run(bin, args, cwd) {
  return execFileSync(bin, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function runFailure(bin, args, cwd) {
  const result = spawnSync(bin, args, {
    cwd,
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
    "package registry",
    "package init",
    "package build",
    "package test",
    "package check",
  ]) {
    if (!packageHelp.includes(`shortcircuit ${command}`)) {
      throw new Error(`package help is missing ${command}:\n${packageHelp}`);
    }
  }
  const initHelp = run(bin, ["package", "init", "--help"], projectDir);
  if (!initHelp.includes("--name") || !initHelp.includes("--dependencies")) {
    throw new Error(`package init help is incomplete:\n${initHelp}`);
  }

  const missingRegistry = runFailure(bin, ["package", "build"], projectDir);
  if (!missingRegistry.stderr.includes("Could not find the Short Circuit package registry")) {
    throw new Error(`unexpected missing registry output:\n${missingRegistry.stderr}`);
  }

  const fakeRoot = join(tempRoot, "fake-registry");
  mkdirSync(join(fakeRoot, "scripts"), { recursive: true });
  writeFileSync(
    join(fakeRoot, "package.json"),
    `${JSON.stringify({ name: "@shortcircuit/packages", version: "0.1.0" }, null, 2)}\n`,
  );
  writeFileSync(
    join(fakeRoot, "registry.json"),
    `${JSON.stringify({ schema: "shortcircuit.registry/v1", packages: [] }, null, 2)}\n`,
  );
  writeFileSync(
    join(fakeRoot, "scripts", "package.mjs"),
    "const command = process.argv[2];\n" +
      "process.stdout.write(`fake package ${process.argv.slice(2).join(' ')}\\n`);\n" +
      "if (command === 'check') process.exitCode = 7;\n",
  );

  const registryJson = JSON.parse(
    run(bin, ["package", "registry", "--json", "--root", fakeRoot], projectDir),
  );
  if (!Array.isArray(registryJson.packages) || registryJson.packages.length !== 0) {
    throw new Error(`unexpected registry JSON:\n${JSON.stringify(registryJson)}`);
  }

  const delegated = run(
    bin,
    ["package", "build", "--root", fakeRoot],
    projectDir,
  );
  if (!delegated.includes("fake package build")) {
    throw new Error(`package build did not delegate:\n${delegated}`);
  }

  const failed = runFailure(
    bin,
    ["package", "check", "--root", fakeRoot],
    projectDir,
  );
  if (failed.status !== 7) {
    throw new Error(`package check did not return the child status: ${failed.status}`);
  }

  const listed = run(bin, ["package", "list"], projectDir);
  const gatesRow = listed
    .split("\n")
    .find((line) => line.startsWith("@shortcircuit/gates"));
  if (!gatesRow || !gatesRow.includes("bundled")) {
    throw new Error(`unexpected package list output:\n${listed}`);
  }

  writeFileSync(join(projectDir, "half-adder.lf"), SOURCE);
  const compiled = run(bin, ["compile", "half-adder.lf"], projectDir);
  if (!compiled.includes("Compiled 1 circuit")) {
    throw new Error(`unexpected compile output:\n${compiled}`);
  }

  const tested = run(bin, ["test", "half-adder.lf"], projectDir);
  if (!tested.includes("1 passed, 0 failed")) {
    throw new Error(`unexpected test output:\n${tested}`);
  }

  const localDir = join(projectDir, "local-package");
  mkdirSync(join(localDir, "macros", "twice"), { recursive: true });
  writeFileSync(
    join(localDir, "manifest.json"),
    JSON.stringify(
      {
        schema: "shortcircuit.package/v1",
        name: "@test/double",
        version: "0.1.0",
        exports: [
          {
            kind: "macro",
            name: "TWICE",
            source: "macros/twice/macro.lf",
          },
        ],
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(localDir, "macros", "twice", "macro.lf"),
    "MACRO TWICE(x)\n  BODY NAND(NAND(x, x), NAND(x, x))\nEND\n",
  );
  writeFileSync(
    join(projectDir, "local.lf"),
    `IMPORT "@test/double"

CIRCUIT Local
  INPUT a
  y = TWICE(a)
  OUTPUT y
END
`,
  );
  const localCompiled = run(
    bin,
    ["compile", "local.lf", "--package", localDir],
    projectDir,
  );
  if (!localCompiled.includes("Compiled 1 circuit")) {
    throw new Error(`unexpected local package compile output:\n${localCompiled}`);
  }

  console.log("Package authoring commands work in the packed CLI.");
  console.log(`Installed ${installed.name}@${installed.version} in a clean project.`);
  console.log(gatesRow.trim());
  console.log(compiled.trim());
  console.log(tested.trim().split("\n").at(-1));
  console.log(localCompiled.trim());
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
