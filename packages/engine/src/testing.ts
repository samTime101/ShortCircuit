import type {
  CircuitIR,
  CompileResult,
  TestCaseResult,
  TestCycleInstruction,
  TestExpectInstruction,
  TestInstructionIR,
  TestRowResult,
  TestRunResult,
  TestSuiteIR,
  TestSuiteResult,
} from "./types";
import { Simulator } from "./simulator";

/** Runs every compiled TEST block, including clocked ones. */
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
    if (!circuit) {
      unsupported += 1;
      suites.push({
        name: suite.name,
        circuit: suite.circuit,
        pass: false,
        runnable: false,
        reason: `Circuit ${suite.circuit} was not compiled.`,
        line: suite.line,
        cases: [],
      });
      continue;
    }
    if (!suite.runnable) {
      unsupported += 1;
      suites.push({
        name: suite.name,
        circuit: suite.circuit,
        pass: false,
        runnable: false,
        reason: suite.reason ?? "Test suite is not runnable.",
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
        return {
          label: testCase.label,
          line: testCase.line,
          pass: false,
          rows: [],
          error: message,
        };
      }
    });

    const suitePass = caseResults.length > 0 && caseResults.every((entry) => entry.pass);
    // Count cases, not suites: a suite with one passing and one failing case
    // contributes to both totals.
    passed += caseResults.filter((entry) => entry.pass).length;
    failed += caseResults.filter((entry) => !entry.pass).length;
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

interface ExpectCheck {
  row: TestRowResult;
  pass: boolean;
  message: string;
}

function checkExpect(
  simulator: Simulator,
  instruction: TestExpectInstruction,
  step: number,
): ExpectCheck {
  const snapshot = simulator.snapshot();
  const signal =
    instruction.target === "state"
      ? (snapshot.states[instruction.actualName] ?? snapshot.outputs[instruction.actualName])
      : (snapshot.outputs[instruction.actualName] ??
        snapshot.outputs[instruction.name] ??
        snapshot.states[instruction.actualName]);
  const actual = signal?.binary ?? "<missing>";
  const pass = actual === instruction.value;
  return {
    row: {
      kind: "expect",
      name: instruction.actualName,
      expected: instruction.value,
      actual,
      width: instruction.width,
      pass,
      line: instruction.line,
      step,
    },
    pass,
    message: `EXPECT ${instruction.actualName}: expected ${instruction.value}, got ${actual}`,
  };
}

/**
 * Executes one test case.
 *
 * Statements run in source order. A STEP applies all of its input changes as a
 * single transition, and CYCLE pulses a clock 0 -> 1 -> 0 the given number of
 * times. The case stops at the first failing expectation.
 */
function runCase(circuit: CircuitIR, testCase: TestSuiteIR["cases"][number]): TestCaseResult {
  const simulator = new Simulator(circuit);
  const rows: TestRowResult[] = [];
  let step = 0;

  const fail = (message: string): TestCaseResult => ({
    label: testCase.label,
    line: testCase.line,
    pass: false,
    rows,
    error: message,
    step,
  });

  /** Pulses a clock, closing a high phase first so every tick has an edge. */
  const pulseClock = (
    instruction: TestCycleInstruction,
  ): TestCaseResult | null => {
    try {
      if (simulator.inputValue(instruction.clock) === 1n) {
        simulator.setInput(instruction.clock, "0");
      }
      for (let index = 0; index < instruction.count; index += 1) {
        step += 1;
        simulator.setInput(instruction.clock, "1");
        simulator.setInput(instruction.clock, "0");
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
    rows.push({
      kind: "input",
      name: instruction.clock,
      actual: `${instruction.count} cycle${instruction.count === 1 ? "" : "s"}`,
      width: 1,
      line: instruction.line,
      step,
    });
    return null;
  };

  /**
   * Applies one STEP group: its own input changes commit together, then the
   * nested instructions run in source order. A nested STEP or CYCLE is a real
   * instruction, so it is executed rather than skipped.
   */
  const runStep = (statements: TestInstructionIR[]): TestCaseResult | null => {
    step += 1;
    const values: Record<string, string> = {};
    for (const inner of statements) {
      if (inner.kind === "input") values[inner.name] = inner.value;
    }
    if (Object.keys(values).length > 0) {
      try {
        simulator.setInputs(values);
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    }
    for (const inner of statements) {
      if (inner.kind === "input") {
        rows.push({
          kind: "input",
          name: inner.name,
          actual: inner.value,
          width: inner.width,
          line: inner.line,
          step,
        });
        continue;
      }
      if (inner.kind === "expect") {
        const check = checkExpect(simulator, inner, step);
        rows.push(check.row);
        if (!check.pass) return fail(check.message);
        continue;
      }
      if (inner.kind === "cycle") {
        const failure = pulseClock(inner);
        if (failure) return failure;
        continue;
      }
      if (inner.kind === "step") {
        const failure = runStep(inner.statements);
        if (failure) return failure;
      }
    }
    return null;
  };

  const run = (instructions: TestInstructionIR[]): TestCaseResult | null => {
    for (const instruction of instructions) {
      if (instruction.kind === "input") {
        step += 1;
        try {
          simulator.setInput(instruction.name, instruction.value);
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error));
        }
        rows.push({
          kind: "input",
          name: instruction.name,
          actual: instruction.value,
          width: instruction.width,
          line: instruction.line,
          step,
        });
        continue;
      }

      if (instruction.kind === "load") {
        step += 1;
        try {
          simulator.setState(instruction.name, instruction.value);
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error));
        }
        rows.push({
          kind: "input",
          name: instruction.name,
          actual: instruction.value,
          width: instruction.width,
          line: instruction.line,
          step,
        });
        continue;
      }

      if (instruction.kind === "step") {
        const failure = runStep(instruction.statements);
        if (failure) return failure;
        continue;
      }

      if (instruction.kind === "cycle") {
        const failure = pulseClock(instruction);
        if (failure) return failure;
        continue;
      }

      const check = checkExpect(simulator, instruction, step);
      rows.push(check.row);
      if (!check.pass) return fail(check.message);
    }
    return null;
  };

  const failure = run(testCase.program);
  if (failure) return failure;

  return {
    label: testCase.label,
    line: testCase.line,
    pass: true,
    rows,
  };
}
