import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { compile, Simulator } from "@shortcircuit/engine";
import { WaveformPanel } from "../components/WaveformPanel";
import { sampleFromSnapshot, type TraceSample } from "../lib/trace";

const SOURCE = `IMPORT "@shortcircuit/arithmetic"

CIRCUIT Counter4
INPUT clock
STATE count : BUS(4) = 0000
incremented = ADD4(count, 0, 1)
ON RISING_EDGE(clock):
  count = incremented.sum
END
OUTPUT count
END`;

function trace(): { circuit: ReturnType<typeof compile>["circuits"][number]; samples: TraceSample[] } {
  const circuit = compile(SOURCE).circuits[0]!;
  const simulator = new Simulator(circuit);
  const samples = [sampleFromSnapshot(simulator.snapshot(), "start")];
  const rising = simulator.setInput("clock", "1");
  samples.push(sampleFromSnapshot(rising, "clock"));
  return { circuit, samples };
}

describe("waveform panel", () => {
  it("draws a row for every signal and marks the edges", () => {
    const { circuit, samples } = trace();
    const { container } = render(
      <WaveformPanel circuit={circuit} trace={samples} onDownload={() => {}} />,
    );
    const names = [...container.querySelectorAll(".wave-name")].map((node) => node.textContent);
    expect(names).toContain("clock");
    expect(names).toContain("count");
    expect(container.querySelectorAll(".wave-edge.is-rising").length).toBe(1);
    expect(container.querySelectorAll(".wave-bus-value").length).toBeGreaterThan(0);
  });

  it("offers VCD and JSON exports", () => {
    const { circuit, samples } = trace();
    const onDownload = vi.fn();
    render(<WaveformPanel circuit={circuit} trace={samples} onDownload={onDownload} />);

    const vcd = screen.getByRole("button", { name: /export vcd/i });
    vcd.click();
    expect(onDownload).toHaveBeenCalledWith(
      "Counter4.vcd",
      expect.stringContaining("$var wire 4"),
      "text/plain;charset=utf-8",
    );

    const json = screen.getByRole("button", { name: /export json/i });
    json.click();
    expect(onDownload).toHaveBeenCalledWith(
      "Counter4-trace.json",
      expect.stringContaining("shortcircuit.trace/v1"),
      "application/json",
    );
  });

  it("only mounts a window of a long trace and pages through it", () => {
    const { circuit, samples } = trace();
    const longTrace = Array.from({ length: 500 }, (_, index) => ({
      ...samples[index % samples.length]!,
      label: `sample-${index}`,
    }));

    const { container } = render(
      <WaveformPanel circuit={circuit} trace={longTrace} onDownload={() => {}} />,
    );

    expect(container.querySelectorAll(".wave-axis")).toHaveLength(200);
    expect(screen.getByText(/Showing samples 301–500 of 500/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Earlier" }));
    expect(container.querySelectorAll(".wave-axis")).toHaveLength(200);
    expect(screen.getByText(/Showing samples 101–300 of 500/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Latest" }));
    expect(screen.getByText(/Showing samples 301–500 of 500/)).toBeInTheDocument();
  });

  it("explains that nothing has been recorded yet", () => {
    const { circuit } = trace();
    render(<WaveformPanel circuit={circuit} trace={[]} onDownload={() => {}} />);
    expect(screen.getByText(/No trace yet/)).toBeInTheDocument();
  });
});
