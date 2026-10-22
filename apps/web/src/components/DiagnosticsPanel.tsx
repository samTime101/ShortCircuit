import { useEffect, useMemo, useState } from "react";
import type { Diagnostic, DiagnosticFix } from "@shortcircuit/engine";
import { AlertTriangle, Check, ChevronDown, Copy, Info, X } from "./Icons";
import { countLabel, formatDiagnostics } from "../lib/diagnosticsText";

interface DiagnosticsPanelProps {
  diagnostics: Diagnostic[];
  source: string;
  compiling: boolean;
  circuitCount: number;
  nodeCount: number;
  onSelect(diagnostic: Diagnostic): void;
  onApplyFix(fix: DiagnosticFix): void;
}

type CopyState = "idle" | "copied" | "failed";

export function DiagnosticsPanel({
  diagnostics,
  source,
  compiling,
  circuitCount,
  nodeCount,
  onSelect,
  onApplyFix,
}: DiagnosticsPanelProps) {
  const errorCount = diagnostics.filter((item) => item.severity === "error").length;
  const warningCount = diagnostics.filter((item) => item.severity === "warning").length;
  const [open, setOpen] = useState(true);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const lines = useMemo(() => source.split("\n"), [source]);

  useEffect(() => {
    if (errorCount > 0) setOpen(true);
  }, [errorCount]);

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const copyAll = async () => {
    if (diagnostics.length === 0) return;
    const text = formatDiagnostics(diagnostics, lines);
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <section className={`diagnostics-panel ${open ? "is-open" : ""} ${errorCount > 0 ? "has-errors" : ""}`}>
      <div className="diagnostics-header">
        <button
          className="diagnostics-toggle"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls="diagnostics-body"
        >
          <span className="diagnostics-title">
            {errorCount > 0 ? (
              <span className="diag-status error">
                <X size={12} />
              </span>
            ) : warningCount > 0 ? (
              <span className="diag-status warning">
                <AlertTriangle size={12} />
              </span>
            ) : (
              <span className="diag-status ok">
                <Check size={12} />
              </span>
            )}
            <span>Console</span>
            {errorCount > 0 ? <span className="diag-count">{errorCount}</span> : null}
            {warningCount > 0 ? <span className="diag-count warn">{warningCount}</span> : null}
          </span>
          <span className="diagnostics-meta">
            {compiling ? (
              <span className="compiling-pill">
                <span className="spinner" /> compiling
              </span>
            ) : errorCount > 0 ? (
              <span>
                {countLabel(errorCount, "error")}
                {warningCount ? ` · ${countLabel(warningCount, "warning")}` : ""}
              </span>
            ) : (
              <span>
                Clean · {circuitCount} circuit{circuitCount === 1 ? "" : "s"} · {nodeCount} nodes
              </span>
            )}
          </span>
          <ChevronDown size={15} className={`chevron ${open ? "is-open" : ""}`} />
        </button>

        {diagnostics.length > 0 ? (
          <button
            className={`diagnostics-copy ${copyState}`}
            onClick={copyAll}
            title={`Copy all ${countLabel(diagnostics.length, "diagnostic")} to the clipboard`}
          >
            {copyState === "copied" ? <Check size={13} /> : <Copy size={13} />}
            <span>{copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy"}</span>
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="diagnostics-body" id="diagnostics-body">
          {diagnostics.length === 0 ? (
            <div className="diagnostics-clean">
              <Check size={14} />
              <span>
                No syntax, wiring, width or clocking issues detected.
                {compiling ? " Rebuilding graph…" : " The current graph is ready to simulate."}
              </span>
            </div>
          ) : (
            <div className="diagnostic-list">
              {diagnostics.map((diagnostic, index) => {
                const sourceLine = lines[Math.max(0, diagnostic.line - 1)] ?? "";
                const headline = diagnostic.plain?.headline;
                return (
                  <button
                    className={`diagnostic-item severity-${diagnostic.severity}`}
                    key={`${diagnostic.code}-${diagnostic.line}-${diagnostic.column}-${index}`}
                    onClick={() => onSelect(diagnostic)}
                    title={`Jump to line ${diagnostic.line}`}
                  >
                    <span className="diagnostic-icon">
                      {diagnostic.severity === "error" ? (
                        <X size={13} />
                      ) : diagnostic.severity === "warning" ? (
                        <AlertTriangle size={13} />
                      ) : (
                        <Info size={13} />
                      )}
                    </span>
                    <span className="diagnostic-main">
                      <span className="diagnostic-line">
                        <span className="diag-code">{diagnostic.code}</span>
                        <span className="diagnostic-headline">{headline ?? diagnostic.message}</span>
                        <span className="diagnostic-location">
                          L{diagnostic.line}:{diagnostic.column}
                        </span>
                      </span>
                      {headline && headline !== diagnostic.message ? (
                        <span className="diagnostic-message">{diagnostic.message}</span>
                      ) : null}
                      {diagnostic.plain ? (
                        <span className="diagnostic-hint">{diagnostic.plain.detail}</span>
                      ) : null}
                      {diagnostic.hint && diagnostic.hint !== diagnostic.plain?.detail ? (
                        <span className="diagnostic-hint">{diagnostic.hint}</span>
                      ) : null}
                      {diagnostic.plain?.fix ? (
                        <span className="diagnostic-fix">
                          <span
                            role="button"
                            tabIndex={0}
                            className="fix-button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onApplyFix(diagnostic.plain!.fix!);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                event.stopPropagation();
                                onApplyFix(diagnostic.plain!.fix!);
                              }
                            }}
                          >
                            {diagnostic.plain.fix.label}
                          </span>
                        </span>
                      ) : null}
                      {sourceLine.trim() ? (
                        <span className="diagnostic-snippet">
                          <span className="snippet-gutter">{diagnostic.line}</span>
                          <span className="snippet-code">{sourceLine.trim()}</span>
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
