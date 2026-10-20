import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULT_EDITOR_FONT_SIZE,
  MAX_EDITOR_FONT_SIZE,
  MIN_EDITOR_FONT_SIZE,
  clampEditorFontSize,
  readEditorFontSize,
  writeEditorFontSize,
} from "../lib/settings";

const FONT_SIZE_KEY = "shortcircuit.editorFontSize.v1";

describe("editor font size settings", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("starts larger than the interface body text", () => {
    expect(DEFAULT_EDITOR_FONT_SIZE).toBeGreaterThan(13.5);
    expect(readEditorFontSize()).toBe(DEFAULT_EDITOR_FONT_SIZE);
  });

  it("keeps a requested size inside the supported range", () => {
    expect(clampEditorFontSize(MIN_EDITOR_FONT_SIZE - 6)).toBe(MIN_EDITOR_FONT_SIZE);
    expect(clampEditorFontSize(MAX_EDITOR_FONT_SIZE + 6)).toBe(MAX_EDITOR_FONT_SIZE);
    expect(clampEditorFontSize(17)).toBe(17);
    expect(clampEditorFontSize(17.4)).toBe(17);
  });

  it("falls back to the default for a size that is not a number", () => {
    expect(clampEditorFontSize(Number.NaN)).toBe(DEFAULT_EDITOR_FONT_SIZE);
    expect(clampEditorFontSize(Number.POSITIVE_INFINITY)).toBe(DEFAULT_EDITOR_FONT_SIZE);
  });

  it("remembers the chosen size between visits", () => {
    writeEditorFontSize(19);
    expect(window.localStorage.getItem(FONT_SIZE_KEY)).toBe("19");
    expect(readEditorFontSize()).toBe(19);
  });

  it("stores a clamped size", () => {
    writeEditorFontSize(MAX_EDITOR_FONT_SIZE + 10);
    expect(readEditorFontSize()).toBe(MAX_EDITOR_FONT_SIZE);

    writeEditorFontSize(MIN_EDITOR_FONT_SIZE - 10);
    expect(readEditorFontSize()).toBe(MIN_EDITOR_FONT_SIZE);
  });

  it("ignores a corrupted stored size", () => {
    window.localStorage.setItem(FONT_SIZE_KEY, "not-a-number");
    expect(readEditorFontSize()).toBe(DEFAULT_EDITOR_FONT_SIZE);
  });
});
