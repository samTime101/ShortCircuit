import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BUILTINS,
  DEFAULT_PACKAGE_CATALOG,
  DEFAULT_PACKAGE_CIRCUITS,
  DEFAULT_PACKAGE_MACROS,
  GLOSSARY,
  LANGUAGE_SNIPPETS,
  LANGUAGE_VERSION,
  IR_SCHEMA,
  packageWorkedExamples,
  type PackageExport,
  type PackageManifest,
  type WorkedExample,
} from "@shortcircuit/engine";
import { ArrowUpRight, Check, Code, Copy, Layers } from "../components/Icons";
import { highlightLogicFlow } from "../editor/logicFlowHighlight";
import { DocsSearch } from "./DocsSearch";
import {
  buildDocsSearchIndex,
  functionAnchor,
  packageAnchor,
  snippetAnchor,
  termAnchor,
} from "./docsSearch";
import "./docs.css";

interface DocsPageProps {
  onBack(): void;
  /** Beginner mode hides the advanced sections. */
  beginner?: boolean;
}

interface SectionDef {
  id: string;
  label: string;
  group: string;
  keywords?: string[];
}

/** The worked example of every package export, taken from the package tests. */
const WORKED_EXAMPLES = packageWorkedExamples();

const PACKAGES = DEFAULT_PACKAGE_CATALOG.packages;
const MACROS_BY_NAME = new Map(
  DEFAULT_PACKAGE_MACROS.map((macro) => [macro.name.toUpperCase(), macro]),
);

function workedExampleFor(packageName: string, exportName: string): WorkedExample | undefined {
  return WORKED_EXAMPLES.get(`${packageName}:${exportName}`);
}

const SECTIONS: SectionDef[] = [
  {
    id: "overview",
    label: "Overview",
    group: "Getting started",
    keywords: ["introduction", "start", "what is logicflow"],
  },
  {
    id: "syntax",
    label: "Syntax",
    group: "Language",
    keywords: [
      "program",
      "structure",
      "circuit",
      "comments",
      "identifiers",
      "keywords",
      "lexical",
      "quick start",
      "end",
    ],
  },
  {
    id: "values",
    label: "Values and buses",
    group: "Language",
    keywords: ["literals", "decimal", "binary", "hex", "bus", "slice", "concat", "width"],
  },
  {
    id: "signals",
    label: "Signals and state",
    group: "Language",
    keywords: ["input", "output", "state", "assignment", "duplicate", "feedback"],
  },
  {
    id: "composition",
    label: "Composition",
    group: "Language",
    keywords: ["instance", "ports", "named arguments", "recursion", "nested"],
  },
  {
    id: "clocking",
    label: "State and clocks",
    group: "Language",
    keywords: ["edge", "rising", "falling", "register", "clock", "state update"],
  },
  {
    id: "testing",
    label: "Tests and truth tables",
    group: "Verification",
    keywords: ["test", "case", "expect", "step", "cycle", "load", "truth table"],
  },
  {
    id: "operations",
    label: "Built-in operations",
    group: "Built-in functions",
    keywords: ["gates", "bus", "kernel", "nand", "catalog"],
  },
  {
    id: "reference",
    label: "Built-in reference",
    group: "Built-in functions",
    keywords: ["signature", "arguments", "width", "function", "built in"],
  },
  {
    id: "widths",
    label: "Width policy",
    group: "Built-in functions",
    keywords: ["truncation", "extension", "mismatch", "zero extend", "sign extend"],
  },
  {
    id: "packages",
    label: "Imports and packages",
    group: "Packages",
    keywords: ["import", "alias", "dependency", "module", "library"],
  },
  ...PACKAGES.map((manifest) => ({
    id: packageAnchor(manifest.name),
    label: manifest.name,
    group: "Packages",
    keywords: [
      manifest.name.replace("@shortcircuit/", ""),
      manifest.description ?? "",
      ...Object.keys(manifest.dependencies ?? {}),
    ],
  })),
  {
    id: "diagnostics",
    label: "Diagnostics",
    group: "Reference",
    keywords: ["error", "warning", "code", "suggestion", "e301"],
  },
  {
    id: "limits",
    label: "Limits",
    group: "Reference",
    keywords: ["maximum", "nodes", "width", "depth", "instances"],
  },
  {
    id: "glossary",
    label: "Glossary",
    group: "Reference",
    keywords: ["terms", "definitions", "plain language"],
  },
  {
    id: "snippets",
    label: "Snippet library",
    group: "Reference",
    keywords: ["templates", "examples", "editor"],
  },
  {
    id: "displays",
    label: "Output displays",
    group: "Reference",
    keywords: ["leds", "seven segment", "bar", "grid", "number"],
  },
  {
    id: "editor",
    label: "Editor tips",
    group: "Reference",
    keywords: ["completions", "hover", "shortcuts", "keyboard"],
  },
  {
    id: "ir",
    label: "Portable IR",
    group: "Reference",
    keywords: ["json", "schema", "export", "graph"],
  },
];

/** Number the numbered sections in reading order. The hero is not numbered. */
const SECTION_INDEX = new Map(
  SECTIONS.filter((section) => section.id !== "overview").map((section, index) => [
    section.id,
    String(index + 1).padStart(2, "0"),
  ]),
);

const CATEGORY_LABEL: Record<string, string> = {
  gate: "gate",
  bus: "bus",
};

function useActiveSection(
  scroller: React.RefObject<HTMLElement | null>,
  sections: readonly SectionDef[],
): string {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const update = () => {
      const marker = 150;
      let current = sections[0]?.id ?? "";
      for (const section of sections) {
        const target = element.querySelector(`#${section.id}`);
        if (!target) continue;
        const top = target.getBoundingClientRect().top - element.getBoundingClientRect().top;
        if (top <= marker) current = section.id;
      }
      setActive(current);
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      element.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [scroller, sections]);
  return active;
}

function CodeBlock({ code, caption }: { code: string; caption?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const tokens = highlightLogicFlow(code);
  return (
    <figure className="docs-code">
      <pre>
        <code>
          {tokens.map((token, index) => (
            <span key={index} className={`tok-${token.kind}`}>
              {token.text}
            </span>
          ))}
        </code>
      </pre>
      <figcaption>
        <span>{caption ?? "LogicFlow"}</span>
        <button type="button" className="docs-copy" onClick={copy}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </figcaption>
    </figure>
  );
}

function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  const index = SECTION_INDEX.get(id) ?? "";
  return (
    <section id={id} className="docs-section">
      <header className="docs-section-head">
        <span className="eyebrow">
          {index} · {eyebrow}
        </span>
        <h2>{title}</h2>
        {lead ? <p className="docs-lead">{lead}</p> : null}
      </header>
      {children}
    </section>
  );
}

function Note({ kind = "info", children }: { kind?: "info" | "warn"; children: ReactNode }) {
  return <div className={`docs-note is-${kind}`}>{children}</div>;
}

function widthLabel(width: number): string {
  return width === 1 ? "1 bit" : `BUS(${width})`;
}

function inlineText(text: string): ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <span key={index}>{part}</span>;
  });
}

function isNotesBlockStart(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith("#") ||
    trimmed.startsWith("|") ||
    trimmed.startsWith("```") ||
    /^[-*]\s+/.test(trimmed)
  );
}

/** Render the small Markdown subset used by package docs files. */
function DocsNotes({ markdown }: { markdown: string }) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  let key = 0;

  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("# ")) {
      // The function card already shows the export name.
      index += 1;
      continue;
    }

    if (line.startsWith("## ") || line.startsWith("### ")) {
      const level = line.startsWith("### ") ? 6 : 5;
      const title = line.slice(level === 6 ? 4 : 3).trim();
      blocks.push(
        level === 6 ? (
          <h6 key={key++}>{inlineText(title)}</h6>
        ) : (
          <h5 key={key++}>{inlineText(title)}</h5>
        ),
      );
      index += 1;
      continue;
    }

    if (line.trimStart().startsWith("```")) {
      const caption = line.trim().slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.trimStart().startsWith("```")) {
        code.push(lines[index]!);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(<CodeBlock key={key++} code={code.join("\n")} caption={caption || undefined} />);
      continue;
    }

    if (line.trimStart().startsWith("|")) {
      const rows: string[][] = [];
      while (index < lines.length && lines[index]!.trimStart().startsWith("|")) {
        rows.push(
          lines[index]!
            .trim()
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map((cell) => cell.trim()),
        );
        index += 1;
      }
      const header = rows[0] ?? [];
      const body = rows.slice(2);
      blocks.push(
        <table className="docs-table docs-notes-table" key={key++}>
          <thead>
            <tr>
              {header.map((cell, cellIndex) => (
                <th key={cellIndex}>{inlineText(cell)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{inlineText(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index]!)) {
        items.push(lines[index]!.replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ul className="docs-list" key={key++}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{inlineText(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index]!.trim() && !isNotesBlockStart(lines[index]!)) {
      paragraph.push(lines[index]!.trim());
      index += 1;
    }
    if (paragraph.length === 0) {
      paragraph.push(line.trim());
      index += 1;
    }
    blocks.push(<p key={key++}>{inlineText(paragraph.join(" "))}</p>);
  }

  return <div className="docs-notes">{blocks}</div>;
}

function publicPackageExports(manifest: PackageManifest): PackageExport[] {
  return manifest.exports.filter((entry) => entry.kind !== "macro" || !entry.internal);
}

function groupPackageExports(
  entries: PackageExport[],
): { title: string; entries: PackageExport[] }[] {
  const groups = new Map<string, PackageExport[]>();
  for (const entry of entries) {
    const title = entry.group ?? (entry.kind === "macro" ? "Macros" : "Circuits");
    const list = groups.get(title) ?? [];
    list.push(entry);
    groups.set(title, list);
  }
  return [...groups.entries()].map(([title, list]) => ({ title, entries: list }));
}

function PackageExportArticle({
  entry,
  packageName,
}: {
  entry: PackageExport;
  packageName: string;
}) {
  if (entry.kind === "macro") {
    const macro = MACROS_BY_NAME.get(entry.name.toUpperCase());
    const example = workedExampleFor(packageName, entry.name);
    const args = macro?.args ?? [];
    return (
      <article className="docs-fn docs-package-fn" id={functionAnchor(entry.name)}>
        <header>
          <h4>
            <code>{macro?.signature ?? `${entry.name}(...)`}</code>
            <span className="docs-fn-category">macro</span>
          </h4>
          <p>{entry.summary}</p>
        </header>
        <div className="docs-fn-body">
          <dl className="docs-fn-args">
            {args.map((name) => (
              <div key={name}>
                <dt>
                  <code>{name}</code>
                </dt>
                <dd>Input.</dd>
              </div>
            ))}
            {macro?.variadic ? (
              <div>
                <dt>
                  <code>...</code>
                </dt>
                <dd>Further inputs, folded by the macro.</dd>
              </div>
            ) : null}
          </dl>
          <div className="docs-fn-meta">
            <span>
              <strong>Result width</strong>
              {entry.widthRule ?? "Follows compiler width rules."}
            </span>
            <span>
              <strong>Expands to</strong>
              <code>{macro?.body ?? `FOLD ${macro?.fold ?? "helper"}`}</code>
            </span>
            <span>
              <strong>Package</strong>
              {packageName}
            </span>
            {example ? (
              <span>
                <strong>Example</strong>
                <code>{`y = ${example.call}`}</code>
                <span className="docs-fn-expected">
                  {example.value === undefined
                    ? example.ports.map((port) => `${port.name} = ${port.value}`).join(", ")
                    : example.value}
                </span>
              </span>
            ) : entry.examples?.[0] ? (
              <span>
                <strong>Example</strong>
                <code>{entry.examples[0]}</code>
              </span>
            ) : null}
          </div>
        </div>
        {entry.docsText ? <DocsNotes markdown={entry.docsText} /> : null}
      </article>
    );
  }

  const inputs = entry.ports?.inputs ?? [];
  const outputs = entry.ports?.outputs ?? [];
  const example = workedExampleFor(packageName, entry.name);
  return (
    <article className="docs-fn docs-package-fn" id={functionAnchor(entry.name)}>
      <header>
        <h4>
          <code>
            {entry.name}({inputs.map((port) => port.name).join(", ")})
          </code>
          <span className="docs-fn-category">circuit</span>
        </h4>
        <p>{entry.summary}</p>
      </header>
      <div className="docs-fn-body">
        <dl className="docs-fn-args docs-port-args">
          {inputs.map((port) => (
            <div key={`in-${port.name}`}>
              <dt>
                <code>{port.name}</code>
                <span className="docs-port-width">{widthLabel(port.width)}</span>
              </dt>
              <dd>Input port.</dd>
            </div>
          ))}
          {outputs.map((port) => (
            <div key={`out-${port.name}`}>
              <dt>
                <code>{port.name}</code>
                <span className="docs-port-width">{widthLabel(port.width)}</span>
              </dt>
              <dd>Output port.</dd>
            </div>
          ))}
        </dl>
        <div className="docs-fn-meta">
          <span>
            <strong>Package</strong>
            {packageName}
          </span>
          <span>
            <strong>Ports</strong>
            {inputs.length} in, {outputs.length} out
          </span>
          {example ? (
            <span>
              <strong>Example</strong>
              <code>{`inst = ${example.call}`}</code>
              <span className="docs-fn-expected">
                {example.ports.map((port) => `inst.${port.name} = ${port.value}`).join(", ")}
              </span>
            </span>
          ) : null}
        </div>
      </div>
      {entry.docsText ? <DocsNotes markdown={entry.docsText} /> : null}
    </article>
  );
}

function PackageSection({ manifest }: { manifest: PackageManifest }) {
  const entries = publicPackageExports(manifest);
  const groups = groupPackageExports(entries);
  const dependencies = Object.keys(manifest.dependencies ?? {});

  return (
    <Section
      id={packageAnchor(manifest.name)}
      eyebrow="Packages"
      title={manifest.name}
      lead={manifest.description}
    >
      <div className="docs-package-meta">
        <span className="docs-chip">v{manifest.version}</span>
        <span className="docs-chip">
          {entries.length} public {entries.length === 1 ? "function" : "functions"}
        </span>
        {dependencies.length > 0 ? (
          <span className="docs-package-deps">Depends on {dependencies.join(", ")}</span>
        ) : (
          <span className="docs-package-deps">No package dependencies</span>
        )}
      </div>

      <div className="docs-columns">
        <div>
          <h4>Import</h4>
          <CodeBlock caption={`${manifest.name} package`} code={`IMPORT "${manifest.name}"`} />
          <p>
            Add this line to the top of a source file to use the functions below without a
            qualifier. Add <code>AS alias</code> to keep them namespaced.
          </p>
        </div>
        <div>
          <h4>Functions in this package</h4>
          <div className="docs-package-functions">
            {groups.map((group) => (
              <div key={group.title}>
                <span className="docs-package-group-title">{group.title}</span>
                <div className="docs-fn-index">
                  {group.entries.map((entry) => (
                    <a key={entry.name} href={`#${functionAnchor(entry.name)}`}>
                      {entry.name}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {groups.map((group) => (
        <div className="docs-package-group" key={group.title}>
          <h4>
            <Layers size={14} />
            {group.title}
          </h4>
          {group.entries.map((entry) => (
            <PackageExportArticle key={entry.name} entry={entry} packageName={manifest.name} />
          ))}
        </div>
      ))}
    </Section>
  );
}

export function DocsPage({ onBack, beginner }: DocsPageProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const active = useActiveSection(pageRef, SECTIONS);
  const packageGroups = useMemo(() => {
    const map = new Map<string, string[]>();
    const add = (group: string, name: string) => {
      const items = map.get(group) ?? [];
      if (!items.includes(name)) items.push(name);
      map.set(group, items);
    };
    for (const macro of DEFAULT_PACKAGE_MACROS) {
      add(macro.group ?? "Package Macros", macro.name);
    }
    for (const { circuit } of DEFAULT_PACKAGE_CIRCUITS) {
      add(circuit.group ?? "Package Circuits", circuit.name);
    }
    // NAND is the one core gate that stays in the kernel.
    add("Universal Logic Gates", "NAND");
    return [...map.entries()].map(([title, items]) => ({ title, items }));
  }, []);
  const groups = useMemo(() => {
    const map = new Map<string, SectionDef[]>();
    for (const section of SECTIONS) {
      const list = map.get(section.group) ?? [];
      list.push(section);
      map.set(section.group, list);
    }
    return [...map.entries()];
  }, []);
  const searchEntries = useMemo(
    () =>
      buildDocsSearchIndex({
        sections: SECTIONS,
        packages: PACKAGES,
        macros: DEFAULT_PACKAGE_MACROS,
        circuits: DEFAULT_PACKAGE_CIRCUITS,
        glossary: GLOSSARY,
        snippets: LANGUAGE_SNIPPETS,
        builtins: BUILTINS,
      }),
    [],
  );

  const jump = (id: string) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.scrollIntoView?.({ behavior: "smooth", block: "start" });
    element.classList.add("docs-target");
    window.setTimeout(() => element.classList.remove("docs-target"), 1400);
  };

  return (
    <main className="docs-page" ref={pageRef}>
      <header className="docs-topbar">
        <div className="docs-brand">
          <span className="docs-brand-mark">
            <Code size={16} />
          </span>
          <div>
            <strong>SHORT CIRCUIT</strong>
            <span>LogicFlow documentation</span>
          </div>
        </div>
        <DocsSearch entries={searchEntries} onJump={jump} />
        <div className="docs-topbar-actions">
          <span className="docs-meta">{LANGUAGE_VERSION}</span>
          <span className="docs-meta">{IR_SCHEMA}</span>
          <button type="button" className="docs-back" onClick={onBack}>
            Back to studio
            <ArrowUpRight size={14} />
          </button>
        </div>
      </header>

      <div className="docs-layout">
        <aside className="docs-sidebar">
          <nav aria-label="Documentation sections">
            {groups.map(([group, items]) => (
              <div className="docs-nav-group" key={group}>
                <span className="docs-nav-title">{group}</span>
                {items.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={active === item.id ? "is-active" : undefined}
                    onClick={() => jump(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        <main className="docs-content">
          <section id="overview" className="docs-hero">
            <h1>LogicFlow, in full</h1>
            <p>
              LogicFlow is a small declarative language for digital logic. Assignments name wires in a
              dependency graph, not steps in a program. This page is the complete reference for the
              language, the built-in library, and the studio around it.
            </p>
            <div className="docs-newcomer">
              <strong>New to digital logic?</strong>
              <p>
                The glossary explains every word the language uses, from a bus to a clock edge, in
                plain language. It is a good place to start.
              </p>
              <button
                type="button"
                className="docs-back"
                onClick={() => {
                  document.getElementById("glossary")?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                Open the glossary
                <ArrowUpRight size={14} />
              </button>
            </div>

            <div className="docs-hero-grid">
              <div>
                <span className="eyebrow">Design rules</span>
                <ul>
                  <li>Function-style gates, named signals, no semicolons or braces.</li>
                  <li>Signal names are case-sensitive; built-ins are case-insensitive.</li>
                  <li>Static validation before anything simulates.</li>
                  <li>No silent truncation: widths are documented and checked.</li>
                </ul>
              </div>
              <div>
                <span className="eyebrow">Where to go next</span>
                <ul>
                  <li>
                    Press <kbd>/</kbd> anywhere to search sections, functions, and packages.
                  </li>
                  <li>Read the syntax section, then the width policy.</li>
                  <li>Hover any built-in in the editor for its signature and tip.</li>
                  <li>Copy a snippet from the library and paste it into the editor.</li>
                </ul>
              </div>
            </div>
          </section>

          <Section
            id="syntax"
            eyebrow="Language"
            title="Syntax"
            lead="LogicFlow is line oriented. One declaration or assignment per line, blocks closed with END."
          >
            <div className="docs-columns">
              <div>
                <h4>Program structure</h4>
                <CodeBlock
                  code={`program      := import* (circuit | test)*

import       := "IMPORT" string ("AS" name)? NEWLINE

circuit      := "CIRCUIT" name NEWLINE
                circuitItem* "END" NEWLINE
circuitItem  := inputDecl | outputDecl | stateDecl
              | assignment | onBlock

inputDecl    := "INPUT" name (":" width)? NEWLINE
outputDecl   := "OUTPUT" path NEWLINE
stateDecl    := "STATE" name (":" width)? ("=" literal)? NEWLINE
assignment   := name "=" expression NEWLINE

width        := number | "BUS" "(" number ")"`}
                />
              </div>
              <div>
                <h4>Lexical rules</h4>
                <ul className="docs-list">
                  <li>
                    <strong>Identifiers</strong> start with a letter or underscore and continue with
                    letters, digits, or underscores.
                  </li>
                  <li>
                    <strong>Comments</strong> start with <code>//</code> and run to the end of the
                    line, or open with <code>/*</code> and close with <code>*/</code> and may span
                    as many lines as you like.
                  </li>
                  <li>
                    <strong>Keywords and built-ins</strong> are case-insensitive: <code>input</code> and{" "}
                    <code>INPUT</code> are the same.
                  </li>
                  <li>
                    <strong>Signal and circuit names</strong> are case-sensitive: <code>sum</code> and{" "}
                    <code>Sum</code> are different signals.
                  </li>
                  <li>
                    <strong>Reserved words</strong> cannot be used as names: CIRCUIT, END, INPUT,
                    OUTPUT, STATE, ON, RISING_EDGE, FALLING_EDGE, TEST, CASE, EXPECT, LOAD, STEP,
                    CYCLE, IMPORT, AS, BUS, plus every built-in name. <code>CONST</code>,{" "}
                    <code>FOR</code>, and <code>IF</code> are rejected with a migration hint.
                  </li>
                </ul>
              </div>
            </div>
            <div className="docs-columns">
              <div>
                <h4>Comments</h4>
                <CodeBlock
                  code={`// a comment on its own line
INPUT a          // or after a statement

/* a block comment
   may span
   several lines */
OUTPUT a`}
                />
              </div>
              <div>
                <h4>Things to know</h4>
                <ul className="docs-list">
                  <li>
                    A <code>//</code> comment runs to the end of the line. A <code>/*</code> comment
                    runs until the matching <code>*/</code>.
                  </li>
                  <li>
                    A <code>//</code> inside a quoted string is just a character, and so is a{" "}
                    <code>/*</code> that never opens a comment.
                  </li>
                  <li>
                    Block comments do not nest: the first <code>*/</code> closes them.
                  </li>
                  <li>
                    <code>#</code> is not a comment marker; the compiler suggests{" "}
                    <code>//</code> when it sees one.
                  </li>
                </ul>
              </div>
            </div>

            <h4>A complete program</h4>
            <p>
              One circuit, two gates, and four exhaustive tests. Everything else in the language
              builds on this shape.
            </p>
            <CodeBlock
              caption="half-adder.lf"
              code={`IMPORT "@shortcircuit/gates"

CIRCUIT HalfAdder

INPUT a
INPUT b

sum = XOR(a, b)
carry = AND(a, b)

OUTPUT sum
OUTPUT carry

END

TEST HalfAdder

CASE "1 + 1"
  INPUT a = 1
  INPUT b = 1
  EXPECT sum = 0
  EXPECT carry = 1
END

END`}
            />
            <div className="docs-columns">
              <div>
                <h4>How the studio reads it</h4>
                <p>
                  The compiler resolves names and widths, then flattens the design into a portable
                  graph. Simulation, the evaluation graph, the truth table, the tests, and the JSON
                  export all read that same graph.
                </p>
              </div>
              <div>
                <h4>What to try</h4>
                <p>
                  Type <code>XOR</code> in the editor and pick the completion, hover the call to
                  read its width rule, then flip the input bits in the simulation dock.
                </p>
              </div>
            </div>
          </Section>

          <Section
            id="values"
            eyebrow="Language"
            title="Values and buses"
            lead="Literals, buses, bit selection, and the ways one value becomes another."
          >
            <h4>Literals</h4>
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Form</th>
                  <th>Example</th>
                  <th>Width</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Decimal</td>
                  <td>
                    <code>0</code>, <code>1</code>, <code>42</code>
                  </td>
                  <td>bits needed</td>
                  <td>Underscores are allowed: <code>1_000</code>.</td>
                </tr>
                <tr>
                  <td>Prefixed binary</td>
                  <td>
                    <code>0b1010</code>
                  </td>
                  <td>4</td>
                  <td>Width follows the number of digits.</td>
                </tr>
                <tr>
                  <td>Prefixed hex</td>
                  <td>
                    <code>0xF</code>, <code>0x0F</code>
                  </td>
                  <td>4, 8</td>
                  <td>Four bits per digit, leading zeroes preserved.</td>
                </tr>
                <tr>
                  <td>Binary string</td>
                  <td>
                    <code>00000011</code>
                  </td>
                  <td>8</td>
                  <td>More than one digit, only 0 and 1, starts with 0. Plain <code>10</code> is decimal ten.</td>
                </tr>
              </tbody>
            </table>

            <div className="docs-columns">
              <div>
                <h4>Buses and slices</h4>
                <CodeBlock
                  code={`INPUT data : BUS(8)

upper   = data[7:4]     // inclusive slice, 4 bits
low_bit = data[0]       // single bit
word    = CONCAT(upper, low_bit)`}
                />
                <p>
                  Bit 0 is the least significant bit. Slices need constant decimal indexes, and
                  <code> data[7:4] </code> is the same as <code>SLICE(data, 7, 4)</code>.
                </p>
              </div>
              <div>
                <h4>Expressions</h4>
                <ul className="docs-list">
                  <li>
                    <strong>References</strong> name a signal, or an instance output such as{" "}
                    <code>adder.sum</code>.
                  </li>
                  <li>
                    <strong>Calls</strong> are the only way to compute: <code>AND(a, b)</code>.
                  </li>
                  <li>
                    <strong>Parentheses</strong> group an expression. There are no infix operators.
                  </li>
                  <li>
                    <strong>Order does not matter.</strong> A signal may be used before it is defined.
                  </li>
                </ul>
              </div>
            </div>
          </Section>

          <Section
            id="signals"
            eyebrow="Language"
            title="Signals and state"
            lead="Every signal has exactly one definition: an input, a stored state, or an assignment."
          >
            <div className="docs-columns">
              <div>
                <h4>Inputs and outputs</h4>
                <CodeBlock
                  code={`INPUT enable        // one bit
INPUT data : BUS(8)  // eight bits

OUTPUT sum          // a signal
OUTPUT result.zero  // an instance port`}
                />
              </div>
              <div>
                <h4>State</h4>
                <CodeBlock
                  code={`STATE count : BUS(4) = 0000
STATE armed = 1`}
                />
                <p>
                  State needs a width, an initial value, or both. It changes only inside a clocked
                  block.
                </p>
              </div>
            </div>
            <Note>
              <strong>One definition per signal.</strong> Declaring the same name twice, or feeding a
              combinational signal back into itself, is a compile error with a suggestion — never a
              silent overwrite.
            </Note>
          </Section>

          <Section
            id="composition"
            eyebrow="Language"
            title="Composition"
            lead="Circuits are reusable. Instances are named, their outputs are read with dotted paths, and the design is flattened into one graph."
          >
            <CodeBlock
              caption="half adder + full adder"
              code={`IMPORT "@shortcircuit/gates"

CIRCUIT HalfAdder
  INPUT a
  INPUT b

  sum = XOR(a, b)
  carry = AND(a, b)

  OUTPUT sum
  OUTPUT carry
END

CIRCUIT FullAdder
  INPUT a
  INPUT b
  INPUT carry_in

  first  = HalfAdder(a, b)
  second = HalfAdder(first.sum, carry_in)

  sum = second.sum
  carry_out = OR(first.carry, second.carry)

  OUTPUT sum
  OUTPUT carry_out
END`}
            />
            <div className="docs-columns">
              <div>
                <h4>Binding arguments</h4>
                <ul className="docs-list">
                  <li>
                    <strong>Positional</strong>: <code>HalfAdder(a, b)</code> follows the input
                    declaration order.
                  </li>
                  <li>
                    <strong>Named</strong>: <code>HalfAdder(b = y, a = x)</code>, any order, every
                    input covered.
                  </li>
                  <li>Never mix the two styles in one call.</li>
                </ul>
              </div>
              <div>
                <h4>Rules</h4>
                <ul className="docs-list">
                  <li>Recursion is rejected; use state for feedback.</li>
                  <li>Instance ports are read as <code>instance.port</code>.</li>
                  <li>Nesting is capped at 32 levels, instances at 500 per circuit.</li>
                </ul>
              </div>
            </div>
          </Section>

          <Section
            id="clocking"
            eyebrow="Language"
            title="State and clocks"
            lead="Sequential logic is explicit. An edge triggers a block, the block computes next-state values, and every update commits together."
          >
            <CodeBlock
              caption="register with enable"
              code={`IMPORT "@shortcircuit/selection"

CIRCUIT Register8
  INPUT data : BUS(8)
  INPUT clock
  INPUT enable

  STATE stored : BUS(8) = 0

  next = MUX(stored, data, enable)

  ON RISING_EDGE(clock):
    stored = next
  END

  OUTPUT stored
END`}
            />
            <ol className="docs-steps">
              <li>Inputs change, and the combinational graph is evaluated against the old state.</li>
              <li>
                The clock is compared with its previous value. A 0 → 1 change fires a rising edge, a
                1 → 0 change fires a falling edge.
              </li>
              <li>
                Next-state expressions are sampled against the pre-edge state, so no update can see
                another update from the same edge.
              </li>
              <li>All state updates commit at once, and the graph is evaluated again.</li>
            </ol>
            <Note>
              State only changes when an edge block assigns it. The register above feeds{" "}
              <code>stored</code> back through <code>MUX</code>, so <code>enable = 0</code> keeps
              the old value.
            </Note>
          </Section>

          <Section
            id="testing"
            eyebrow="Language"
            title="Tests and truth tables"
            lead="Verification lives in the source. The runner uses the same compiled graph the simulator does."
          >
            <div className="docs-columns">
              <div>
                <h4>Test blocks</h4>
                <CodeBlock
                  code={`TEST HalfAdder
  CASE "0 + 1"
    INPUT a = 0
    INPUT b = 1
    EXPECT sum = 1
    EXPECT carry = 0
  END
END`}
                />
                <ul className="docs-list">
                  <li>Every input must be set in every combinational case.</li>
                  <li>
                    Test values made only of 0 and 1 are binary: <code>10</code> is two.
                  </li>
                  <li>Expectations compare the whole binary value, leading zeroes included.</li>
                  <li>
                    A case can also check a <code>STATE</code> signal, such as{" "}
                    <code>EXPECT count = 0011</code>.
                  </li>
                </ul>
              </div>
              <div>
                <h4>Clocked cases</h4>
            <CodeBlock
              code={`TEST Counter4
  CASE "counts three ticks"
    INPUT reset = 0
    INPUT clock = 0
    EXPECT count = 0000
    CYCLE clock 3
    EXPECT count = 0011
  END
END`}
            />
            <ul className="docs-list">
              <li>
                <strong>STEP</strong> groups input changes into one simulation step, so they
                apply together before edges fire.
              </li>
              <li>
                <strong>CYCLE clock N</strong> pulses a clock 0 → 1 → 0, N times.
              </li>
              <li>
                <strong>LOAD state = value</strong> forces a state to a starting value.
              </li>
              <li>
                A failing expectation reports the case, the step, the signal, and both
                values.
              </li>
            </ul>

            <h4>Truth tables</h4>
                <p>
                  The studio enumerates every input combination of a combinational circuit, bit by
                  bit for buses, and evaluates the outputs on the compiled graph.
                </p>
                <ul className="docs-list">
                  <li>Rows follow the binary count of the inputs in declaration order.</li>
                  <li>Circuits with clocks or stored state have no exhaustive table.</li>
                  <li>Enumeration is capped, and the cap is stated instead of truncated silently.</li>
                </ul>
              </div>
            </div>
          </Section>

          <Section
            id="operations"
            eyebrow="Built-in functions"
            title="Built-in operations"
            lead="Core operations are compiled directly by the engine. They are always available and need no IMPORT."
          >
            <p>
              Built-ins fall into two groups: gate operations that work bit by bit, and bus
              operations that reshape or inspect values. Every call becomes a node in the compiled
              graph, and the same operations appear in editor completions and hover cards.
            </p>
            {(["gate", "bus"] as const).map((category) => (
              <div className="docs-op-group" key={category}>
                <h4>
                  {category === "gate" ? <Layers size={14} /> : null}
                  {CATEGORY_LABEL[category]}
                </h4>
                <table className="docs-table">
                  <thead>
                    <tr>
                      <th>Call</th>
                      <th>Result width</th>
                      <th>What it does</th>
                    </tr>
                  </thead>
                  <tbody>
                    {BUILTINS.filter((spec) => spec.category === category).map((spec) => (
                      <tr key={spec.name}>
                        <td>
                          <a href={`#${functionAnchor(spec.name)}`} className="docs-fn-link">
                            <code>{spec.signature}</code>
                          </a>
                          <span className="docs-op-tip">{spec.tip}</span>
                        </td>
                        <td>{spec.widthRule}</td>
                        <td>{spec.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            <Note>
              <strong>Package functions are separate.</strong> Gates such as <code>AND</code>,{" "}
              <code>XOR</code>, and <code>MUX</code> live in packages and need an{" "}
              <code>IMPORT</code>. Open the Packages section for the full catalog.
            </Note>
          </Section>

          <Section
            id="reference"
            eyebrow="Built-in functions"
            title="Built-in function reference"
            lead="Every built-in operation, with its arguments, the width it produces, and a call example."
          >
            <div className="docs-fn-index">
              {BUILTINS.map((spec) => (
                <a key={spec.name} href={`#${functionAnchor(spec.name)}`}>
                  {spec.name}
                </a>
              ))}
            </div>

            {BUILTINS.map((spec) => (
              <article className="docs-fn" id={functionAnchor(spec.name)} key={spec.name}>
                <header>
                  <h4>
                    <code>{spec.signature}</code>
                    <span className="docs-fn-category">{spec.category}</span>
                  </h4>
                  <p>{spec.description}</p>
                </header>
                <div className="docs-fn-body">
                  <dl className="docs-fn-args">
                    {spec.args.map((arg) => (
                      <div key={arg.name}>
                        <dt>
                          <code>{arg.name}</code>
                        </dt>
                        <dd>
                          {arg.description}
                          {arg.optional ? " Optional." : ""}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div className="docs-fn-meta">
                    <span>
                      <strong>Result width</strong>
                      {spec.widthRule}
                    </span>
                    <span>
                      <strong>Tip</strong>
                      {spec.tip}
                    </span>
                    <span>
                      <strong>Example</strong>
                      <code>{spec.example.call}</code>
                      <span className="docs-fn-expected">
                        {spec.example.result}. {spec.example.note}
                      </span>
                    </span>
                  </div>
                </div>
              </article>
            ))}

            <Note>
              <strong>Looking for a package function?</strong> Each package has its own section
              with its macros and circuits, their arguments and ports, and worked examples.
            </Note>
          </Section>

          <Section
            id="widths"
            eyebrow="Language"
            title="Width policy"
            lead="Widths are checked before anything runs. Literals fit their context; signals never shrink silently."
          >
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Situation</th>
                  <th>Behaviour</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Two signals with different widths in one operation</td>
                  <td>Compile error (E301) listing both widths.</td>
                </tr>
                <tr>
                  <td>Literal wider than the context</td>
                  <td>Compile error (E305). Literals are fitted, never truncated.</td>
                </tr>
                <tr>
                  <td>NAND, package gates, package circuits</td>
                  <td>Package macros use the common input width. Package circuits declare fixed port widths.</td>
                </tr>
                <tr>
                  <td>SLICE, CONCAT, BROADCAST</td>
                  <td>Result width follows the bits involved, never more than the width limit.</td>
                </tr>
                <tr>
                  <td>ZEXT, SEXT, REPEAT, REVERSE</td>
                  <td>Extension and reshaping are explicit; there is no implicit widening or narrowing.</td>
                </tr>
              </tbody>
            </table>
            <Note>
              <strong>No word-level operators in the kernel.</strong> Addition, comparison, shifts,
              and selection are package circuits or structural wiring. Use <code>ADD4</code>,{" "}
              <code>ADD8</code>, or <code>MUX</code> instead of an implicit operator.
            </Note>
          </Section>

          <Section
            id="packages"
            eyebrow="Packages"
            title="Imports and packages"
            lead="Packages provide gates, reusable circuits, and fixed-width functions. A package is active only when the source imports it."
          >
            <div className="docs-columns">
              <div>
                <h4>Import what you use</h4>
                <CodeBlock
                  code={`IMPORT "@shortcircuit/selection"

CIRCUIT Blink
  INPUT a
  INPUT b
  INPUT pick

  chosen = MUX(a, b, pick)
  OUTPUT chosen
END`}
                />
                <ul className="docs-list">
                  <li>Only imported packages expose their macros and circuits to the source.</li>
                  <li>
                    Each package implements its circuits in real <code>.lf</code> source.
                  </li>
                  <li>
                    Package internals are compiled with your design but not exported as top-level
                    circuits.
                  </li>
                </ul>
              </div>
              <div>
                <h4>Import with an alias</h4>
                <CodeBlock
                  code={`IMPORT "@acme/display" AS display

CIRCUIT Panel
  INPUT value : BUS(4)

  segments = display.SEVEN_SEGMENT(value)

  OUTPUT segments.a
  OUTPUT segments.g
END`}
                />
                <ul className="docs-list">
                  <li>
                    <code>AS</code> adds qualified access: <code>display.SEVEN_SEGMENT</code>.
                  </li>
                  <li>An explicit import without an alias is available unqualified.</li>
                  <li>
                    Use the <strong>Packages</strong> button in the studio header to add or remove
                    the matching <code>IMPORT</code> line. The source remains the single source of
                    truth.
                  </li>
                  <li>Imports are resolved before analysis, so missing packages fail early.</li>
                </ul>
              </div>
            </div>

            <h4>Combine packages</h4>
            <div className="docs-columns">
              <div>
                <CodeBlock
                  code={`IMPORT "@shortcircuit/arithmetic"
IMPORT "@shortcircuit/selection"

CIRCUIT AddAndSelect
  INPUT a : BUS(8)
  INPUT b : BUS(8)
  INPUT choose_b

  added = ADD8(a, b, 0)
  result = MUX(a, added.sum, choose_b)

  OUTPUT result
  OUTPUT added.carry_out
END`}
                />
              </div>
              <div>
                <ul className="docs-list">
                  <li>
                    <code>ADD4</code> and <code>ADD8</code> expose <code>sum</code> and{" "}
                    <code>carry_out</code>; chain them for wider math.
                  </li>
                  <li>
                    <code>MUX(zero, one, select)</code> selects between equal-width values and
                    broadcasts the one-bit select.
                  </li>
                  <li>
                    <code>HALF_ADDER</code> and <code>FULL_ADDER</code> are reusable one-bit
                    building blocks.
                  </li>
                  <li>
                    There are no generic <code>+</code>, comparison, shift, decoder, or reduction
                    operators. Add a package circuit for the width you need.
                  </li>
                </ul>
              </div>
            </div>

            <h4>Bundled packages</h4>
            <div className="docs-package-cards">
              {PACKAGES.map((manifest) => {
                const entries = publicPackageExports(manifest);
                return (
                  <button
                    type="button"
                    className="docs-package-card"
                    key={manifest.name}
                    onClick={() => jump(packageAnchor(manifest.name))}
                  >
                    <strong>{manifest.name}</strong>
                    <span>{manifest.description}</span>
                    <small>
                      {entries.length} public {entries.length === 1 ? "function" : "functions"}
                    </small>
                  </button>
                );
              })}
            </div>

            <div className="docs-defaults">
              <span className="eyebrow">Function catalog</span>
              <p>
                Every public built-in and package function, grouped by library. Select a name to
                jump to its documentation.
              </p>
              <div className="docs-default-grid">
                {packageGroups.map((group) => (
                  <div className="docs-default-group" key={group.title}>
                    <h5>{group.title}</h5>
                    <ul className="docs-default-items">
                      {group.items.map((name) => (
                        <li key={name}>
                          <a href={`#${functionAnchor(name)}`}>{name}</a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </Section>

          {PACKAGES.map((manifest) => (
            <PackageSection key={manifest.name} manifest={manifest} />
          ))}

          <Section
            id="diagnostics"
            eyebrow="Reference"
            title="Diagnostics"
            lead="Every diagnostic carries a stable code, a location, and a fix. Names are matched with a bounded edit distance, so typos get a suggestion."
          >
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Family</th>
                  <th>Codes</th>
                  <th>Meaning</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Lexical</td>
                  <td>
                    <code>E001</code>, <code>E002</code>
                  </td>
                  <td>Unterminated string, unexpected character.</td>
                </tr>
                <tr>
                  <td>Syntax</td>
                  <td>
                    <code>E100</code>–<code>E123</code>
                  </td>
                  <td>Structure, blocks, widths, literals, and line-oriented statements.</td>
                </tr>
                <tr>
                  <td>Names and wiring</td>
                  <td>
                    <code>E200</code>–<code>E221</code>
                  </td>
                  <td>Reserved names, unknown signals and ports, duplicate definitions, slices, and instance arguments.</td>
                </tr>
                <tr>
                  <td>Widths and clocking</td>
                  <td>
                    <code>E301</code>–<code>E332</code>
                  </td>
                  <td>Incompatible widths, arity, feedback, clock conflicts, expansion limits, recursion, extension and slice bounds.</td>
                </tr>
                <tr>
                  <td>Packages</td>
                  <td>
                    <code>E601</code>–<code>E603</code>
                  </td>
                  <td>Invalid package source, missing or disabled imports, and duplicate aliases.</td>
                </tr>
                <tr>
                  <td>Warnings</td>
                  <td>
                    <code>W301</code>–<code>W402</code>
                  </td>
                  <td>Constant clock, empty clocked block, repeated state assignment, ambiguous bare literals.</td>
                </tr>
                <tr>
                  <td>Runtime</td>
                  <td>
                    <code>R400</code>–<code>R500</code>
                  </td>
                  <td>Bad input value, conflicting clock commit, unsupported operation, or an unevaluable graph.</td>
                </tr>
              </tbody>
            </table>
            <Note>
              A failed compile never produces a runnable graph. The studio clears the live values
              instead of showing a stale simulation.
            </Note>
          </Section>

          <Section
            id="limits"
            eyebrow="Reference"
            title="Limits"
            lead="Bounded work keeps the compiler and the studio responsive. Every limit is a compile option."
          >
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Limit</th>
                  <th>Default</th>
                  <th>Option</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Signal width</td>
                  <td>4096 bits</td>
                  <td>
                    <code>maxWidth</code>
                  </td>
                </tr>
                <tr>
                  <td>Graph nodes</td>
                  <td>20 000</td>
                  <td>
                    <code>maxNodes</code>
                  </td>
                </tr>
                <tr>
                  <td>Instance depth</td>
                  <td>32</td>
                  <td>
                    <code>maxDepth</code>
                  </td>
                </tr>
                <tr>
                  <td>Instances per circuit</td>
                  <td>500</td>
                  <td>
                    <code>maxInstances</code>
                  </td>
                </tr>
                <tr>
                  <td>Diagnostics kept</td>
                  <td>100</td>
                  <td>
                    <code>maxDiagnostics</code>
                  </td>
                </tr>
                <tr>
                  <td>Truth-table input bits</td>
                  <td>12</td>
                  <td>
                    <code>maxInputBits</code>
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>

          <Section
            id="glossary"
            eyebrow="Reference"
            title="Glossary"
            lead="The words this language uses, in plain language."
          >
            <div className="docs-glossary">
              {GLOSSARY.map((entry) => (
                <article key={entry.term} id={termAnchor(entry.term)}>
                  <header>
                    <h3>{entry.term}</h3>
                    <span className="docs-chip small">{entry.group}</span>
                  </header>
                  <p className="docs-glossary-short">{entry.short}</p>
                  <p className="docs-glossary-long">{entry.long}</p>
                </article>
              ))}
            </div>
          </Section>

          <Section
            id="snippets"
            eyebrow="Reference"
            title="Snippet library"
            lead="Every snippet is also available in the editor: type its name, or start typing a keyword, and pick it from the completion list."
          >
            <div className="docs-snippets">
              {LANGUAGE_SNIPPETS.map((snippet) => (
                <article className="docs-snippet" key={snippet.id} id={snippetAnchor(snippet.id)}>
                  <div>
                    <header>
                      <h4>{snippet.title}</h4>
                    </header>
                    <p>{snippet.description}</p>
                  </div>
                  <CodeBlock code={snippet.preview} />
                </article>
              ))}
            </div>
          </Section>

          <Section
            id="displays"
            eyebrow="Reference"
            title="Output displays"
            lead="A value can be read as a number, as LEDs, as a seven-segment digit, as a bar, or as a grid of cells."
          >
            <div className="docs-columns">
              <div>
                <h4>How it works</h4>
                <ul className="docs-list">
                  <li>
                    Each output picks its own display in the simulator dock. The choice
                    is kept with the project.
                  </li>
                  <li>
                    <strong>Number</strong> shows the binary value and its decimal
                    equivalent.
                  </li>
                  <li>
                    <strong>LEDs</strong> draws one light per bit, most significant bit
                    first.
                  </li>
                </ul>
              </div>
              <div>
                <h4>And more</h4>
                <ul className="docs-list">
                  <li>
                    <strong>7-segment</strong> draws a digit from the low four bits.
                  </li>
                  <li>
                    <strong>Bar</strong> shows how full the value is.
                  </li>
                  <li>
                    <strong>Grid</strong> lays the bus out as a board of cells, which is
                    how a grid of life cells reads.
                  </li>
                </ul>
              </div>
            </div>
          </Section>

          <Section
            id="editor"
            eyebrow="Reference"
            title="Editor tips"
            lead="The editor knows the language. It completes it, explains it, and points at the problem."
          >
            <div className="docs-columns">
              <div>
                <h4>Completions</h4>
                <ul className="docs-list">
                  <li>
                    Press <kbd>Ctrl</kbd> <kbd>Space</kbd> to open the completion list.
                  </li>
                  <li>
                    Type a letter to complete built-ins, keywords, snippets, and the signals that
                    exist in your file.
                  </li>
                  <li>
                    Type <code>instance.</code> to get the ports that instance exposes.
                  </li>
                  <li>
                    Snippets fill in placeholders; use <kbd>Tab</kbd> to move between them.
                  </li>
                </ul>
              </div>
              <div>
                <h4>Hover cards</h4>
                <ul className="docs-list">
                  <li>Hover a built-in for its signature, width rule, and a usage tip.</li>
                  <li>Hover a keyword for what it does in the grammar.</li>
                  <li>Hover one of your signals to see its kind and declaration line.</li>
                </ul>
              </div>
            </div>
            <div className="docs-columns">
              <div>
                <h4>Shortcuts</h4>
                <ul className="docs-list">
                  <li>
                    <kbd>Ctrl</kbd> <kbd>Enter</kbd> — compile and rebuild the graph.
                  </li>
                  <li>
                    <kbd>Ctrl</kbd> <kbd>S</kbd> — format the source.
                  </li>
                  <li>
                    <kbd>Ctrl</kbd> <kbd>Space</kbd> — completions.
                  </li>
                  <li>
                    <kbd>Tab</kbd> — accept the highlighted completion.
                  </li>
                  <li>
                    <kbd>Enter</kbd> — new line, never accepts a completion.
                  </li>
                  <li>
                    <kbd>Esc</kbd> — close completions and hover cards.
                  </li>
                </ul>
              </div>
              <div>
                <h4>Diagnostics</h4>
                <p>
                  Problems appear under the editor and as inline squiggles. Clicking a diagnostic
                  jumps to its line, and the console stays in sync with the compiled graph.
                </p>
              </div>
            </div>
          </Section>

          {beginner ? null : (
          <Section
            id="ir"
            eyebrow="Reference"
            title="Portable IR"
            lead="Everything in the studio reads one serializable object. That object is the contract other tools can target."
          >
            <CodeBlock
              caption="ir shape"
              code={`{
  "schema": "${IR_SCHEMA}",
  "language": "${LANGUAGE_VERSION}",
  "circuits": [
    {
      "name": "Adder8",
      "inputs":  [{ "name": "a", "width": 8 }],
      "outputs": [{ "name": "sum", "portName": "sum", "node": "Adder8/op:1", "width": 8 }],
      "states": [],
      "nodes":   [ /* input, constant, state, operation */ ],
      "events":  [],
      "sequential": false
    }
  ],
  "tests": []
}`}
            />
            <ul className="docs-list">
              <li>Values are zero-padded binary strings, so the IR is JSON and language neutral.</li>
              <li>Every circuit is flattened: instance scopes are paths, not sub-graphs.</li>
              <li>Clock events keep their edge, clock node, and state updates.</li>
              <li>The IR tab in the studio exports the exact object shown here.</li>
            </ul>
          </Section>
          )}

          <footer className="docs-footer">
            <span>Short Circuit · LogicFlow Studio</span>
            <button type="button" className="docs-back" onClick={onBack}>
              Back to studio
              <ArrowUpRight size={14} />
            </button>
          </footer>
        </main>
      </div>
    </main>
  );
}
