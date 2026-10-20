import { describe, expect, it } from "vitest";
import languageDocs from "../docs/LANGUAGE.md?raw";
import { operationReferenceMarkdown } from "../scripts/reference.mts";

describe("documentation", () => {
  it("keeps the operation reference in step with the engine", () => {
    expect(languageDocs).toContain(operationReferenceMarkdown());
  });

  it("documents the clocked test statements", () => {
    for (const statement of ["STEP", "CYCLE", "LOAD"]) {
      expect(languageDocs, statement).toContain(statement);
    }
  });
});
