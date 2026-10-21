import { describe, expect, it } from "vitest";
import { DEFAULT_PACKAGE_CIRCUITS, DEFAULT_PACKAGE_MACROS } from "@shortcircuit/engine";
import languageDocs from "../docs/LANGUAGE.md?raw";
import { operationReferenceMarkdown } from "../scripts/reference.mts";

describe("documentation", () => {
  it("keeps the operation reference in step with the engine", () => {
    expect(languageDocs).toContain(
      operationReferenceMarkdown({
        macros: DEFAULT_PACKAGE_MACROS.map((macro) => ({
          name: macro.name,
          signature: macro.signature,
          args: macro.args,
          variadic: macro.variadic,
          summary: macro.summary,
          group: macro.group,
          widthRule: macro.widthRule,
          examples: macro.examples,
        })),
        circuits: DEFAULT_PACKAGE_CIRCUITS.map(({ circuit }) => circuit),
      }),
    );
  });

  it("documents the clocked test statements", () => {
    for (const statement of ["STEP", "CYCLE", "LOAD"]) {
      expect(languageDocs, statement).toContain(statement);
    }
  });
});
