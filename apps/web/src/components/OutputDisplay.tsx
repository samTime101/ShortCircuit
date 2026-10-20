import { useMemo } from "react";

/**
 * Output displays.
 *
 * A value can be shown as a number, as LEDs, as a seven-segment digit, as a
 * bar, or as a grid of cells. The mode is chosen per output and kept with the
 * project.
 */

export type DisplayMode = "number" | "led" | "seven" | "bar" | "grid";

export const DISPLAY_MODES: Array<{ value: DisplayMode; label: string }> = [
  { value: "number", label: "Number" },
  { value: "led", label: "LEDs" },
  { value: "seven", label: "7-segment" },
  { value: "bar", label: "Bar" },
  { value: "grid", label: "Grid" },
];

const SEGMENTS: Record<string, boolean[]> = {
  //        a(top) b(top right) c(bottom right) d(bottom) e(bottom left) f(top left) g(middle)
  "0": [true, true, true, true, true, true, false],
  "1": [false, true, true, false, false, false, false],
  "2": [true, true, false, true, true, false, true],
  "3": [true, true, true, true, false, false, true],
  "4": [false, true, true, false, false, true, true],
  "5": [true, false, true, true, false, true, true],
  "6": [true, false, true, true, true, true, true],
  "7": [true, true, true, false, false, false, false],
  "8": [true, true, true, true, true, true, true],
  "9": [true, true, true, true, false, true, true],
  A: [true, true, true, false, true, true, true],
  B: [false, true, true, true, true, true, true],
  C: [true, false, true, true, true, false, false],
  D: [false, true, true, true, true, false, true],
  E: [true, false, true, true, true, true, true],
  F: [true, false, true, false, true, true, true],
};

const SEGMENT_SHAPES = [
  "M6 3 H22 L24 5 L22 7 H6 L4 5 Z", // a
  "M22 7 L24 9 V19 L22 21 L20 19 V9 Z", // b
  "M22 21 L24 19 L24 29 L22 31 L20 29 V23 Z", // c
  "M6 29 H22 L24 31 L22 33 H6 L4 31 Z", // d
  "M4 9 L6 7 L8 9 V19 L6 21 L4 19 Z", // e
  "M4 3 L6 5 L8 3 V13 L6 15 L4 13 Z", // f
  "M6 16 H22 L24 18 L22 20 H6 L4 18 Z", // g
];

interface OutputDisplayProps {
  mode: DisplayMode;
  /** The binary value, most-significant bit first. */
  binary: string;
  /** The value as a decimal string, for the number mode. */
  decimal: string;
  width: number;
}

export function OutputDisplay({ mode, binary, decimal, width }: OutputDisplayProps) {
  switch (mode) {
    case "led":
      return <LedDisplay binary={binary} />;
    case "seven":
      return <SevenSegmentDisplay binary={binary} />;
    case "bar":
      return <BarDisplay binary={binary} />;
    case "grid":
      return <GridDisplay binary={binary} />;
    default:
      return (
        <span className="display-number">
          <span className="binary-value">{binary}</span>
          {width > 1 ? <span className="decimal-value">#{decimal}</span> : null}
        </span>
      );
  }
}

function LedDisplay({ binary }: { binary: string }) {
  return (
    <span className="display-leds" aria-label={`bits ${binary}`}>
      {[...binary].map((bit, index) => (
        <i key={index} className={bit === "1" ? "is-on" : ""} />
      ))}
    </span>
  );
}

function SevenSegmentDisplay({ binary }: { binary: string }) {
  const glyph = useMemo(() => {
    const value = binary.length >= 4 ? binary.slice(-4) : binary.padStart(4, "0");
    const index = Number.parseInt(value, 2);
    const key = index < 10 ? String(index) : "ABCDEF"[index - 10] ?? "0";
    return { key, segments: SEGMENTS[key] ?? SEGMENTS["0"]! };
  }, [binary]);

  return (
    <svg className="display-seven" viewBox="0 0 28 36" width="30" height="38" aria-label={`digit ${glyph.key}`}>
      {SEGMENT_SHAPES.map((shape, index) => (
        <path
          key={shape}
          d={shape}
          className={glyph.segments[index] ? "is-on" : ""}
        />
      ))}
    </svg>
  );
}

function BarDisplay({ binary }: { binary: string }) {
  const percent = Math.round((Number.parseInt(binary || "0", 2) / 2 ** Math.max(1, binary.length)) * 100);
  return (
    <span className="display-bar" aria-label={`${percent} percent`}>
      <i style={{ width: `${percent}%` }} />
    </span>
  );
}

function GridDisplay({ binary }: { binary: string }) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(binary.length)));
  const rows = Math.max(1, Math.ceil(binary.length / columns));
  const cells = [...binary].reverse();

  return (
    <span
      className="display-grid"
      style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
      aria-label={`grid ${columns} by ${rows}`}
    >
      {cells.map((bit, index) => (
        <i key={index} className={bit === "1" ? "is-on" : ""} />
      ))}
    </span>
  );
}
