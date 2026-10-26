import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Diagnostic } from "@shortcircuit/engine";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel";
import { formatDiagnostics } from "../lib/diagnosticsText";

const SOURCE = `CIRCUIT Demo
  INPUT a : BUS(4)
  compared = COMPARE4(a, 1000)
  OUTPUT compared.eq
END`;

const ERROR: Diagnostic = {
  code: "E305",
  severity: "error",
  message: "COMPARE4 input b needs 4 bits, but literal 1000 does not fit.",
  line: 3,
  column: 26,
  plain: {
    headline: "That value does not fit",
    detail: "The value needs more bits than the signal it is written to.",
  },
};

const WARNING: Diagnostic = {
  code: "W214",
  severity: "warning",
  message: "This signal is not read anywhere.",
  line: 2,
  column: 3,
  hint: "Remove it or read it somewhere.",
};

function renderPanel(
  diagnostics: Diagnostic[] = [ERROR, WARNING],
  overrides: Partial<{
    compiling: boolean;
    circuitCount: number;
    nodeCount: number;
    onSelect(diagnostic: Diagnostic): void;
    onApplyFix(): void;
  }> = {},
) {
  return render(
    <DiagnosticsPanel
      diagnostics={diagnostics}
      source={SOURCE}
      compiling={false}
      circuitCount={1}
      nodeCount={12}
      onSelect={() => {}}
      onApplyFix={() => {}}
      {...overrides}
    />,
  );
}

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

describe("diagnostics panel", () => {
  it("shows the code, plain headline, compiler message and source line", () => {
    const { container } = renderPanel([ERROR]);

    expect(screen.getByText("E305")).toBeInTheDocument();
    expect(screen.getByText("That value does not fit")).toBeInTheDocument();
    expect(
      screen.getByText("COMPARE4 input b needs 4 bits, but literal 1000 does not fit."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The value needs more bits than the signal it is written to."),
    ).toBeInTheDocument();
    expect(screen.getByText("L3:26")).toBeInTheDocument();
    expect(container.querySelector(".snippet-gutter")?.textContent).toBe("3");
    expect(container.querySelector(".snippet-code")?.textContent).toBe(
      "compared = COMPARE4(a, 1000)",
    );
  });

  it("formats every diagnostic as one self-contained block", () => {
    expect(formatDiagnostics([ERROR], SOURCE.split("\n"))).toBe(
      [
        "Short Circuit diagnostics · 1 error",
        "",
        "1. [error] E305 · L3:26 · That value does not fit",
        "   COMPARE4 input b needs 4 bits, but literal 1000 does not fit.",
        "   The value needs more bits than the signal it is written to.",
        "   3 | compared = COMPARE4(a, 1000)",
      ].join("\n"),
    );
  });

  it("copies every diagnostic at once", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    stubClipboard(writeText);
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));

    expect(await screen.findByRole("button", { name: /copied/i })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0]![0];
    expect(copied).toContain("Short Circuit diagnostics · 1 error · 1 warning");
    expect(copied).toContain("[error] E305 · L3:26 · That value does not fit");
    expect(copied).toContain("COMPARE4 input b needs 4 bits, but literal 1000 does not fit.");
    expect(copied).toContain("[warning] W214 · L2:3 · This signal is not read anywhere.");
    expect(copied).toContain("Remove it or read it somewhere.");
    expect(copied).toContain("3 | compared = COMPARE4(a, 1000)");
  });

  it("says so when the clipboard is blocked", async () => {
    stubClipboard(() => Promise.reject(new Error("blocked")));
    renderPanel([ERROR]);

    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));

    expect(await screen.findByRole("button", { name: /copy failed/i })).toBeInTheDocument();
  });

  it("offers no copy action when the console is clean", () => {
    renderPanel([]);

    expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
    expect(screen.getByText(/The current graph is ready to simulate/)).toBeInTheDocument();
  });

  it("collapses and expands the console", () => {
    renderPanel([ERROR]);
    const toggle = screen.getByRole("button", { name: /console/i });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByText("COMPARE4 input b needs 4 bits, but literal 1000 does not fit."),
    ).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("jumps to a diagnostic when its card is clicked", () => {
    const onSelect = vi.fn();
    renderPanel([ERROR], { onSelect });

    fireEvent.click(screen.getByText("That value does not fit"));

    expect(onSelect).toHaveBeenCalledWith(ERROR);
  });

  it("keeps a one-click fix outside the diagnostic button", () => {
    const fix = { label: "Replace with 0100", text: "0100", line: 3, column: 26, length: 4 };
    const fixable: Diagnostic = {
      ...ERROR,
      plain: { ...ERROR.plain!, fix },
    };
    const onApplyFix = vi.fn();
    const { container } = renderPanel([fixable], { onApplyFix });

    for (const button of container.querySelectorAll("button")) {
      expect(button.querySelector("button")).toBeNull();
    }

    const action = screen.getByRole("button", { name: "Replace with 0100" });
    fireEvent.click(action);

    expect(onApplyFix).toHaveBeenCalledWith(fix);
  });
});
