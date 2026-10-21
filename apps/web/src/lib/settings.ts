/**
 * Studio settings that are kept between visits.
 */

export type StudioMode = "beginner" | "advanced";

const MODE_KEY = "shortcircuit.mode.v1";
const EDITOR_FONT_SIZE_KEY = "shortcircuit.editorFontSize.v1";
const DISABLED_PACKAGES_KEY = "shortcircuit.disabledPackages.v1";

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
