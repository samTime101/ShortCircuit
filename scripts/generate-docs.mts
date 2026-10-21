import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { operationReferenceMarkdown } from "./reference.mts";

/**
 * Rewrites the generated operation reference inside docs/LANGUAGE.md.
 *
 * Run it with:  node --experimental-strip-types scripts/generate-docs.mts
 */

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../docs/LANGUAGE.md");
const source = readFileSync(target, "utf8");

interface BundleExport {
  kind: string;
  name: string;
  sourceText?: string;
  summary?: string;
  group?: string;
  widthRule?: string;
  internal?: boolean;
  examples?: string[];
  ports?: {
    inputs: Array<{ name: string }>;
    outputs: Array<{ name: string }>;
  };
}

interface BundlePackage {
  exports: BundleExport[];
}

const bundle = JSON.parse(
  readFileSync(
    resolve(here, "../vendor/ShortCircuit-Packages/dist/packages.json"),
    "utf8",
  ),
) as { packages: BundlePackage[] };
const packageCircuits = bundle.packages
  .flatMap((entry) => entry.exports)
  .filter((entry): entry is BundleExport & { kind: "circuit" } => entry.kind === "circuit");

const packageMacros = bundle.packages
  .flatMap((entry) => entry.exports)
  .filter(
    (entry): entry is BundleExport & { kind: "macro" } =>
      entry.kind === "macro" && !entry.internal,
  )
  .map((entry) => {
    const declarations = entry.sourceText?.matchAll(
      /MACRO\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/gi,
    );
    let rawArgs = "";
    for (const declaration of declarations ?? []) {
      if (declaration[1]?.toUpperCase() === entry.name.toUpperCase()) {
        rawArgs = declaration[2] ?? "";
        break;
      }
    }
    const variadic = rawArgs.includes("...");
    const args = rawArgs
      .split(",")
      .map((arg) => arg.trim())
      .filter((arg) => arg.length > 0 && arg !== "...");
    return {
      name: entry.name,
      signature: `${entry.name}(${[...args, ...(variadic ? ["..."] : [])].join(", ")})`,
      args,
      variadic,
      summary: entry.summary,
      group: entry.group,
      widthRule: entry.widthRule,
      examples: entry.examples,
    };
  });

const start = "<!-- BEGIN GENERATED REFERENCE -->";
const end = "<!-- END GENERATED REFERENCE -->";
const from = source.indexOf(start);
const to = source.indexOf(end);

if (from === -1 || to === -1) {
  console.error("The generated reference markers are missing from docs/LANGUAGE.md.");
  process.exit(1);
}

const next = `${source.slice(0, from)}${operationReferenceMarkdown({
  macros: packageMacros,
  circuits: packageCircuits,
})}${source.slice(to + end.length)}`;
writeFileSync(target, next);
console.log("docs/LANGUAGE.md operation reference regenerated");
