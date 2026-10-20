import { describe, expect, it } from "vitest";
import { migrateLegacyComments } from "../lib/legacyComments";

describe("legacy comment migration", () => {
  it("leaves a source without # alone", () => {
    const source = "CIRCUIT Demo\n// a note\nINPUT a\nEND";
    expect(migrateLegacyComments(source)).toBe(source);
  });

  it("rewrites a whole-line comment", () => {
    expect(migrateLegacyComments("# a note\nINPUT a")).toBe("// a note\nINPUT a");
  });

  it("rewrites a trailing comment", () => {
    expect(migrateLegacyComments("INPUT a # a note")).toBe("INPUT a // a note");
  });

  it("keeps a # inside a string", () => {
    expect(migrateLegacyComments('CASE "a # b"')).toBe('CASE "a # b"');
  });

  it("keeps an escaped quote inside a string", () => {
    expect(migrateLegacyComments('CASE "a \\" # b"')).toBe('CASE "a \\" # b"');
  });

  it("rewrites every comment in a longer source", () => {
    const source = `# header
CIRCUIT Demo
INPUT a  # a note
END`;
    expect(migrateLegacyComments(source)).toBe(`// header
CIRCUIT Demo
INPUT a  // a note
END`);
  });
});
