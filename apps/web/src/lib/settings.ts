/**
 * Studio settings that are kept between visits.
 */

export type StudioMode = "beginner" | "advanced";

const MODE_KEY = "shortcircuit.mode.v1";

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
