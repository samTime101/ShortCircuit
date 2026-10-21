import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Simulator, compile } from "@shortcircuit/engine";
import { SimulatorDock } from "../components/SimulatorDock";

const SOURCE = `CIRCUIT Counter4
INPUT clock
INPUT reset
STATE count : BUS(4) = 0000
incremented = ADD4(count, 0, 1)
next = MUX(incremented.sum, 0, reset)
ON RISING_EDGE(clock):
  count = next
END
OUTPUT count
END`;

function setup(overrides: Partial<Parameters<typeof SimulatorDock>[0]> = {}) {
  const result = compile(SOURCE);
  const circuit = result.circuits[0]!;
  const simulator = new Simulator(circuit);
  const snapshot = simulator.snapshot();
  const props = {
    circuit,
    snapshot,
    inputValues: simulator.getInputValues(),
    runtimeError: null,
    clocks: ["clock"],
    selectedClock: "clock",
    onSelectClock: vi.fn(),
    onStep: vi.fn(),
    running: false,
    onToggleRun: vi.fn(),
    speed: 2,
    onSpeedChange: vi.fn(),
    onInputChange: vi.fn(),
    onSetState: vi.fn(),
    onReset: vi.fn(),
    recording: false,
    onStartRecording: vi.fn(),
    onStopRecording: vi.fn(),
    onExpectThis: vi.fn(),
    displays: {},
    onDisplayChange: vi.fn(),
    ...overrides,
  };
  render(<SimulatorDock {...props} />);
  return props;
}

describe("simulator dock", () => {
  it("shows the inputs, outputs, and stored state", () => {
    setup();
    expect(screen.getAllByText("clock").length).toBeGreaterThan(0);
    expect(screen.getAllByText("reset").length).toBeGreaterThan(0);
    expect(screen.getAllByText("count").length).toBeGreaterThan(0);
  });

  it("drives an input when a switch is flipped", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: "Toggle clock" }));
    expect(props.onInputChange).toHaveBeenCalledWith("clock", "1");
  });

  it("steps the clock and toggles the run loop", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: /step/i }));
    expect(props.onStep).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: /run/i }));
    expect(props.onToggleRun).toHaveBeenCalledTimes(1);
  });

  it("changes the clock speed", async () => {
    const props = setup();
    await userEvent.selectOptions(screen.getByLabelText("Clock speed"), "10");
    expect(props.onSpeedChange).toHaveBeenCalledWith(10);
  });

  it("forces a state value from the state field", async () => {
    const props = setup();
    const field = screen.getByLabelText("count binary value");
    await userEvent.clear(field);
    await userEvent.type(field, "1010{Enter}");
    expect(props.onSetState).toHaveBeenCalledWith("count", "1010");
  });

  it("resets the stored state", async () => {
    const props = setup();
    await userEvent.click(screen.getByTitle("Reset all stored state"));
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it("hides the clock controls for a combinational circuit", () => {
    const result = compile("CIRCUIT Wire\nINPUT a\nOUTPUT b\nb = NOT(a)\nEND");
    const circuit = result.circuits[0]!;
    const simulator = new Simulator(circuit);
    render(
      <SimulatorDock
        circuit={circuit}
        snapshot={simulator.snapshot()}
        inputValues={simulator.getInputValues()}
        runtimeError={null}
        clocks={[]}
        selectedClock={null}
        onSelectClock={() => {}}
        onStep={() => {}}
        running={false}
        onToggleRun={() => {}}
        speed={2}
        onSpeedChange={() => {}}
        onInputChange={() => {}}
        onSetState={() => {}}
        onReset={() => {}}
        recording={false}
        onStartRecording={() => {}}
        onStopRecording={() => {}}
        onExpectThis={() => {}}
        displays={{}}
        onDisplayChange={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /step/i })).toBeNull();
  });

  it("records actions and offers an expect button while recording", async () => {
    const props = setup({ recording: true });
    expect(screen.getByText(/recording/)).toBeInTheDocument();
    const expectButton = screen.getAllByText("Expect this")[0]!;
    expectButton.click();
    expect(props.onExpectThis).toHaveBeenCalledWith("count", "0000");
  });

  it("starts and stops a recording", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: /record test/i }));
    expect(props.onStartRecording).toHaveBeenCalledTimes(1);
  });

  it("shows a runtime error without hiding the controls", () => {
    setup({ runtimeError: "R500: simulation stopped" });
    expect(screen.getByText(/simulation stopped/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /step/i })).toBeInTheDocument();
  });
});
