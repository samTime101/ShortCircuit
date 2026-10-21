import { describe, expect, it, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";
import App from "../App";

const STORAGE_KEY = "shortcircuit.source.v1";
const FONT_SIZE_KEY = "shortcircuit.editorFontSize.v1";

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

  it("disables a package from the package manager and recompiles", async () => {
    store(HALF_ADDER);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Evaluation graph")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Packages" }));
    expect(screen.getByRole("dialog", { name: "Installed packages" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: "@shortcircuit/gates" }));
    await waitFor(() => {
      expect(screen.getByText(/Simulation paused/)).toBeInTheDocument();
    });
    expect(window.localStorage.getItem("shortcircuit.disabledPackages.v1")).toContain(
      "@shortcircuit/gates",
    );

    await userEvent.click(screen.getByRole("checkbox", { name: "@shortcircuit/gates" }));
    await waitFor(() => {
      expect(screen.getByText("Evaluation graph")).toBeInTheDocument();
    });
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

  it("switches the active circuit from the circuit picker", async () => {
    store(`CIRCUIT First
INPUT a
INPUT b
sum = XOR(a, b)
OUTPUT sum
END

CIRCUIT Second
INPUT a
INPUT b
carry = AND(a, b)
OUTPUT carry
END`);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Evaluation graph")).toBeInTheDocument();
    });

    const picker = screen.getByRole("combobox", { name: /active circuit: first/i });
    await userEvent.click(picker);
    expect(screen.getByRole("listbox", { name: "Circuits" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("option", { name: "Second" }));

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /active circuit: second/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole("listbox", { name: "Circuits" })).toBeNull();
  });

  it("closes the circuit picker with escape", async () => {
    store(HALF_ADDER);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Evaluation graph")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("combobox", { name: /active circuit/i }));
    expect(screen.getByRole("listbox", { name: "Circuits" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: "Circuits" })).toBeNull();
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

  it("maximizes the editor and gives the workbench back", async () => {
    store(HALF_ADDER);
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Evaluation graph")).toBeInTheDocument();
    });

    const inspection = document.querySelector(".inspection-pane");
    const workbench = document.querySelector(".app-main");
    expect(inspection).not.toBeNull();
    expect(inspection).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Maximize editor" }));

    expect(screen.getByRole("button", { name: "Restore editor" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(workbench).toHaveClass("is-editor-max");
    expect(inspection).not.toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Restore editor" }));

    expect(screen.getByRole("button", { name: "Maximize editor" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(workbench).not.toHaveClass("is-editor-max");
    expect(inspection).toBeVisible();
  });

  it("leaves the maximized editor with the escape key", async () => {
    store(HALF_ADDER);
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Evaluation graph")).toBeInTheDocument();
    });

    const inspection = document.querySelector(".inspection-pane");
    await userEvent.click(screen.getByRole("button", { name: "Maximize editor" }));
    expect(document.querySelector(".app-main")).toHaveClass("is-editor-max");
    expect(inspection).not.toBeVisible();

    await userEvent.keyboard("{Escape}");

    expect(document.querySelector(".app-main")).not.toHaveClass("is-editor-max");
    expect(inspection).toBeVisible();
  });

  it("resizes the editor text and keeps the choice", async () => {
    store(HALF_ADDER);
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Evaluation graph")).toBeInTheDocument();
    });

    const readout = screen.getByRole("button", { name: /Editor font size \d+ pixels/ });
    expect(readout).toHaveTextContent("15px");

    await userEvent.click(screen.getByRole("button", { name: "Increase editor font size" }));
    expect(readout).toHaveTextContent("16px");
    expect(window.localStorage.getItem(FONT_SIZE_KEY)).toBe("16");

    await userEvent.click(screen.getByRole("button", { name: "Decrease editor font size" }));
    expect(readout).toHaveTextContent("15px");

    await userEvent.click(screen.getByRole("button", { name: /Editor font size \d+ pixels/ }));
    expect(readout).toHaveTextContent("15px");
  });

  it("restores the editor text size on the next visit", async () => {
    store(HALF_ADDER);
    window.localStorage.setItem(FONT_SIZE_KEY, "19");
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Evaluation graph")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /Editor font size \d+ pixels/ })).toHaveTextContent(
      "19px",
    );
  });

  it("migrates a source saved with the old comment marker", async () => {
    store(`# an old style comment
${HALF_ADDER}`);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Evaluation graph")).toBeInTheDocument();
    });
    expect(screen.queryAllByText(/not a comment/i).length).toBe(0);
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain("// an old style comment");
  });

  it("does not add a line below the source when the keyboard formats it", async () => {
    store(`CIRCUIT HalfAdder
INPUT a
OUTPUT a
END`);
    render(<App />);

    await waitFor(() => {
      expect(document.querySelector(".cm-content")).not.toBeNull();
    });

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });

    await waitFor(() => {
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
        "CIRCUIT HalfAdder\n  INPUT a\n  OUTPUT a\nEND",
      );
    });
    expect(document.querySelectorAll(".cm-line")).toHaveLength(4);

    // A second run has nothing left to change.
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByText("Source is already formatted")).toBeInTheDocument();
    });
    expect(document.querySelectorAll(".cm-line")).toHaveLength(4);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      "CIRCUIT HalfAdder\n  INPUT a\n  OUTPUT a\nEND",
    );
  });

  it("drops the error mark once the source is fixed", async () => {
    store(`CIRCUIT HalfAdder
INPUT a
OUTPUT a
END`);
    render(<App />);

    await waitFor(() => {
      expect(document.querySelector(".cm-content")).not.toBeNull();
    });
    const view = EditorView.findFromDOM(
      document.querySelector(".cm-editor") as HTMLElement,
    )!;

    // Break the circuit: the END is gone.
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "CIRCUIT HalfAdder" },
    });

    await waitFor(
      () => {
        expect(document.querySelectorAll(".cm-lintRange-error")).toHaveLength(1);
      },
      { timeout: 4000 },
    );

    // Fix it again. The mark of the broken source must not stay on screen.
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: "CIRCUIT HalfAdder\nINPUT a\nOUTPUT a\nEND",
      },
    });

    await waitFor(
      () => {
        expect(document.querySelectorAll(".cm-lintRange-error")).toHaveLength(0);
      },
      { timeout: 4000 },
    );
  });
});
