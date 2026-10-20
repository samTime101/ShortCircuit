import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TestRunResult } from "@shortcircuit/engine";
import { TestsPanel } from "../components/TestsPanel";

const PASSING: TestRunResult = {
  ok: true,
  suites: [
    {
      name: "Counter4",
      circuit: "Counter4",
      pass: true,
      runnable: true,
      line: 10,
      cases: [
        {
          label: "counts three ticks",
          line: 11,
          pass: true,
          rows: [
            { kind: "input", name: "clock", actual: "3 cycles", width: 1, line: 14, step: 3 },
            { kind: "expect", name: "count", expected: "0011", actual: "0011", width: 4, pass: true, line: 15, step: 3 },
          ],
        },
      ],
    },
  ],
  passed: 1,
  failed: 0,
  unsupported: 0,
  elapsedMs: 1.2,
};

const FAILING: TestRunResult = {
  ok: false,
  suites: [
    {
      name: "Shift",
      circuit: "Shift",
      pass: false,
      runnable: true,
      line: 4,
      cases: [
        {
          label: "wrong expectation",
          line: 5,
          pass: false,
          step: 1,
          error: "EXPECT q: expected 1111, got 0001",
          rows: [
            { kind: "expect", name: "q", expected: "1111", actual: "0001", width: 4, pass: false, line: 6, step: 1 },
          ],
        },
      ],
    },
  ],
  passed: 0,
  failed: 1,
  unsupported: 0,
  elapsedMs: 0.8,
};

describe("tests panel", () => {
  it("shows a passing suite with its rows", () => {
    render(<TestsPanel result={PASSING} />);
    expect(screen.getByText("All passing")).toBeInTheDocument();
    expect(screen.getByText("counts three ticks")).toBeInTheDocument();
    expect(screen.getAllByText("STEP 3").length).toBeGreaterThan(0);
  });

  it("shows the failing step and both values", () => {
    render(<TestsPanel result={FAILING} />);
    expect(screen.getByText(/failed at step 1/)).toBeInTheDocument();
    expect(screen.getByText("1111")).toBeInTheDocument();
    expect(screen.getByText("0001")).toBeInTheDocument();
    expect(screen.getByText(/expected 1111, got 0001/)).toBeInTheDocument();
  });

  it("explains an empty test bench", () => {
    render(
      <TestsPanel result={{ ok: true, suites: [], passed: 0, failed: 0, unsupported: 0, elapsedMs: 0 }} />,
    );
    expect(screen.getByText(/No test cases yet/)).toBeInTheDocument();
  });
});
