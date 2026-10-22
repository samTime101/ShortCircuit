import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULT_EDITOR_FONT_SIZE,
  DEFAULT_SIM_DOCK_HEIGHT,
  DEFAULT_SIM_SPLIT,
  MAX_EDITOR_FONT_SIZE,
  MAX_SIM_DOCK_HEIGHT,
  MAX_SIM_SPLIT,
  MIN_EDITOR_FONT_SIZE,
  MIN_SIM_DOCK_HEIGHT,
  MIN_SIM_SPLIT,
  clampEditorFontSize,
  clampSimDockHeight,
  clampSimSplit,
  readEditorFontSize,
  readSimDockHeight,
  readSimSplit,
  writeEditorFontSize,
  writeSimDockHeight,
  writeSimSplit,
} from "../lib/settings";

const FONT_SIZE_KEY = "shortcircuit.editorFontSize.v1";
const SIM_DOCK_HEIGHT_KEY = "shortcircuit.simDockHeight.v1";
const SIM_SPLIT_KEY = "shortcircuit.simSplit.v1";

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

describe("simulator layout settings", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("clamps the dock height and the column split", () => {
    expect(clampSimDockHeight(MIN_SIM_DOCK_HEIGHT - 40)).toBe(MIN_SIM_DOCK_HEIGHT);
    expect(clampSimDockHeight(MAX_SIM_DOCK_HEIGHT + 40)).toBe(MAX_SIM_DOCK_HEIGHT);
    expect(clampSimDockHeight(240.6)).toBe(241);
    expect(clampSimDockHeight(Number.NaN)).toBe(DEFAULT_SIM_DOCK_HEIGHT);

    expect(clampSimSplit(MIN_SIM_SPLIT - 10)).toBe(MIN_SIM_SPLIT);
    expect(clampSimSplit(MAX_SIM_SPLIT + 10)).toBe(MAX_SIM_SPLIT);
    expect(clampSimSplit(58.25)).toBe(58.25);
    expect(clampSimSplit(Number.NaN)).toBe(DEFAULT_SIM_SPLIT);
  });

  it("starts with a dock that leaves room for the graph", () => {
    expect(DEFAULT_SIM_DOCK_HEIGHT).toBeLessThan(400);
    expect(DEFAULT_SIM_SPLIT).toBe(50);
    expect(readSimDockHeight()).toBe(DEFAULT_SIM_DOCK_HEIGHT);
    expect(readSimSplit()).toBe(DEFAULT_SIM_SPLIT);
  });

  it("remembers the chosen layout between visits", () => {
    writeSimDockHeight(360);
    writeSimSplit(62);
    expect(window.localStorage.getItem(SIM_DOCK_HEIGHT_KEY)).toBe("360");
    expect(window.localStorage.getItem(SIM_SPLIT_KEY)).toBe("62");
    expect(readSimDockHeight()).toBe(360);
    expect(readSimSplit()).toBe(62);
  });

  it("stores clamped values and ignores corrupted ones", () => {
    writeSimDockHeight(5000);
    expect(readSimDockHeight()).toBe(MAX_SIM_DOCK_HEIGHT);
    writeSimDockHeight(1);
    expect(readSimDockHeight()).toBe(MIN_SIM_DOCK_HEIGHT);

    writeSimSplit(5);
    expect(readSimSplit()).toBe(MIN_SIM_SPLIT);
    writeSimSplit(99);
    expect(readSimSplit()).toBe(MAX_SIM_SPLIT);

    window.localStorage.setItem(SIM_DOCK_HEIGHT_KEY, "huge");
    window.localStorage.setItem(SIM_SPLIT_KEY, "wide");
    expect(readSimDockHeight()).toBe(DEFAULT_SIM_DOCK_HEIGHT);
    expect(readSimSplit()).toBe(DEFAULT_SIM_SPLIT);
  });
});
