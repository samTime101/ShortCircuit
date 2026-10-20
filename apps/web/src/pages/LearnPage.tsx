import { useMemo, useState } from "react";
import {
  GLOSSARY,
  LESSONS,
  Simulator,
  compile,
  type Lesson,
} from "@shortcircuit/engine";
import { ArrowUpRight, Book, Check, Lightbulb, X } from "../components/Icons";
import { highlightLogicFlow } from "../editor/logicFlowHighlight";
import "./learn.css";

interface LearnPageProps {
  source: string;
  onOpenInStudio(source: string): void;
}

interface CheckRow {
  note: string;
  pass: boolean;
  details: Array<{ name: string; expected: string; actual: string; pass: boolean }>;
}

function CodePreview({ code }: { code: string }) {
  const tokens = useMemo(() => highlightLogicFlow(code), [code]);
  return (
    <pre className="docs-code">
      <code>
        {tokens.map((token, index) => (
          <span key={index} className={`tok-${token.kind}`}>
            {token.text}
          </span>
        ))}
      </code>
    </pre>
  );
}

function checkLesson(source: string, lesson: Lesson): { pass: boolean; rows: CheckRow[]; error?: string } {
  const result = compile(source);
  if (!result.ok) {
    const first = result.diagnostics.find((item) => item.severity === "error");
    return { pass: false, rows: [], error: first?.message ?? "The circuit does not compile yet." };
  }
  const circuit = result.circuits.find((entry) => entry.name === lesson.circuit);
  if (!circuit) {
    return {
      pass: false,
      rows: [],
      error: `The lesson needs a circuit called ${lesson.circuit}.`,
    };
  }

  const simulator = new Simulator(circuit);
  const rows: CheckRow[] = lesson.checks.map((check) => {
    const snapshot = simulator.setInputs(check.inputs);
    const details = Object.entries(check.expect).map(([name, expected]) => {
      const actual = snapshot.outputs[name]?.binary ?? "<missing>";
      return { name, expected, actual, pass: actual === expected };
    });
    return { note: check.note, pass: details.every((detail) => detail.pass), details };
  });

  return { pass: rows.every((row) => row.pass), rows };
}

export function LearnPage({ source, onOpenInStudio }: LearnPageProps) {
  const [tab, setTab] = useState<"lessons" | "glossary">("lessons");
  const [selectedId, setSelectedId] = useState(LESSONS[0]!.id);
  const [hintIndex, setHintIndex] = useState(0);
  const [results, setResults] = useState<{ pass: boolean; rows: CheckRow[]; error?: string } | null>(null);
  const [done, setDone] = useState<string[]>(() => {
    try {
      return JSON.parse(window.localStorage.getItem("shortcircuit.lessons.v1") ?? "[]") as string[];
    } catch {
      return [];
    }
  });

  const lesson = LESSONS.find((entry) => entry.id === selectedId) ?? LESSONS[0]!;

  const markDone = (id: string) => {
    setDone((current) => {
      if (current.includes(id)) return current;
      const next = [...current, id];
      try {
        window.localStorage.setItem("shortcircuit.lessons.v1", JSON.stringify(next));
      } catch {
        // Progress is a convenience.
      }
      return next;
    });
  };

  const runChecks = () => {
    const outcome = checkLesson(source, lesson);
    setResults(outcome);
    if (outcome.pass) markDone(lesson.id);
  };

  return (
    <div className="learn-page">
      <header className="learn-topbar">
        <div>
          <span className="eyebrow">Learn</span>
          <h1>Build it, one gate at a time</h1>
        </div>
        <div className="learn-tabs">
          <button
            type="button"
            className={tab === "lessons" ? "is-active" : undefined}
            onClick={() => setTab("lessons")}
          >
            Lessons
          </button>
          <button
            type="button"
            className={tab === "glossary" ? "is-active" : undefined}
            onClick={() => setTab("glossary")}
          >
            Glossary
          </button>
        </div>
      </header>

      {tab === "lessons" ? (
        <div className="learn-layout">
          <aside className="learn-list">
            {LESSONS.map((entry, index) => (
              <button
                type="button"
                key={entry.id}
                className={entry.id === lesson.id ? "is-active" : undefined}
                onClick={() => {
                  setSelectedId(entry.id);
                  setResults(null);
                  setHintIndex(0);
                }}
              >
                <span className="learn-index">
                  {done.includes(entry.id) ? <Check size={12} /> : index + 1}
                </span>
                <span>
                  <strong>{entry.title}</strong>
                  <small>{entry.summary}</small>
                </span>
              </button>
            ))}
          </aside>

          <article className="learn-lesson">
            <h2>{lesson.title}</h2>
            {lesson.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}

            <div className="learn-goal">
              <Lightbulb size={15} />
              <div>
                <strong>Your goal</strong>
                <p>{lesson.goal}</p>
              </div>
            </div>

            <h3>Start from here</h3>
            <CodePreview code={lesson.starter} />
            <div className="learn-actions">
              <button
                className="primary-button"
                onClick={() => onOpenInStudio(lesson.starter)}
                title="Load this starter into the studio editor"
              >
                Open in studio
                <ArrowUpRight size={14} />
              </button>
              <button className="secondary-button" onClick={runChecks}>
                Check my answer
              </button>
              <button
                className="secondary-button"
                onClick={() => setHintIndex((current) => Math.min(current + 1, lesson.hints.length))}
                disabled={hintIndex >= lesson.hints.length}
              >
                Hint
              </button>
              <button className="secondary-button" onClick={() => onOpenInStudio(lesson.solution)}>
                Show solution
              </button>
            </div>

            {hintIndex > 0 ? (
              <ol className="learn-hints">
                {lesson.hints.slice(0, hintIndex).map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
              </ol>
            ) : null}

            {results ? (
              <div className={`learn-results ${results.pass ? "is-pass" : "is-fail"}`}>
                <h3>
                  {results.pass ? (
                    <>
                      <Check size={14} /> That works
                    </>
                  ) : (
                    <>
                      <X size={14} /> Not yet
                    </>
                  )}
                </h3>
                {results.error ? <p>{results.error}</p> : null}
                <ul>
                  {results.rows.map((row) => (
                    <li key={row.note} className={row.pass ? "is-pass" : "is-fail"}>
                      <span>{row.note}</span>
                      {row.pass ? null : (
                        <ul>
                          {row.details
                            .filter((detail) => !detail.pass)
                            .map((detail) => (
                              <li key={detail.name}>
                                {detail.name}: expected {detail.expected}, got {detail.actual}
                              </li>
                            ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </article>
        </div>
      ) : (
        <div className="learn-glossary">
          <p className="learn-glossary-intro">
            The words this language uses, in plain language. Every entry has a one-line definition and a
            longer explanation.
          </p>
          <div className="learn-glossary-grid">
            {GLOSSARY.map((entry) => (
              <article key={entry.term}>
                <header>
                  <h3>{entry.term}</h3>
                  <span className="docs-chip small">{entry.group}</span>
                </header>
                <p className="learn-glossary-short">{entry.short}</p>
                <p className="learn-glossary-long">{entry.long}</p>
              </article>
            ))}
          </div>
          <p className="learn-glossary-foot">
            <Book size={14} /> The same words are used in the studio, the documentation, and the command
            line.
          </p>
        </div>
      )}
    </div>
  );
}
