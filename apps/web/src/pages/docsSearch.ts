import type {
  BuiltinSpec,
  GlossaryEntry,
  LanguageSnippet,
  PackageCircuitExport,
  PackageManifest,
  ResolvedPackageMacro,
} from "@shortcircuit/engine";

/** The kinds of things the documentation search can find. */
export type DocsSearchKind =
  | "section"
  | "glossary"
  | "built-in"
  | "package"
  | "macro"
  | "circuit"
  | "snippet";

export interface DocsSearchEntry {
  /** Anchor id of the element to scroll to. */
  id: string;
  title: string;
  subtitle?: string;
  kind: DocsSearchKind;
  group?: string;
  keywords?: string[];
}

export interface DocsSearchSection {
  id: string;
  label: string;
  group: string;
  keywords?: string[];
}

export interface DocsSearchCircuit {
  packageName: string;
  circuit: PackageCircuitExport;
}

export interface DocsSearchSources {
  sections: readonly DocsSearchSection[];
  packages: readonly PackageManifest[];
  macros: readonly ResolvedPackageMacro[];
  circuits: readonly DocsSearchCircuit[];
  glossary: readonly GlossaryEntry[];
  snippets: readonly LanguageSnippet[];
  builtins: readonly BuiltinSpec[];
}

/** Anchor for a package section, for example pkg-shortcircuit-gates. */
export function packageAnchor(name: string): string {
  return `pkg-${name
    .replace(/^@/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
}

/** Anchor for a function card. Kept in sync with the existing fn-<name> ids. */
export function functionAnchor(name: string): string {
  return `fn-${name.toLowerCase()}`;
}

export function termAnchor(term: string): string {
  return `term-${term
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
}

export function snippetAnchor(id: string): string {
  return `snippet-${id}`;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Build the flat search index used by the documentation search bar. */
export function buildDocsSearchIndex(sources: DocsSearchSources): DocsSearchEntry[] {
  const entries: DocsSearchEntry[] = [];
  const packageIds = new Set(sources.packages.map((manifest) => packageAnchor(manifest.name)));

  for (const section of sources.sections) {
    // Package sections get a richer entry below.
    if (packageIds.has(section.id)) continue;
    entries.push({
      id: section.id,
      title: section.label,
      subtitle: `Documentation section in ${section.group}`,
      kind: "section",
      group: section.group,
      keywords: [...(section.keywords ?? []), section.group, "documentation", "docs"],
    });
  }

  for (const manifest of sources.packages) {
    const exports = manifest.exports.filter(
      (entry) => entry.kind !== "macro" || !entry.internal,
    );
    entries.push({
      id: packageAnchor(manifest.name),
      title: manifest.name,
      subtitle: manifest.description ?? `${exports.length} package functions`,
      kind: "package",
      group: "Packages",
      keywords: [
        manifest.version,
        "package",
        "import",
        ...Object.keys(manifest.dependencies ?? {}),
      ],
    });
  }

  for (const macro of sources.macros) {
    if (macro.internal) continue;
    entries.push({
      id: functionAnchor(macro.name),
      title: macro.name,
      subtitle: `${macro.signature} ${macro.summary ?? ""}`.trim(),
      kind: "macro",
      group: macro.packageName,
      keywords: [
        macro.group ?? "",
        macro.packageName,
        "macro",
        "function",
        ...macro.args,
        ...(macro.examples ?? []),
      ],
    });
  }

  for (const { packageName, circuit } of sources.circuits) {
    const inputs = circuit.ports?.inputs.map((port) => port.name) ?? [];
    const outputs = circuit.ports?.outputs.map((port) => port.name) ?? [];
    entries.push({
      id: functionAnchor(circuit.name),
      title: circuit.name,
      subtitle: `${circuit.name}(${inputs.join(", ")}) ${circuit.summary ?? ""}`.trim(),
      kind: "circuit",
      group: packageName,
      keywords: [
        circuit.group ?? "",
        packageName,
        "circuit",
        "component",
        ...inputs,
        ...outputs,
      ],
    });
  }

  for (const spec of sources.builtins) {
    entries.push({
      id: functionAnchor(spec.name),
      title: spec.name,
      subtitle: `${spec.signature} ${spec.description}`,
      kind: "built-in",
      group: spec.category === "gate" ? "Gate" : "Bus",
      keywords: [
        spec.category,
        spec.widthRule,
        spec.tip,
        spec.example.call,
        ...spec.args.map((arg) => arg.name),
      ],
    });
  }

  for (const entry of sources.glossary) {
    entries.push({
      id: termAnchor(entry.term),
      title: entry.term,
      subtitle: entry.short,
      kind: "glossary",
      group: entry.group,
      keywords: [entry.long],
    });
  }

  for (const snippet of sources.snippets) {
    entries.push({
      id: snippetAnchor(snippet.id),
      title: snippet.title,
      subtitle: snippet.description,
      kind: "snippet",
      group: snippet.category,
      keywords: [snippet.category, "snippet", "template"],
    });
  }

  return entries;
}

const KIND_WEIGHT: Record<DocsSearchKind, number> = {
  section: 5,
  "built-in": 7,
  macro: 7,
  circuit: 7,
  package: 6,
  glossary: 4,
  snippet: 3,
};

function scoreEntry(
  entry: DocsSearchEntry,
  query: string,
  tokens: string[],
): number {
  const title = normalize(entry.title);
  const subtitle = normalize(entry.subtitle ?? "");
  const keywords = normalize((entry.keywords ?? []).join(" "));
  const group = normalize(entry.group ?? "");
  const haystack = `${title} ${subtitle} ${keywords} ${group} ${entry.kind}`;

  if (!tokens.every((token) => haystack.includes(token))) return -1;

  let score = 0;
  if (title === query) score += 160;
  else if (title.startsWith(query)) score += 100;
  else if (title.includes(query)) score += 70;

  if (tokens.every((token) => title.includes(token))) score += 40;

  for (const token of tokens) {
    if (title.startsWith(token)) score += 24;
    else if (title.includes(token)) score += 12;
  }

  if (subtitle.includes(query)) score += 12;
  if (keywords.includes(query)) score += 8;
  score += KIND_WEIGHT[entry.kind];

  return score;
}

/** Rank documentation entries for a query. Empty queries return no results. */
export function searchDocs(
  entries: readonly DocsSearchEntry[],
  rawQuery: string,
  limit = 24,
): DocsSearchEntry[] {
  const query = normalize(rawQuery);
  if (!query) return [];
  const tokens = query.split(" ").filter(Boolean);

  return entries
    .map((entry) => ({ entry, score: scoreEntry(entry, query, tokens) }))
    .filter((result) => result.score >= 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.entry.title.localeCompare(b.entry.title) ||
        a.entry.kind.localeCompare(b.entry.kind),
    )
    .slice(0, limit)
    .map((result) => result.entry);
}
