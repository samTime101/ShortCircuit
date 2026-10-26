import { memo, useEffect, useMemo, useState } from "react";
import type { CircuitIR } from "@shortcircuit/engine";
import { Download, FileCode } from "./Icons";
import { traceSignals, traceToJson, traceToVcd, valueFor, type TraceSample } from "../lib/trace";

interface WaveformPanelProps {
  circuit: CircuitIR;
  trace: TraceSample[];
  onDownload(filename: string, contents: string, mime: string): void;
}

const ROW_HEIGHT = 26;
const LEFT = 132;
const TOP = 26;
const SAMPLE_WIDTH = 54;
/** Only this many samples are ever mounted; older ones are paged in. */
const WINDOW_SIZE = 200;

export const WaveformPanel = memo(function WaveformPanel({ circuit, trace, onDownload }: WaveformPanelProps) {
  const signals = useMemo(() => traceSignals(circuit), [circuit]);
  const [windowStart, setWindowStart] = useState<number | null>(null);

  useEffect(() => {
    // A fresh run starts following the newest samples again.
    if (trace.length === 0) setWindowStart(null);
  }, [trace.length]);

  if (trace.length === 0) {
    return (
      <div className="workbench-empty">
        <FileCode size={25} />
        <h3>No trace yet</h3>
        <p>
          Change an input, press Step, or run the clock. Every change is recorded here so you can
          see how the circuit behaved over time.
        </p>
      </div>
    );
  }

  const latestStart = Math.max(0, trace.length - WINDOW_SIZE);
  const start = windowStart === null ? latestStart : Math.min(windowStart, latestStart);
  const end = Math.min(trace.length, start + WINDOW_SIZE);
  const visible = trace.slice(start, end);
  const width = LEFT + visible.length * SAMPLE_WIDTH + 24;
  const height = TOP + signals.length * ROW_HEIGHT + 16;
  const windowed = trace.length > WINDOW_SIZE;

  const showEarlier = () => setWindowStart(Math.max(0, start - WINDOW_SIZE));
  const showLater = () => {
    const next = Math.min(latestStart, start + WINDOW_SIZE);
    setWindowStart(next >= latestStart ? null : next);
  };

  return (
    <div className="waveform-panel">
      <div className="panel-intro">
        <div>
          <span className="eyebrow">Recorded run</span>
          <h2>Waveform</h2>
          <p>
            {trace.length} sample{trace.length === 1 ? "" : "s"} recorded. Rising and falling
            edges are marked on the time axis.
            {windowed ? ` Showing samples ${start + 1}–${end} of ${trace.length}.` : ""}
          </p>
        </div>
        <div className="ir-actions">
          {windowed ? (
            <div className="waveform-window-controls" role="group" aria-label="Waveform window">
              <button
                className="secondary-button"
                onClick={showEarlier}
                disabled={start === 0}
              >
                Earlier
              </button>
              <button
                className="secondary-button"
                onClick={showLater}
                disabled={end === trace.length}
              >
                Later
              </button>
              <button
                className="secondary-button"
                onClick={() => setWindowStart(null)}
                disabled={end === trace.length}
              >
                Latest
              </button>
            </div>
          ) : null}
          <button
            className="secondary-button"
            onClick={() =>
              onDownload(
                `${circuit.name}.vcd`,
                traceToVcd(circuit, trace),
                "text/plain;charset=utf-8",
              )
            }
          >
            <Download size={14} /> Export VCD
          </button>
          <button
            className="secondary-button"
            onClick={() =>
              onDownload(
                `${circuit.name}-trace.json`,
                traceToJson(trace),
                "application/json",
              )
            }
          >
            <FileCode size={14} /> Export JSON
          </button>
        </div>
      </div>

      <div className="waveform-scroll">
        <svg className="waveform" width={width} height={height} role="img" aria-label="Signal trace">
          {visible.map((sample, index) => {
            const sampleIndex = start + index;
            return (
              <g key={`edge-${sampleIndex}`}>
                <line
                  x1={LEFT + index * SAMPLE_WIDTH}
                  y1={TOP - 12}
                  x2={LEFT + index * SAMPLE_WIDTH}
                  y2={height - 8}
                  className="wave-axis"
                />
                {sample.events.map((event, eventIndex) => (
                  <text
                    key={`${event.clock}-${eventIndex}`}
                    x={LEFT + index * SAMPLE_WIDTH + 3}
                    y={TOP - 15}
                    className={`wave-edge is-${event.edge}`}
                  >
                    {event.edge === "rising" ? "▴" : "▾"}
                  </text>
                ))}
              </g>
            );
          })}

          {signals.map((signal, row) => {
            const y = TOP + row * ROW_HEIGHT;
            return (
              <g key={`${signal.group}-${signal.name}`}>
                <text x={0} y={y + 15} className="wave-name">
                  {signal.name}
                </text>
                <text x={LEFT - 8} y={y + 15} className="wave-width" textAnchor="end">
                  {signal.width}b
                </text>
                <line x1={LEFT} y1={y + 2} x2={width - 12} y2={y + 2} className="wave-row" />
                {visible.map((sample, index) => {
                  const value = valueFor(sample, signal.group, signal.name);
                  const x = LEFT + index * SAMPLE_WIDTH;
                  if (signal.width === 1) {
                    const high = value.endsWith("1");
                    const top = high ? y + 4 : y + 16;
                    const sampleIndex = start + index;
                    const next = trace[sampleIndex + 1];
                    const nextHigh = next
                      ? valueFor(next, signal.group, signal.name).endsWith("1")
                      : high;
                    const nextTop = nextHigh ? y + 4 : y + 16;
                    return (
                      <path
                        key={sampleIndex}
                        d={`M ${x} ${top} L ${x + SAMPLE_WIDTH} ${top} M ${x} ${top} L ${x} ${nextTop}`}
                        className={`wave-signal ${high ? "is-high" : "is-low"}`}
                      />
                    );
                  }
                  return (
                    <g key={start + index}>
                      <rect
                        x={x + 1}
                        y={y + 4}
                        width={SAMPLE_WIDTH - 2}
                        height={13}
                        className="wave-bus"
                      />
                      <text x={x + 5} y={y + 14} className="wave-bus-value">
                        {value}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
});
