import { useEffect, useMemo, useState } from "react";
import {
  formatBinary,
  parseSimulationInput,
  type CircuitIR,
  type SimulationSnapshot,
} from "@shortcircuit/engine";
import { DISPLAY_MODES, OutputDisplay, type DisplayMode } from "./OutputDisplay";
import {
  Circle as CircleIcon,
  Clock,
  Pause as PauseIcon,
  Play as PlayIcon,
  RotateCcw,
  StepForward as StepIcon,
  X,
  Zap,
} from "./Icons";

interface SimulatorDockProps {
  circuit: CircuitIR;
  snapshot: SimulationSnapshot | null;
  inputValues: Record<string, string>;
  runtimeError: string | null;
  /** Input names used as clocks by this circuit. */
  clocks: string[];
  selectedClock: string | null;
  onSelectClock(name: string): void;
  onStep(): void;
  running: boolean;
  onToggleRun(): void;
  speed: number;
  onSpeedChange(speed: number): void;
  onInputChange(name: string, value: string): void;
  onSetState(name: string, value: string): void;
  onReset(): void;
  /** True while a test case is being recorded. */
  recording: boolean;
  onStartRecording(): void;
  onStopRecording(): void;
  /** Records an expectation for the signal with the given name. */
  onExpectThis(name: string, value: string): void;
  /** How each output is drawn. */
  displays: Record<string, DisplayMode>;
  /** Beginner mode uses everyday wording. */
  beginner?: boolean;
  onDisplayChange(name: string, mode: DisplayMode): void;
}

function BusTextField({
  name,
  width,
  value,
  onChange,
}: {
  name: string;
  width: number;
  value: string;
  onChange(value: string): void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);

  const commit = () => {
    try {
      const parsed = parseSimulationInput(draft, width);
      setError(null);
      onChange(formatBinary(parsed, width));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <div className="bus-text-field">
      <input
        value={draft}
        aria-label={`${name} binary value`}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit();
            (event.target as HTMLInputElement).blur();
          }
        }}
      />
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}

function StateField({
  name,
  width,
  value,
  onChange,
}: {
  name: string;
  width: number;
  value: string;
  onChange(value: string): void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);

  const commit = () => {
    try {
      const parsed = parseSimulationInput(draft, width);
      setError(null);
      onChange(formatBinary(parsed, width));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <div className="bus-text-field state-field">
      <input
        value={draft}
        aria-label={`${name} binary value`}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit();
            (event.target as HTMLInputElement).blur();
          }
        }}
      />
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}

export function SimulatorDock({
  circuit,
  snapshot,
  inputValues,
  runtimeError,
  clocks,
  selectedClock,
  onSelectClock,
  onStep,
  running,
  onToggleRun,
  speed,
  onSpeedChange,
  onInputChange,
  onSetState,
  onReset,
  recording,
  onStartRecording,
  onStopRecording,
  onExpectThis,
  displays,
  onDisplayChange,
  beginner,
}: SimulatorDockProps) {
  const clockInputNames = useMemo(() => {
    const labels = new Set<string>();
    for (const event of circuit.events) {
      const clockNode = circuit.nodes.find((node) => node.id === event.clock);
      if (clockNode?.inputName) labels.add(clockNode.inputName);
      else if (clockNode?.label) labels.add(clockNode.label);
    }
    for (const input of circuit.inputs) {
      if (input.name.toLowerCase() === "clock" && input.width === 1) labels.add(input.name);
    }
    return labels;
  }, [circuit]);

  const cascadeEvents = circuit.sequential ? (
    <span className="sim-clock-hint">
      <Clock size={12} />
      0 → 1 fires a rising edge
    </span>
  ) : null;

  return (
    <section className="sim-dock">
      <div className="sim-dock-head">
        <div className="sim-dock-title">
          <span className="live-dot" />
          <span>Live simulation</span>
          {snapshot?.firedEvents.length ? (
            <span className="event-chip">
              <Zap size={11} />
              {snapshot.firedEvents
                .map((event) => `${event.edge.toUpperCase()}`)
                .join(" · ")}
            </span>
          ) : null}
        </div>
        <div className="sim-dock-actions">
          {recording ? (
            <>
              <span className="record-indicator">
                <span className="record-dot" /> recording
              </span>
              <button className="text-button compact is-recording" onClick={onStopRecording}>
                <X size={12} /> Stop
              </button>
            </>
          ) : (
            <button
              className="text-button compact"
              onClick={onStartRecording}
              title="Record your actions as a test case"
            >
              <CircleIcon size={12} /> Record test
            </button>
          )}
          {cascadeEvents}
          <button className="text-button compact" onClick={onReset} title="Reset all stored state">
            <RotateCcw size={13} /> Reset
          </button>
        </div>
      </div>

      {clocks.length > 0 ? (
        <div className="dock-controls-row">
          <div className="dock-controls">
            <select
              className="dock-select"
              aria-label="Clock to drive"
              value={selectedClock ?? clocks[0] ?? ""}
              onChange={(event) => onSelectClock(event.target.value)}
            >
              {clocks.map((clock) => (
                <option key={clock} value={clock}>
                  {clock}
                </option>
              ))}
            </select>
            <button
              className="text-button compact"
              onClick={onStep}
              disabled={!selectedClock}
              title="Pulse the clock once: 0 to 1 to 0"
            >
              <StepIcon size={13} /> Step
            </button>
            <button
              className={`text-button compact ${running ? "is-active" : ""}`}
              onClick={onToggleRun}
              title={running ? "Pause the clock" : "Run the clock continuously"}
            >
              {running ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
              {running ? "Pause" : "Run"}
            </button>
            <select
              className="dock-select"
              aria-label="Clock speed"
              value={speed}
              onChange={(event) => onSpeedChange(Number(event.target.value))}
            >
              {[1, 2, 5, 10].map((hz) => (
                <option key={hz} value={hz}>
                  {hz} Hz
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      {runtimeError ? (
        <div className="runtime-error">
          <strong>Simulation stopped.</strong> {runtimeError}{" "}
          <span>Source is untouched. Reset to start again.</span>
        </div>
      ) : null}

      <div className="sim-columns">
        <div className="sim-group inputs-group">
          <div className="sim-group-title">
            <span>Inputs</span>
            <span className="group-count">{circuit.inputs.length}</span>
          </div>
          <div className="io-list">
            {circuit.inputs.length === 0 ? (
              <div className="io-empty">This circuit has no external inputs.</div>
            ) : (
              circuit.inputs.map((input) => {
                const value = inputValues[input.name] ?? formatBinary(0n, input.width);
                const isClock = clockInputNames.has(input.name);
                if (input.width === 1) {
                  const on = value.endsWith("1");
                  return (
                    <div className={`io-control bit-control ${isClock ? "is-clock" : ""}`} key={input.name}>
                      <div className="io-label-row">
                        <span className="io-label">
                          {isClock ? <Clock size={12} /> : null}
                          {input.name}
                        </span>
                        <span className="io-width">1b</span>
                      </div>
                      <button
                        className={`bit-switch ${on ? "is-on" : ""}`}
                        aria-label={`Toggle ${input.name}`}
                        aria-pressed={on}
                        onClick={() => onInputChange(input.name, on ? "0" : "1")}
                      >
                        <span className="bit-switch-track">
                          <span className="bit-switch-thumb" />
                        </span>
                        <span className="bit-switch-value">{on ? "1" : "0"}</span>
                      </button>
                    </div>
                  );
                }

                if (input.width > 16) {
                  return (
                    <div className="io-control bus-control" key={input.name}>
                      <div className="io-label-row">
                        <span className="io-label">{input.name}</span>
                        <span className="io-width">{input.width}b</span>
                      </div>
                      <BusTextField
                        name={input.name}
                        width={input.width}
                        value={value}
                        onChange={(next) => onInputChange(input.name, next)}
                      />
                    </div>
                  );
                }

                return (
                  <div className="io-control bus-control" key={input.name}>
                    <div className="io-label-row">
                      <span className="io-label">{input.name}</span>
                      <span className="io-width">{input.width}b</span>
                    </div>
                    <div className="bit-cells" aria-label={`${input.name} bits`}>
                      {value.split("").map((bit, index) => {
                        const bitIndex = input.width - 1 - index;
                        return (
                          <button
                            className={`bit-cell ${bit === "1" ? "is-on" : ""}`}
                            key={`${input.name}-${bitIndex}`}
                            title={`${input.name}[${bitIndex}] = ${bit}. Click to flip.`}
                            aria-label={`Flip ${input.name} bit ${bitIndex}`}
                            onClick={() => {
                              const next = value.split("");
                              next[index] = bit === "1" ? "0" : "1";
                              onInputChange(input.name, next.join(""));
                            }}
                          >
                            {bit}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="sim-divider" />

        <div className="sim-group outputs-group">
          <div className="sim-group-title">
            <span>Outputs</span>
            <span className="group-count">{circuit.outputs.length}</span>
          </div>
          <div className="monitor-list">
            {circuit.outputs.length === 0 ? (
              <div className="io-empty">No outputs are exposed.</div>
            ) : (
              circuit.outputs.map((output) => {
                const signal = snapshot?.outputs[output.name];
                return (
                  <div className="monitor-row" key={output.name}>
                    <div className="monitor-label">
                      <span className={`monitor-led ${signal?.binary.includes("1") ? "hot" : ""}`} />
                      <span>{output.name}</span>
                      <span className="io-width">{output.width}b</span>
                    </div>
                    <div className="monitor-value">
                      <OutputDisplay
                        mode={displays[output.name] ?? "number"}
                        binary={signal?.binary ?? "0".repeat(output.width)}
                        decimal={signal?.decimal ?? "0"}
                        width={output.width}
                      />
                      {output.width > 1 ? (
                        <select
                          className="display-mode"
                          aria-label={`Display mode for ${output.name}`}
                          value={displays[output.name] ?? "number"}
                          onChange={(event) =>
                            onDisplayChange(output.name, event.target.value as DisplayMode)
                          }
                        >
                          {DISPLAY_MODES.map((mode) => (
                            <option key={mode.value} value={mode.value}>
                              {mode.label}
                            </option>
                          ))}
                        </select>
                      ) : null}
                      {recording && signal ? (
                        <button
                          className="expect-button"
                          onClick={() => onExpectThis(output.name, signal.binary)}
                          title={`Expect ${output.name} to be ${signal.binary}`}
                        >
                          Expect this
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
            {circuit.states.length > 0 ? (
              <div className="state-block">
                <div className="state-title">{beginner ? "Memory" : "Stored state"}</div>
                {circuit.states.map((state) => (
                  <div className="monitor-row state-row" key={state.node}>
                    <div className="monitor-label">
                      <span className="state-glyph">S</span>
                      <span>{state.name}</span>
                      <span className="io-width">{state.width}b</span>
                    </div>
                    <div className="monitor-value">
                      <StateField
                        name={state.name}
                        width={state.width}
                        value={snapshot?.states[state.name]?.binary ?? "0".repeat(state.width)}
                        onChange={(next) => onSetState(state.name, next)}
                      />
                      {recording && snapshot?.states[state.name] ? (
                        <button
                          className="expect-button"
                          onClick={() =>
                            onExpectThis(state.name, snapshot.states[state.name]!.binary)
                          }
                          title={`Expect ${state.name} to be ${snapshot.states[state.name]!.binary}`}
                        >
                          Expect this
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
