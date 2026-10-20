import { describe, expect, it } from "vitest";
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
});
