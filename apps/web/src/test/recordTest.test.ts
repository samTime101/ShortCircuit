import { describe, expect, it } from "vitest";
import { compile } from "@shortcircuit/engine";
import { insertRecordedCase, suggestCaseName } from "../lib/recordTest";

describe("recording a test case", () => {
  it("suggests a name from the recorded actions", () => {
    expect(suggestCaseName(["CYCLE clock 3"])).toBe("3 clock ticks");
    expect(suggestCaseName(["STEP", "  INPUT clock = 1", "END"])).toBe("1 step");
    expect(suggestCaseName(["INPUT a = 1"])).toBe("1 input");
    expect(suggestCaseName([])).toBe("recorded case");
  });

  it("appends a new test block when the circuit has none", () => {
    const source = "CIRCUIT Counter4\nINPUT clock\nEND";
    const result = insertRecordedCase(source, {
      circuit: "Counter4",
      label: "3 clock ticks",
      lines: ["INPUT reset = 0", "CYCLE clock 3", "EXPECT count = 0011"],
    });
    expect(result).toContain("TEST Counter4");
    expect(result).toContain('CASE "3 clock ticks"');
    expect(result).toContain("CYCLE clock 3");
    expect(result).toContain("EXPECT count = 0011");
  });

  it("adds the case to an existing test block", () => {
    const source = `CIRCUIT Counter4
INPUT clock
END

TEST Counter4
CASE "one"
  INPUT reset = 0
  EXPECT count = 0000
END
END`;
    const result = insertRecordedCase(source, {
      circuit: "Counter4",
      label: "two",
      lines: ["CYCLE clock 2"],
    });
    expect(result.match(/TEST Counter4/g)).toHaveLength(1);
    expect(result).toContain('CASE "two"');
    expect(result.indexOf('CASE "two"')).toBeGreaterThan(result.indexOf('CASE "one"'));
  });

  it("keeps the source compiling when the test block already has a case", () => {
    const source = `CIRCUIT Inv
INPUT a
y = NAND(a, a)
OUTPUT y
END

TEST Inv
CASE "one"
  INPUT a = 0
  EXPECT y = 1
END
END`;
    const result = insertRecordedCase(source, {
      circuit: "Inv",
      label: "two",
      lines: ["INPUT a = 1", "EXPECT y = 0"],
    });
    // The new case must close before the TEST block's own END, not nest inside
    // the previous CASE.
    const errors = compile(result).diagnostics.filter(
      (item) => item.severity === "error",
    );
    expect(errors.map((item) => item.code)).toEqual([]);
    expect(result.match(/^END$/gm)).toHaveLength(3);
  });
});
