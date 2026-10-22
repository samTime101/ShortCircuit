/**
 * Studio settings that are kept between visits.
 */

export type StudioMode = "beginner" | "advanced";

const MODE_KEY = "shortcircuit.mode.v1";
const EDITOR_FONT_SIZE_KEY = "shortcircuit.editorFontSize.v1";
const DISABLED_PACKAGES_KEY = "shortcircuit.disabledPackages.v1";
const SIM_DOCK_HEIGHT_KEY = "shortcircuit.simDockHeight.v1";
const SIM_SPLIT_KEY = "shortcircuit.simSplit.v1";

/** The editor starts a touch larger than the interface body text. */
export const DEFAULT_EDITOR_FONT_SIZE = 15;
export const MIN_EDITOR_FONT_SIZE = 12;
export const MAX_EDITOR_FONT_SIZE = 22;
export const EDITOR_FONT_SIZE_STEP = 1;

export function readMode(): StudioMode {
  try {
    return window.localStorage.getItem(MODE_KEY) === "beginner" ? "beginner" : "advanced";
  } catch {
    return "advanced";
  }
}

export function writeMode(mode: StudioMode): void {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // The mode is a convenience; a browser that refuses writes still works.
  }
}

/** Keeps a requested editor font size inside the range the studio supports. */
export function clampEditorFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_EDITOR_FONT_SIZE;
  return Math.min(
    MAX_EDITOR_FONT_SIZE,
    Math.max(MIN_EDITOR_FONT_SIZE, Math.round(size)),
  );
}

export function readEditorFontSize(): number {
  try {
    const raw = window.localStorage.getItem(EDITOR_FONT_SIZE_KEY);
    if (raw === null) return DEFAULT_EDITOR_FONT_SIZE;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_EDITOR_FONT_SIZE;
    return clampEditorFontSize(parsed);
  } catch {
    return DEFAULT_EDITOR_FONT_SIZE;
  }
}

export function writeEditorFontSize(size: number): void {
  try {
    window.localStorage.setItem(EDITOR_FONT_SIZE_KEY, String(clampEditorFontSize(size)));
  } catch {
    // The font size is a convenience; a browser that refuses writes still works.
  }
}

/** The simulator dock starts tall enough for a few rows but leaves the graph room. */
export const DEFAULT_SIM_DOCK_HEIGHT = 300;
export const MIN_SIM_DOCK_HEIGHT = 150;
export const MAX_SIM_DOCK_HEIGHT = 900;

/** The input column starts at half the dock and stays usable either way. */
export const DEFAULT_SIM_SPLIT = 50;
export const MIN_SIM_SPLIT = 25;
export const MAX_SIM_SPLIT = 75;

/** Keeps a requested simulator dock height inside the range the studio supports. */
export function clampSimDockHeight(height: number): number {
  if (!Number.isFinite(height)) return DEFAULT_SIM_DOCK_HEIGHT;
  return Math.min(MAX_SIM_DOCK_HEIGHT, Math.max(MIN_SIM_DOCK_HEIGHT, Math.round(height)));
}

export function readSimDockHeight(): number {
  try {
    const raw = window.localStorage.getItem(SIM_DOCK_HEIGHT_KEY);
    if (raw === null) return DEFAULT_SIM_DOCK_HEIGHT;
    return clampSimDockHeight(Number.parseInt(raw, 10));
  } catch {
    return DEFAULT_SIM_DOCK_HEIGHT;
  }
}

export function writeSimDockHeight(height: number): void {
  try {
    window.localStorage.setItem(SIM_DOCK_HEIGHT_KEY, String(clampSimDockHeight(height)));
  } catch {
    // The dock height is a convenience; a browser that refuses writes still works.
  }
}

/** Keeps the input column wide enough to read and the output column wide enough to use. */
export function clampSimSplit(split: number): number {
  if (!Number.isFinite(split)) return DEFAULT_SIM_SPLIT;
  return Math.min(MAX_SIM_SPLIT, Math.max(MIN_SIM_SPLIT, split));
}

export function readSimSplit(): number {
  try {
    const raw = window.localStorage.getItem(SIM_SPLIT_KEY);
    if (raw === null) return DEFAULT_SIM_SPLIT;
    return clampSimSplit(Number.parseFloat(raw));
  } catch {
    return DEFAULT_SIM_SPLIT;
  }
}

export function writeSimSplit(split: number): void {
  try {
    const clamped = clampSimSplit(split);
    window.localStorage.setItem(SIM_SPLIT_KEY, String(Math.round(clamped * 10) / 10));
  } catch {
    // The split is a convenience; a browser that refuses writes still works.
  }
}

/** Package names the user has switched off in the package manager. */
export function readDisabledPackages(): string[] {
  try {
    const raw = window.localStorage.getItem(DISABLED_PACKAGES_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0))];
  } catch {
    return [];
  }
}

export function writeDisabledPackages(names: string[]): void {
  try {
    window.localStorage.setItem(DISABLED_PACKAGES_KEY, JSON.stringify([...new Set(names)]));
  } catch {
    // Package choices are a convenience; a browser that refuses writes still works.
  }
}
