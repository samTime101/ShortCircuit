/** Small helpers for the bitset-style values used by the simulator. */

export const MAX_WIDTH = 4096;
const WIDTH_CACHE = new Map<number, bigint>();

export interface BitValue {
  width: number;
  value: bigint;
}

export function maskFor(width: number): bigint {
  const cached = WIDTH_CACHE.get(width);
  if (cached !== undefined) return cached;
  const mask = (1n << BigInt(width)) - 1n;
  WIDTH_CACHE.set(width, mask);
  return mask;
}

export function normalize(value: bigint, width: number): bigint {
  return value & maskFor(width);
}

export function formatBinary(value: bigint, width: number): string {
  const normalized = normalize(value, width);
  return normalized.toString(2).padStart(width, "0");
}

export function formatHex(value: bigint, width: number): string {
  return `0x${normalize(value, width).toString(16).toUpperCase()}`;
}

/** Reads a binary string, most-significant bit first, as a decimal string. */
export function binaryToDecimal(binary: string): string {
  const clean = binary.trim();
  if (!/^[01]+$/.test(clean)) return "0";
  return BigInt(`0b${clean}`).toString(10);
}

export function bitLength(value: bigint): number {
  if (value <= 0n) return 1;
  return value.toString(2).length;
}

export function parseDecimalOrPrefixed(raw: string): {
  value: bigint;
  width: number;
  rawDigits: string;
} {
  const clean = raw.replaceAll("_", "");
  if (/^0[bB][01]+$/.test(clean)) {
    const digits = clean.slice(2);
    return { value: BigInt(`0b${digits}`), width: digits.length, rawDigits: digits };
  }
  if (/^0[xX][0-9a-fA-F]+$/.test(clean)) {
    const digits = clean.slice(2);
    return {
      value: BigInt(`0x${digits}`),
      width: Math.max(1, digits.length * 4),
      rawDigits: digits,
    };
  }
  return { value: BigInt(clean), width: bitLength(BigInt(clean)), rawDigits: clean };
}

export type LiteralWidthMode = "language" | "exact-binary";

/**
 * Parses a source literal.
 *
 * Language rule: a multi-character digit string with a leading zero and only
 * 0/1 characters is a binary literal (00000011). Plain "10" is decimal ten.
 * Prefixed 0b... and 0x... literals are always available.
 */
export function parseLanguageLiteral(raw: string): BitValue {
  const clean = raw.replaceAll("_", "");
  if (/^[01]+$/.test(clean) && clean.length > 1 && clean.startsWith("0")) {
    return { width: clean.length, value: BigInt(`0b${clean}`) };
  }
  const parsed = parseDecimalOrPrefixed(clean);
  return { width: parsed.width, value: parsed.value };
}

/** Parses values typed into simulation controls. Bare digits are binary. */
export function parseSimulationInput(raw: string, width: number): bigint {
  const clean = raw.trim().replaceAll("_", "").replaceAll(" ", "");
  if (clean === "") return 0n;
  if (/^0[xX][0-9a-fA-F]+$/.test(clean)) {
    const value = BigInt(clean);
    if (value > maskFor(width)) throw new Error(`Value does not fit in ${width} bits.`);
    return value;
  }
  if (!/^(?:0[bB])?[01]+$/.test(clean)) {
    throw new Error("Use a binary value (0/1) or a 0x hexadecimal value.");
  }
  const digits = clean.replace(/^0[bB]/, "");
  if (digits.length > width) throw new Error(`Value is wider than ${width} bits.`);
  return BigInt(`0b${digits}`);
}

/** Test values favour binary when they contain only 0/1 characters. */
export function parseTestLiteral(raw: string): BitValue {
  const clean = raw.replaceAll("_", "");
  if (/^[01]+$/.test(clean) && clean.length > 1) {
    return { width: clean.length, value: BigInt(`0b${clean}`) };
  }
  return parseLanguageLiteral(raw);
}

export function parseNumericLiteral(raw: string): number | null {
  if (!/^\d+$/.test(raw.replaceAll("_", ""))) return null;
  const value = Number(raw.replaceAll("_", ""));
  return Number.isSafeInteger(value) ? value : null;
}

export function fitsWidth(value: bigint, width: number): boolean {
  return value >= 0n && value <= maskFor(width);
}

export function coerceLiteralWidth(value: bigint, width: number): bigint {
  return normalize(value, width);
}

export function valueAsIndex(value: bigint): number {
  if (value > 0xffffffffn) return 0xffffffff;
  return Number(value);
}
