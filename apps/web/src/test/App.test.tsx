import { describe, expect, it, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";
import App from "../App";

const STORAGE_KEY = "shortcircuit.source.v1";
const FONT_SIZE_KEY = "shortcircuit.editorFontSize.v1";
const SIM_DOCK_HEIGHT_KEY = "shortcircuit.simDockHeight.v1";
const SIM_SPLIT_KEY = "shortcircuit.simSplit.v1";

const HALF_ADDER = `IMPORT "@shortcircuit/gates"

CIRCUIT HalfAdder
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

const BROKEN = `IMPORT "@shortcircuit/gates"

CIRCUIT HalfAdder
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
      expect(screen.getByText(/Errors detected/)).toBeInTheDocument();
    });
    expect(screen.getAllByText(/Unknown signal "missing"/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Toggle a" })).toBeNull();
  });

  it("shows each error once and points at the console", async () => {
    store(`IMPORT "@shortcircuit/comparison"

CIRCUIT Demo
INPUT a : BUS(4)
compared = COMPARE4(a, 1000)
OUTPUT compared.eq
END

CIRCUIT Wrapper
INPUT a : BUS(4)
inner = Demo(a)
OUTPUT inner.compared.eq
END`);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Errors detected/)).toBeInTheDocument();
    });

    // The error lives in Demo and is reported once, not again for Wrapper.
    expect(document.querySelectorAll(".diagnostic-item")).toHaveLength(1);

    // The paused view points at the console instead of repeating the error.
    const paused = document.querySelector(".inspection-fatal");
    expect(paused?.textContent).toContain("Errors detected");
    expect(paused?.textContent).toContain("Check the error console and fix them.");
    expect(paused?.textContent).not.toContain("COMPARE4 input b needs");
  });

  it("adds and removes a package import from the package manager", async () => {
    store(HALF_ADDER);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Evaluation graph")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Packages" }));
    expect(screen.getByRole("dialog", { name: "Installed packages" })).toBeInTheDocument();

    const gates = screen.getByRole("checkbox", { name: "@shortcircuit/gates" });
    expect(gates).toBeChecked();

    await userEvent.click(gates);
    await waitFor(() => {
      expect(screen.getByText(/Errors detected/)).toBeInTheDocument();
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toContain(
      'IMPORT "@shortcircuit/gates"',
    );

    await userEvent.click(gates);
    await waitFor(() => {
      expect(screen.getByText("Evaluation graph")).toBeInTheDocument();
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain(
      'IMPORT "@shortcircuit/gates"',
    );
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
    store(`IMPORT "@shortcircuit/gates"

CIRCUIT First
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
    store(`IMPORT "@shortcircuit/gates"

CIRCUIT HalfAdder
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

  it("resizes the simulator dock and keeps the choice", async () => {
    store(HALF_ADDER);
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Evaluation graph")).toBeInTheDocument();
    });

    const pane = document.querySelector(".sim-pane") as HTMLElement;
    expect(pane.style.height).toBe("300px");

    const bar = screen.getByRole("separator", {
      name: "Resize the simulation panel and graph",
    });
    fireEvent.pointerDown(bar, { button: 0, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(bar, { clientY: 340, pointerId: 1 });
    fireEvent.pointerUp(bar, { pointerId: 1 });

    expect(pane.style.height).toBe("240px");
    await waitFor(() => {
      expect(window.localStorage.getItem(SIM_DOCK_HEIGHT_KEY)).toBe("240");
    });

    // Arrow keys move by a fixed step, and Home goes to the smallest size.
    fireEvent.keyDown(bar, { key: "ArrowDown" });
    expect(pane.style.height).toBe("256px");
    fireEvent.keyDown(bar, { key: "Home" });
    expect(pane.style.height).toBe("150px");
    fireEvent.doubleClick(bar);
    expect(pane.style.height).toBe("300px");
  });

  it("resizes the input and output columns and keeps the choice", async () => {
    store(HALF_ADDER);
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Evaluation graph")).toBeInTheDocument();
    });

    const columns = document.querySelector(".sim-columns") as HTMLElement;
    expect(columns.style.getPropertyValue("--sim-split")).toBe("50%");

    const bar = screen.getByRole("separator", {
      name: "Resize the input and output columns",
    });
    fireEvent.keyDown(bar, { key: "ArrowRight" });
    expect(columns.style.getPropertyValue("--sim-split")).toBe("52%");
    await waitFor(() => {
      expect(window.localStorage.getItem(SIM_SPLIT_KEY)).toBe("52");
    });

    fireEvent.keyDown(bar, { key: "End" });
    expect(columns.style.getPropertyValue("--sim-split")).toBe("75%");
    fireEvent.doubleClick(bar);
    expect(columns.style.getPropertyValue("--sim-split")).toBe("50%");
  });

  it("restores the simulator sizes on the next visit", async () => {
    store(HALF_ADDER);
    window.localStorage.setItem(SIM_DOCK_HEIGHT_KEY, "420");
    window.localStorage.setItem(SIM_SPLIT_KEY, "62");
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Evaluation graph")).toBeInTheDocument();
    });

    expect((document.querySelector(".sim-pane") as HTMLElement).style.height).toBe("420px");
    expect(
      (document.querySelector(".sim-columns") as HTMLElement).style.getPropertyValue("--sim-split"),
    ).toBe("62%");
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
