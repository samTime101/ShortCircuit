import { describe, expect, it } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { SourceEditor } from "../editor/SourceEditor";

function renderEditor(fontSize: number) {
  return render(
    <SourceEditor
      value={"CIRCUIT HalfAdder\nEND"}
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
});
