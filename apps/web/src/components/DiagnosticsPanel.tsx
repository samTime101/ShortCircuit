import { useEffect, useMemo, useState } from "react";
import type { Diagnostic, DiagnosticFix } from "@shortcircuit/engine";
import { AlertTriangle, Check, ChevronDown, Info, X } from "./Icons";

interface DiagnosticsPanelProps {
  diagnostics: Diagnostic[];
  source: string;
  compiling: boolean;
  circuitCount: number;
  nodeCount: number;
  onSelect(diagnostic: Diagnostic): void;
  onApplyFix(fix: DiagnosticFix): void;
}

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
  const lines = useMemo(() => source.split("\n"), [source]);

  useEffect(() => {
    if (errorCount > 0) setOpen(true);
  }, [errorCount]);

  return (
    <section className={`diagnostics-panel ${open ? "is-open" : ""} ${errorCount > 0 ? "has-errors" : ""}`}>
      <button className="diagnostics-header" onClick={() => setOpen((current) => !current)}>
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
              {errorCount} error{errorCount === 1 ? "" : "s"}
              {warningCount ? ` · ${warningCount} warning${warningCount === 1 ? "" : "s"}` : ""}
            </span>
          ) : (
            <span>
              Clean · {circuitCount} circuit{circuitCount === 1 ? "" : "s"} · {nodeCount} nodes
            </span>
          )}
          <ChevronDown size={15} className={`chevron ${open ? "is-open" : ""}`} />
        </span>
      </button>

      {open ? (
        <div className="diagnostics-body">
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
                return (
                  <button
                    className={`diagnostic-item severity-${diagnostic.severity}`}
                    key={`${diagnostic.code}-${diagnostic.line}-${diagnostic.column}-${index}`}
                    onClick={() => onSelect(diagnostic)}
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
                        <span>
                          {diagnostic.plain ? diagnostic.plain.headline : diagnostic.message}
                        </span>
                      </span>
                      {diagnostic.plain ? (
                        <span className="diagnostic-hint">{diagnostic.plain.detail}</span>
                      ) : null}
                      {diagnostic.plain ? null : diagnostic.hint ? (
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
                          <span>{diagnostic.line}</span>
                          {sourceLine.trim()}
                        </span>
                      ) : null}
                    </span>
                    <span className="diagnostic-location">
                      L{diagnostic.line}:{diagnostic.column}
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
