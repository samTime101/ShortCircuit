import { memo, useMemo, useState } from "react";
import { IR_SCHEMA, exportVerilog, type ProgramIR } from "@shortcircuit/engine";
import { Braces, Check, Copy, Download } from "./Icons";

interface IRPanelProps {
  ir: ProgramIR | null;
  onNotify(message: string): void;
}

export const IRPanel = memo(function IRPanel({ ir, onNotify }: IRPanelProps) {
  const [copied, setCopied] = useState(false);
  const json = useMemo(() => (ir ? JSON.stringify(ir, null, 2) : ""), [ir]);
  const filename = `${ir?.circuits[0]?.name.toLowerCase() ?? "circuit"}.shortcircuit.ir.json`;

  const copy = async () => {
    if (!json) return;
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      onNotify("Portable IR copied to clipboard");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      onNotify("Clipboard access was blocked by the browser");
    }
  };

  const downloadVerilog = () => {
    if (!ir) return;
    const { verilog, warnings } = exportVerilog(ir, { includeTestbenches: true });
    const blob = new Blob([verilog], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${ir.circuits[0]?.name.toLowerCase() ?? "circuit"}.v`;
    anchor.click();
    URL.revokeObjectURL(url);
    onNotify(
      warnings.length > 0
        ? `Verilog exported with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`
        : "Verilog exported",
    );
  };

  const download = () => {
    if (!json) return;
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    onNotify("IR file downloaded");
  };

  if (!ir) {
    return (
      <div className="workbench-empty">
        <Braces size={25} />
        <h3>No valid IR</h3>
        <p>Resolve the compiler diagnostics to produce the portable circuit graph.</p>
      </div>
    );
  }

  return (
    <div className="ir-panel">
      <div className="panel-intro">
        <div>
          <span className="eyebrow">Language-independent boundary</span>
          <h2>Portable IR</h2>
          <p>
            A plain graph of typed nodes, signal edges, state, events, and tests. Simulate it, draw it, verify
            it, or generate hardware from another runtime.
          </p>
        </div>
        <div className="ir-actions">
          <button className="secondary-button" onClick={copy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy JSON"}
          </button>
          <button className="secondary-button" onClick={download}>
            <Download size={14} /> Download
          </button>
          <button className="secondary-button" onClick={downloadVerilog} title="Export Verilog modules and a testbench">
            <Download size={14} /> Verilog
          </button>
        </div>
      </div>

      <div className="schema-strip">
        <span>
          schema <strong>{IR_SCHEMA}</strong>
        </span>
        <span>
          circuits <strong>{ir.circuits.length}</strong>
        </span>
        <span>
          nodes <strong>{ir.circuits.reduce((sum, circuit) => sum + circuit.stats.nodes, 0)}</strong>
        </span>
        <span>
          tests <strong>{ir.tests.length}</strong>
        </span>
        <span className="file-name">{filename}</span>
      </div>

      <div className="ir-callout">
        <Braces size={16} />
        <div>
          <strong>Same graph, every target.</strong>
          <span>
            The UI's simulator, graph, truth table, tests, and IR view all consume this object. It contains no
            source-language parser state.
          </span>
        </div>
      </div>

      <div className="code-scroll">
        <pre className="ir-code">{json}</pre>
      </div>
    </div>
  );
});
