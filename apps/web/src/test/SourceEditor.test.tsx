import { describe, expect, it } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { completionStatus, startCompletion } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { SourceEditor } from "../editor/SourceEditor";

/** A source with a half typed operation, ready for the completion popup. */
const COMPLETION_SOURCE = `CIRCUIT Test
  INPUT a
  NAN
  OUTPUT a
END`;

function renderEditor(fontSize: number, value = "CIRCUIT HalfAdder\nEND") {
  return render(
    <SourceEditor
      value={value}
      diagnostics={[]}
      fontSize={fontSize}
      onChange={() => {}}
      onRun={() => {}}
    />,
  );
}

function editorFontSize(): string {
  const editor = document.querySelector(".cm-editor");
  expect(editor).not.toBeNull();
  return getComputedStyle(editor as Element).fontSize;
}

function editorView(): EditorView {
  const editor = document.querySelector(".cm-editor");
  expect(editor).not.toBeNull();
  const view = EditorView.findFromDOM(editor as HTMLElement);
  expect(view).not.toBeNull();
  return view as EditorView;
}

/** Opens the completion popup on the half typed operation in line three. */
async function openCompletion(view: EditorView) {
  view.dispatch({ selection: { anchor: view.state.doc.line(3).to } });
  startCompletion(view);
  await waitFor(() => {
    expect(completionStatus(view.state)).toBe("active");
  });
  // The popup ignores keys pressed in the moment it opens.
  await new Promise((resolve) => setTimeout(resolve, 120));
}

function pressKey(view: EditorView, key: string, code: string, keyCode: number) {
  const event = new KeyboardEvent("keydown", {
    key,
    code,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "keyCode", { get: () => keyCode });
  Object.defineProperty(event, "which", { get: () => keyCode });
  view.contentDOM.dispatchEvent(event);
  return event;
}

describe("source editor", () => {
  it("mounts the code surface", async () => {
    renderEditor(15);
    await waitFor(() => {
      expect(document.querySelector(".cm-content")).not.toBeNull();
    });
    expect(document.querySelector(".cm-content")?.textContent).toContain("CIRCUIT HalfAdder");
  });

  it("renders the source at the requested font size", async () => {
    renderEditor(19);
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });
    expect(editorFontSize()).toBe("19px");
  });

  it("rescales without rebuilding the editor", async () => {
    const { rerender } = renderEditor(15);
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });
    expect(editorFontSize()).toBe("15px");

    rerender(
      <SourceEditor
        value={"CIRCUIT HalfAdder\nEND"}
        diagnostics={[]}
        fontSize={18}
        onChange={() => {}}
        onRun={() => {}}
      />,
    );

    await waitFor(() => {
      expect(editorFontSize()).toBe("18px");
    });
  });

  it("scales the gutter with the editor text", async () => {
    renderEditor(20);
    await waitFor(() => {
      expect(document.querySelector(".cm-lineNumbers .cm-gutterElement")).not.toBeNull();
    });
    const gutter = document.querySelector(
      ".cm-lineNumbers .cm-gutterElement",
    ) as Element;
    expect(getComputedStyle(gutter).fontSize).toBe("17px");
  });

  it("follows a new source value from the studio", async () => {
    const { rerender } = renderEditor(15);
    await waitFor(() => {
      expect(document.querySelector(".cm-content")).not.toBeNull();
    });
    expect(document.querySelector(".cm-content")?.textContent).toContain("CIRCUIT HalfAdder");

    rerender(
      <SourceEditor
        value={"CIRCUIT Other\nEND"}
        diagnostics={[]}
        fontSize={15}
        onChange={() => {}}
        onRun={() => {}}
      />,
    );

    await waitFor(() => {
      expect(document.querySelector(".cm-content")?.textContent).toContain("CIRCUIT Other");
    });
  });

  it("accepts the highlighted completion with the tab key", async () => {
    renderEditor(15, COMPLETION_SOURCE);
    await waitFor(() => {
      expect(document.querySelector(".cm-content")).not.toBeNull();
    });

    const view = editorView();
    await openCompletion(view);

    pressKey(view, "Tab", "Tab", 9);

    expect(view.state.doc.toString()).toContain("  NAND\n");
    expect(view.state.doc.toString()).not.toContain("  NAN\n");
  });

  it("inserts a newline with the enter key instead of accepting a completion", async () => {
    renderEditor(15, COMPLETION_SOURCE);
    await waitFor(() => {
      expect(document.querySelector(".cm-content")).not.toBeNull();
    });

    const view = editorView();
    await openCompletion(view);
    const lines = view.state.doc.lines;

    pressKey(view, "Enter", "Enter", 13);

    expect(view.state.doc.lines).toBe(lines + 1);
    expect(view.state.doc.toString()).not.toContain("NAND");
  });
});
