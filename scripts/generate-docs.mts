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

const start = "<!-- BEGIN GENERATED REFERENCE -->";
const end = "<!-- END GENERATED REFERENCE -->";
const from = source.indexOf(start);
const to = source.indexOf(end);

if (from === -1 || to === -1) {
  console.error("The generated reference markers are missing from docs/LANGUAGE.md.");
  process.exit(1);
}

const next = `${source.slice(0, from)}${operationReferenceMarkdown()}${source.slice(to + end.length)}`;
writeFileSync(target, next);
console.log("docs/LANGUAGE.md operation reference regenerated");
