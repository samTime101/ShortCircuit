import { execFileSync } from "node:child_process";
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

const SOURCE = `CIRCUIT HalfAdder
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
    "@shortcircuit",
    "cli",
    "package.json",
  );
  const installed = JSON.parse(readFileSync(installedPath, "utf8"));
  if (installed.name !== "@shortcircuit/cli") {
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

  writeFileSync(join(projectDir, "half-adder.lf"), SOURCE);
  const compiled = run(bin, ["compile", "half-adder.lf"], projectDir);
  if (!compiled.includes("Compiled 1 circuit")) {
    throw new Error(`unexpected compile output:\n${compiled}`);
  }

  const tested = run(bin, ["test", "half-adder.lf"], projectDir);
  if (!tested.includes("1 passed, 0 failed")) {
    throw new Error(`unexpected test output:\n${tested}`);
  }

  console.log(`Installed ${installed.name}@${installed.version} in a clean project.`);
  console.log(compiled.trim());
  console.log(tested.trim().split("\n").at(-1));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
