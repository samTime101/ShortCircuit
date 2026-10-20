import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TruthTable } from "@shortcircuit/engine";
import { TruthTablePanel } from "../components/TruthTablePanel";

const TABLE: TruthTable = {
  circuit: "HalfAdder",
  inputBits: 2,
  inputs: [
    { name: "a", width: 1 },
    { name: "b", width: 1 },
  ],
  outputs: [
    { name: "sum", width: 1 },
    { name: "carry", width: 1 },
  ],
  rows: [
    { input: { a: "0", b: "0" }, output: { sum: "0", carry: "0" } },
    { input: { a: "0", b: "1" }, output: { sum: "1", carry: "0" } },
    { input: { a: "1", b: "0" }, output: { sum: "1", carry: "0" } },
    { input: { a: "1", b: "1" }, output: { sum: "0", carry: "1" } },
  ],
  truncated: false,
};

describe("truth table panel", () => {
  it("renders every row and the footnote", () => {
    render(<TruthTablePanel table={TABLE} />);
    expect(screen.getAllByRole("row")).toHaveLength(TABLE.rows.length + 1);
    expect(screen.getByText(/4 exhaustive rows/)).toBeInTheDocument();
  });

  it("explains why a table is missing", () => {
    render(
      <TruthTablePanel
        table={{
          ...TABLE,
          rows: [],
          truncated: true,
          reason: "This circuit has 18 input bits.",
        }}
      />,
    );
    expect(screen.getByText(/18 input bits/)).toBeInTheDocument();
    expect(screen.queryByRole("row")).toBeNull();
  });

  it("shows an empty state when there is no table", () => {
    render(<TruthTablePanel table={null} />);
    expect(screen.getByText(/No truth table yet/)).toBeInTheDocument();
  });
});
