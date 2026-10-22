import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const tempDirs: string[] = [];

export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "shortcircuit-cli-test-"));
  tempDirs.push(dir);
  return dir;
}

export function cleanupTempDirs(): void {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
}

export function writeText(root: string, relative: string, contents: string): void {
  const path = join(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

export interface DoublePackageOptions {
  name?: string;
  version?: string;
  packageName?: string;
  packageVersion?: string;
  writePackageJson?: boolean;
  docs?: boolean;
  tests?: boolean;
}

export function writeDoublePackage(root: string, options: DoublePackageOptions = {}): void {
  const name = options.name ?? "@test/double";
  const version = options.version ?? "0.1.0";
  const manifest: Record<string, unknown> = {
    schema: "shortcircuit.package/v1",
    name,
    version,
    description: "Test double inversion package.",
    exports: [
      {
        kind: "macro",
        name: "TWICE",
        source: "macros/twice/macro.lf",
        summary: "Double inversion.",
        ...(options.docs ? { docs: "docs/twice.md" } : {}),
      },
    ],
  };
  if (options.tests) manifest.tests = "tests/double.test.lf";
  writeText(root, "manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  if (options.writePackageJson !== false) {
    writeText(
      root,
      "package.json",
      `${JSON.stringify(
        {
          name: options.packageName ?? name,
          version: options.packageVersion ?? version,
        },
        null,
        2,
      )}\n`,
    );
  }
  writeText(
    root,
    "macros/twice/macro.lf",
    "MACRO TWICE(x)\n  BODY NAND(NAND(x, x), NAND(x, x))\nEND\n",
  );
  if (options.docs) {
    writeText(root, "docs/twice.md", "# TWICE\n\nDouble inversion.\n");
  }
  if (options.tests) {
    writeText(
      root,
      "tests/double.test.lf",
      `CIRCUIT DOUBLE_TEST
  INPUT a
  y = TWICE(a)
  OUTPUT y
END

TEST DOUBLE_TEST
  CASE "high"
    INPUT a = 1
    EXPECT y = 1
  END
END
`,
    );
  }
}

export interface CircuitPackageOptions {
  name?: string;
  version?: string;
}

export function writeCircuitPackage(root: string, options: CircuitPackageOptions = {}): void {
  const name = options.name ?? "@test/local-buffer";
  const version = options.version ?? "0.1.0";
  const manifest = {
    schema: "shortcircuit.package/v1",
    name,
    version,
    description: "Test local circuit package.",
    exports: [
      {
        kind: "circuit",
        name: "LOCAL_BUFFER",
        source: "circuits/local-buffer/circuit.lf",
        docs: "circuits/local-buffer/docs.md",
        tests: "circuits/local-buffer/test.lf",
        summary: "Local buffer.",
      },
    ],
  };
  writeText(root, "manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  writeText(
    root,
    "package.json",
    `${JSON.stringify({ name, version }, null, 2)}\n`,
  );
  writeText(
    root,
    "circuits/local-buffer/circuit.lf",
    `CIRCUIT LOCAL_BUFFER
  INPUT a
  y = NAND(a, a)
  OUTPUT y
END
`,
  );
  writeText(root, "circuits/local-buffer/docs.md", "# LOCAL_BUFFER\n\nLocal buffer.\n");
  writeText(
    root,
    "circuits/local-buffer/test.lf",
    `CIRCUIT LOCAL_BUFFER_TEST
  INPUT a
  y = LOCAL_BUFFER(a)
  OUTPUT y
END

TEST LOCAL_BUFFER_TEST
  CASE "high"
    INPUT a = 1
    EXPECT y = 1
  END
END
`,
  );
}
