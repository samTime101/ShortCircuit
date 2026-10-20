import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BUILTINS,
  INTRINSIC_CIRCUITS,
  LANGUAGE_SNIPPETS,
  LANGUAGE_VERSION,
  IR_SCHEMA,
} from "@shortcircuit/engine";
import { ArrowUpRight, Check, Code, Copy, Cpu, Layers, Table } from "../components/Icons";
import { highlightLogicFlow } from "../editor/logicFlowHighlight";
import "./docs.css";

interface DocsPageProps {
  onBack(): void;
}

interface SectionDef {
  id: string;
  label: string;
  group: string;
}

const SECTIONS: SectionDef[] = [
  { id: "overview", label: "Overview", group: "Getting started" },
  { id: "quick-start", label: "Quick start", group: "Getting started" },
  { id: "syntax", label: "Syntax", group: "Language" },
  { id: "values", label: "Values and buses", group: "Language" },
  { id: "signals", label: "Signals and state", group: "Language" },
  { id: "operations", label: "Built-in operations", group: "Language" },
  { id: "reference", label: "Function reference", group: "Language" },
  { id: "widths", label: "Width policy", group: "Language" },
  { id: "constants", label: "Constants and loops", group: "Language" },
  { id: "parameters", label: "Parameterized circuits", group: "Language" },
  { id: "composition", label: "Composition", group: "Language" },
  { id: "clocking", label: "State and clocks", group: "Language" },
  { id: "testing", label: "Tests and truth tables", group: "Language" },
  { id: "diagnostics", label: "Diagnostics", group: "Reference" },
  { id: "limits", label: "Limits", group: "Reference" },
  { id: "snippets", label: "Snippet library", group: "Reference" },
  { id: "displays", label: "Output displays", group: "Reference" },
  { id: "editor", label: "Editor tips", group: "Reference" },
  { id: "ir", label: "Portable IR", group: "Reference" },
];

const CATEGORY_LABEL: Record<string, string> = {
  gate: "gate",
  arithmetic: "arithmetic",
  compare: "comparison",
  bus: "bus",
  selection: "selection",
};

function useActiveSection(scroller: React.RefObject<HTMLElement | null>): string {
  const [active, setActive] = useState(SECTIONS[0]!.id);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const update = () => {
      const marker = element.scrollTop + 150;
      let current = SECTIONS[0]!.id;
      for (const section of SECTIONS) {
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
  }, [scroller]);
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
  index,
  eyebrow,
  title,
  lead,
  children,
}: {
  id: string;
  index: string;
  eyebrow: string;
  title: string;
  lead?: string;
  children: ReactNode;
}) {
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

export function DocsPage({ onBack }: DocsPageProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const active = useActiveSection(pageRef);
  const groups = useMemo(() => {
    const map = new Map<string, SectionDef[]>();
    for (const section of SECTIONS) {
      const list = map.get(section.group) ?? [];
      list.push(section);
      map.set(section.group, list);
    }
    return [...map.entries()];
  }, []);

  const jump = (id: string) => {
    const element = document.getElementById(id);
    if (element) element.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="docs-page" ref={pageRef}>
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
                Start with the lessons: they build a half adder, a counter, and a latch one gate at a
                time, and they check your work as you go. The glossary explains every word the
                language uses.
              </p>
              <button
                type="button"
                className="docs-back"
                onClick={() => {
                  window.location.hash = "#/learn";
                }}
              >
                Open the lessons
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
                  <li>Read the quick start, then the width policy.</li>
                  <li>Hover any built-in in the editor for its signature and tip.</li>
                  <li>Copy a snippet from the library and paste it into the editor.</li>
                </ul>
              </div>
            </div>
          </section>

          <Section
            id="quick-start"
            index="01"
            eyebrow="Getting started"
            title="Quick start"
            lead="One circuit, two gates, four exhaustive tests. Everything else in the language builds on this shape."
          >
            <CodeBlock
              caption="half-adder.lf"
              code={`CIRCUIT HalfAdder

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
            id="syntax"
            index="02"
            eyebrow="Language"
            title="Syntax"
            lead="LogicFlow is line oriented. One declaration or assignment per line, blocks closed with END."
          >
            <div className="docs-columns">
              <div>
                <h4>Program structure</h4>
                <CodeBlock
                  code={`program      := (circuit | test)*

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
                    <strong>Comments</strong> start with <code>#</code> and run to the end of the line.
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
                    OUTPUT, STATE, ON, RISING_EDGE, FALLING_EDGE, IF, ELSE, TEST, CASE, EXPECT, BUS,
                    plus every built-in name.
                  </li>
                </ul>
              </div>
            </div>
          </Section>

          <Section
            id="values"
            index="03"
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

upper   = data[7:4]     # inclusive slice, 4 bits
low_bit = data[0]       # single bit
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
            index="04"
            eyebrow="Language"
            title="Signals and state"
            lead="Every signal has exactly one definition: an input, a stored state, or an assignment."
          >
            <div className="docs-columns">
              <div>
                <h4>Inputs and outputs</h4>
                <CodeBlock
                  code={`INPUT enable        # one bit
INPUT data : BUS(8)  # eight bits

OUTPUT sum          # a signal
OUTPUT result.zero  # an instance port`}
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
            id="operations"
            index="05"
            eyebrow="Language"
            title="Built-in operations"
            lead="Every operation is a real node in the compiled graph. Hover one in the editor to see the same details."
          >
            {(["gate", "arithmetic", "compare", "bus", "selection"] as const).map((category) => (
              <div className="docs-op-group" key={category}>
                <h4>
                  {category === "gate" ? <Layers size={14} /> : null}
                  {category === "arithmetic" ? <Code size={14} /> : null}
                  {category === "compare" ? <Table size={14} /> : null}
                  {category === "selection" ? <Cpu size={14} /> : null}
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
                          <code>{spec.signature}</code>
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

            <h4>Circuit-shaped components</h4>
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Call</th>
                  <th>Ports</th>
                  <th>What it does</th>
                </tr>
              </thead>
              <tbody>
                {INTRINSIC_CIRCUITS.map((spec) => (
                  <tr key={spec.name}>
                    <td>
                      <code>{spec.signature}</code>
                    </td>
                    <td>
                      {spec.inputs.join(", ")} → {spec.outputs.join(", ")}
                    </td>
                    <td>
                      {spec.description} {spec.tip}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section
            id="reference"
            index="06"
            eyebrow="Language"
            title="Function reference"
            lead="Every built-in operation, with its arguments, the width it produces, and a worked example."
          >
            <div className="docs-fn-index">
              {BUILTINS.map((spec) => (
                <a key={spec.name} href={`#fn-${spec.name.toLowerCase()}`}>
                  {spec.name}
                </a>
              ))}
              {INTRINSIC_CIRCUITS.map((spec) => (
                <a key={spec.name} href={`#fn-${spec.name.toLowerCase()}`}>
                  {spec.name}
                </a>
              ))}
            </div>

            {BUILTINS.map((spec) => (
              <article className="docs-fn" id={`fn-${spec.name.toLowerCase()}`} key={spec.name}>
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
                        {spec.example.result} — {spec.example.note}
                      </span>
                    </span>
                  </div>
                </div>
              </article>
            ))}

            <h4>Circuit-shaped components</h4>
            {INTRINSIC_CIRCUITS.map((spec) => (
              <article className="docs-fn" id={`fn-${spec.name.toLowerCase()}`} key={spec.name}>
                <header>
                  <h4>
                    <code>{spec.signature}</code>
                    <span className="docs-fn-category">component</span>
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
                        <dd>{arg.description}</dd>
                      </div>
                    ))}
                    <div>
                      <dt>
                        <code>outputs</code>
                      </dt>
                      <dd>{spec.outputs.join(", ")}</dd>
                    </div>
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
                        {spec.example.result} — {spec.example.note}
                      </span>
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </Section>

          <Section
            id="widths"
            index="07"
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
                  <td>ADD, SUBTRACT</td>
                  <td>Result width = common input width, wrapping modulo 2^w. Carry and borrow are dropped.</td>
                </tr>
                <tr>
                  <td>MULTIPLY</td>
                  <td>Result width = 2 x common input width. The full product is kept.</td>
                </tr>
                <tr>
                  <td>Comparisons</td>
                  <td>1-bit result (2 bits for COMPARE), comparing unsigned values.</td>
                </tr>
                <tr>
                  <td>SLICE and CONCAT</td>
                  <td>Result width follows the bits involved, never more than the width limit.</td>
                </tr>
              </tbody>
            </table>
            <Note kind="warn">
              <strong>Division by zero is an error, not a value.</strong> A constant zero divisor is
              rejected at compile time (E309). A divisor that becomes zero at runtime raises R500 and
              the studio stops showing outputs until it is fixed.
            </Note>
          </Section>

          <Section
            id="constants"
            index="08"
            eyebrow="Language"
            title="Constants and loops"
            lead="Name a compile-time value, or repeat a block once per value. Both are resolved before the design is analysed."
          >
            <div className="docs-columns">
              <div>
                <h4>Constants</h4>
                <CodeBlock
                  code={`CONST W = 4
CONST H = W + 1

CIRCUIT Sized
  INPUT data : BUS(W * 2)

  OUTPUT value
  value = data[H - 1]
END`}
                />
                <ul className="docs-list">
                  <li>Constants are whole numbers, declared before the circuits.</li>
                  <li>Compile-time arithmetic supports + - * / %.</li>
                  <li>They work in widths, bit indexes, slice bounds, and loop bounds.</li>
                </ul>
              </div>
              <div>
                <h4>Loops</h4>
                <CodeBlock
                  code={`CIRCUIT Bits
  INPUT data : BUS(4)

  FOR i IN 0..3
    bit[i] = data[i]
  END

  OUTPUT bit[0]
  OUTPUT bit[3]
END`}
                />
                <ul className="docs-list">
                  <li>The range includes both ends.</li>
                  <li>
                    An assignment in a loop needs an index, such as <code>bit[i]</code>.
                  </li>
                  <li>
                    Indexed names become plain ones: <code>bit[0]</code> is written{" "}
                    <code>bit_0</code>.
                  </li>
                </ul>
              </div>
            </div>
          </Section>

          <Section
            id="parameters"
            index="09"
            eyebrow="Language"
            title="Parameterized circuits"
            lead="One definition, many sizes. A parameter is a compile-time whole number that a circuit can use anywhere a constant can."
          >
            <CodeBlock
              code={`CIRCUIT Register(N = 8)
  INPUT data : BUS(N)
  INPUT clock

  STATE q : BUS(N) = 0

  ON RISING_EDGE(clock):
    q = data
  END

  OUTPUT q
END

CIRCUIT Main
  INPUT wide : BUS(16)
  INPUT clock

  small = Register(data = wide[7:0], clock = clock)
  big = Register<16>(data = wide, clock = clock)

  OUTPUT small.q
  OUTPUT big.q
END`}
            />
            <ul className="docs-list">
              <li>
                Parameters are declared with the circuit and may have a default, such as{" "}
                <code>CIRCUIT Register(N = 8)</code>.
              </li>
              <li>
                A parameter works like a constant inside the circuit: in widths, indexes,
                and slice bounds.
              </li>
              <li>
                An instance gives values with <code>Name&lt;16&gt;(...)</code> or by
                name.
              </li>
              <li>
                Each parameter set becomes its own copy, so two widths can live side by
                side.
              </li>
            </ul>
          </Section>

          <Section
            id="composition"
            index="08"
            eyebrow="Language"
            title="Composition"
            lead="Circuits are reusable. Instances are named, their outputs are read with dotted paths, and the design is flattened into one graph."
          >
            <CodeBlock
              caption="half adder + full adder"
              code={`CIRCUIT HalfAdder
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
            index="09"
            eyebrow="Language"
            title="State and clocks"
            lead="Sequential logic is explicit. An edge triggers a block, the block computes next-state values, and every update commits together."
          >
            <CodeBlock
              caption="register with enable"
              code={`CIRCUIT Register8
  INPUT data : BUS(8)
  INPUT clock
  INPUT enable

  STATE stored : BUS(8) = 0

  ON RISING_EDGE(clock):
    IF enable:
      stored = data
    END
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
              A state that is not assigned along a path <strong>holds</strong> its value. That is why
              the register above keeps <code>stored</code> when <code>enable</code> is 0.
            </Note>
          </Section>

          <Section
            id="testing"
            index="10"
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
            id="diagnostics"
            index="11"
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
                    <code>E301</code>–<code>E324</code>
                  </td>
                  <td>Incompatible widths, arity, feedback, clock conflicts, expansion limits, recursion.</td>
                </tr>
                <tr>
                  <td>Warnings</td>
                  <td>
                    <code>W301</code>–<code>W303</code>
                  </td>
                  <td>Constant clock, empty clocked block, repeated state assignment.</td>
                </tr>
                <tr>
                  <td>Runtime</td>
                  <td>
                    <code>R400</code>–<code>R500</code>
                  </td>
                  <td>Bad input value, conflicting clock commit, unsupported operation, divide by zero.</td>
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
            index="12"
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
            id="snippets"
            index="13"
            eyebrow="Reference"
            title="Snippet library"
            lead="Every snippet is also available in the editor: type its name, or start typing a keyword, and pick it from the completion list."
          >
            <div className="docs-snippets">
              {LANGUAGE_SNIPPETS.map((snippet) => (
                <article className="docs-snippet" key={snippet.id}>
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
            index="15"
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
            index="14"
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

          <Section
            id="ir"
            index="15"
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

          <footer className="docs-footer">
            <span>Short Circuit · LogicFlow Studio</span>
            <button type="button" className="docs-back" onClick={onBack}>
              Back to studio
              <ArrowUpRight size={14} />
            </button>
          </footer>
        </main>
      </div>
    </div>
  );
}
