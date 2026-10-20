import type {
  CircuitIR,
  CompileResult,
  TestCaseResult,
  TestRowResult,
  TestRunResult,
  TestSuiteIR,
  TestSuiteResult,
} from "./types";
import { Simulator } from "./simulator";

/** Runs every compiled TEST block. Clocked circuits are reported as unsupported. */
export function runTests(
  result: Pick<CompileResult, "tests" | "circuits">,
): TestRunResult {
  const started = Date.now();
  const suites: TestSuiteResult[] = [];
  let passed = 0;
  let failed = 0;
  let unsupported = 0;

  for (const suite of result.tests) {
    const circuit = result.circuits.find((entry) => entry.name === suite.circuit);
    if (!circuit || !suite.runnable) {
      unsupported += 1;
      suites.push({
        name: suite.name,
        circuit: suite.circuit,
        pass: false,
        runnable: false,
        reason:
          suite.reason ??
          (circuit ? "Test suite is not runnable." : `Circuit ${suite.circuit} was not compiled.`),
        line: suite.line,
        cases: [],
      });
      continue;
    }

    const caseResults = suite.cases.map((testCase) => {
      try {
        return runCase(circuit, testCase);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const rows: TestRowResult[] = testCase.inputs.map((input) => ({
          kind: "input",
          name: input.name,
          actual: input.value,
          width: input.width,
          line: input.line,
        }));
        for (const expectation of testCase.expectations) {
          rows.push({
            kind: "expect",
            name: expectation.name,
            expected: expectation.value,
            actual: "<simulation error>",
            width: expectation.width,
            pass: false,
            line: expectation.line,
          });
        }
        return {
          label: testCase.label,
          line: testCase.line,
          pass: false,
          rows,
          error: message,
        };
      }
    });

    const suitePass = caseResults.length > 0 && caseResults.every((entry) => entry.pass);
    if (suitePass) passed += caseResults.length;
    else failed += caseResults.filter((entry) => !entry.pass).length;
    suites.push({
      name: suite.name,
      circuit: suite.circuit,
      pass: suitePass,
      runnable: true,
      line: suite.line,
      cases: caseResults,
    });
  }

  return {
    ok: failed === 0 && unsupported === 0,
    suites,
    passed,
    failed,
    unsupported,
    elapsedMs: Date.now() - started,
  };
}

function runCase(
  circuit: CircuitIR,
  testCase: TestSuiteIR["cases"][number],
): TestCaseResult {
  const simulator = new Simulator(circuit);
  const values: Record<string, string> = {};
  for (const input of circuit.inputs) values[input.name] = "0";
  for (const input of testCase.inputs) values[input.name] = input.value;
  const snapshot = simulator.setInputs(values);

  const rows: TestRowResult[] = [];
  for (const input of testCase.inputs) {
    rows.push({
      kind: "input",
      name: input.name,
      actual: input.value,
      width: input.width,
      line: input.line,
    });
  }

  let pass = true;
  for (const expectation of testCase.expectations) {
    const actual =
      snapshot.outputs[expectation.actualName]?.binary ??
      snapshot.outputs[expectation.name]?.binary ??
      "<missing>";
    const rowPass = actual === expectation.value;
    if (!rowPass) pass = false;
    rows.push({
      kind: "expect",
      name: expectation.actualName || expectation.name,
      expected: expectation.value,
      actual,
      width: expectation.width,
      pass: rowPass,
      line: expectation.line,
    });
  }

  return {
    label: testCase.label,
    line: testCase.line,
    pass,
    rows,
  };
}
