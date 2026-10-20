import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";

const STORAGE_KEY = "shortcircuit.source.v1";

const HALF_ADDER = `CIRCUIT HalfAdder
INPUT a
INPUT b
sum = XOR(a, b)
carry = AND(a, b)
OUTPUT sum
OUTPUT carry
END

TEST HalfAdder
CASE "both high"
  INPUT a = 1
  INPUT b = 1
  EXPECT sum = 0
  EXPECT carry = 1
END
END`;

const BROKEN = `CIRCUIT HalfAdder
INPUT a
sum = XOR(a, missing)
OUTPUT sum
END`;

function store(source: string) {
  window.localStorage.setItem(STORAGE_KEY, source);
}

describe("studio app", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("compiles the stored source and simulates it", async () => {
    store(HALF_ADDER);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Evaluation graph")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Toggle a" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Toggle b" })).toBeInTheDocument();
    expect(screen.getAllByText("sum").length).toBeGreaterThan(0);
  });

  it("reports diagnostics and stops the simulation for broken source", async () => {
    store(BROKEN);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Simulation paused/)).toBeInTheDocument();
    });
    expect(screen.getAllByText(/Unknown signal "missing"/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Toggle a" })).toBeNull();
  });

  it("opens the documentation page and returns to the studio", async () => {
    store(HALF_ADDER);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Evaluation graph")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /docs/i }));
    await waitFor(() => {
      expect(screen.getByText("LogicFlow, in full")).toBeInTheDocument();
    });

    await userEvent.click(screen.getAllByRole("button", { name: /back to studio/i })[0]!);
    await waitFor(() => {
      expect(screen.getByText("Evaluation graph")).toBeInTheDocument();
    });
  });

  it("switches between the inspection tabs", async () => {
    store(HALF_ADDER);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Evaluation graph")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("tab", { name: /truth table/i }));
    await waitFor(() => {
      expect(screen.getByText("Exhaustive behavior")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("tab", { name: /tests/i }));
    await waitFor(() => {
      expect(screen.getByText("Test bench")).toBeInTheDocument();
    });
  });

  it("explains a typo in plain language and fixes it in one click", async () => {
    store(`CIRCUIT HalfAdder
INPUT a
INPUT b
sum = XOR(a, b)
carry = AND(a, b)
OUTPUT sum
OUTPUT cary
END`);
    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText(/no signal with that name/i).length).toBeGreaterThan(0);
    });

    const fix = screen.getByText(/replace with/i);
    await userEvent.click(fix);

    await waitFor(() => {
      expect(window.localStorage.getItem(STORAGE_KEY)).toContain("OUTPUT carry");
    });
  });

  it("offers a skip link and a named workbench", async () => {
    store(HALF_ADDER);
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Evaluation graph")).toBeInTheDocument();
    });
    const skip = screen.getByRole("link", { name: /skip to the workbench/i });
    expect(skip).toHaveAttribute("href", "#workbench");
    expect(document.getElementById("workbench")).not.toBeNull();
  });

  it("keeps the source in local storage", async () => {
    store(HALF_ADDER);
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Evaluation graph")).toBeInTheDocument();
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(HALF_ADDER);
  });
});
