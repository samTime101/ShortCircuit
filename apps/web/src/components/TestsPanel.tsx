import type { TestRunResult } from "@shortcircuit/engine";
import { AlertTriangle, Check, CircleX, Flask, Info, X } from "./Icons";

interface TestsPanelProps {
  result: TestRunResult;
}

export function TestsPanel({ result }: TestsPanelProps) {
  if (result.suites.length === 0) {
    return (
      <div className="workbench-empty">
        <Flask size={25} />
        <h3>No test cases yet</h3>
        <p>
          Add a <code>TEST</code> block below your circuit to verify behavior. Test failures always show
          expected and actual values.
        </p>
        <pre className="empty-code">{`TEST HalfAdder
CASE "carry"
  INPUT a = 1
  INPUT b = 1
  EXPECT sum = 0
  EXPECT carry = 1
END
END`}</pre>
      </div>
    );
  }

  const hasFailures = result.failed > 0;
  const hasUnsupported = result.unsupported > 0;
  const allPassed = !hasFailures && !hasUnsupported;

  return (
    <div className="tests-panel">
      <div className="panel-intro">
        <div>
          <span className="eyebrow">Assertions on the graph</span>
          <h2>Test bench</h2>
          <p>Every CASE drives the circuit inputs and compares the actual output bus to the expected value.</p>
        </div>
        <div className={`test-big-status ${allPassed ? "pass" : hasFailures ? "fail" : "warn"}`}>
          {allPassed ? <Check size={22} /> : hasFailures ? <CircleX size={22} /> : <AlertTriangle size={22} />}
          <div>
            <strong>
              {allPassed
                ? "All passing"
                : hasFailures
                  ? `${result.failed} failed`
                  : `${result.unsupported} unsupported`}
            </strong>
            <span>
              {result.passed} passed · {result.elapsedMs.toFixed(1)} ms
            </span>
          </div>
        </div>
      </div>

      {hasUnsupported ? (
        <div className="notice warning">
          <Info size={15} />
          <span>
            Some suites could not run. Open the Circuit tab and drive the circuit by hand to see what happens.
          </span>
        </div>
      ) : null}

      <div className="test-suites">
        {result.suites.map((suite, suiteIndex) => (
          <section className={`test-suite ${suite.pass ? "is-pass" : suite.runnable ? "is-fail" : "is-unsupported"}`} key={`${suite.name}-${suiteIndex}`}>
            <header className="test-suite-head">
              <div className="test-suite-title">
                <span className={`status-orb ${suite.pass ? "pass" : suite.runnable ? "fail" : "warn"}`}>
                  {suite.pass ? <Check size={13} /> : suite.runnable ? <X size={13} /> : <Info size={13} />}
                </span>
                <div>
                  <h3>{suite.name}</h3>
                  <span>
                    {suite.cases.length} case{suite.cases.length === 1 ? "" : "s"} · line {suite.line}
                  </span>
                </div>
              </div>
              <span className={`suite-badge ${suite.pass ? "pass" : suite.runnable ? "fail" : "warn"}`}>
                {suite.pass ? "PASS" : suite.runnable ? "FAIL" : "UNSUPPORTED"}
              </span>
            </header>

            {!suite.runnable ? (
              <div className="suite-reason">{suite.reason}</div>
            ) : (
              <div className="test-cases">
                {suite.cases.map((testCase, caseIndex) => (
                  <div className={`test-case ${testCase.pass ? "pass" : "fail"}`} key={`${testCase.label}-${caseIndex}`}>
                    <div className="test-case-head">
                      <span className="case-status">
                        {testCase.pass ? <Check size={12} /> : <X size={12} />}
                      </span>
                      <span>{testCase.label}</span>
                      <span className="case-line">
                        line {testCase.line}
                        {testCase.step ? ` · failed at step ${testCase.step}` : ""}
                      </span>
                    </div>
                    {testCase.error ? <div className="case-error">{testCase.error}</div> : null}
                    <div className="test-rows">
                      {testCase.rows.map((row, rowIndex) =>
                        row.kind === "input" ? (
                          <div className="test-row input-row" key={`${row.name}-${rowIndex}`}>
                            <span className="row-kind">{row.step ? `STEP ${row.step}` : "INPUT"}</span>
                            <span className="row-name">{row.name}</span>
                            <span className="row-value mono">{row.actual}</span>
                            <span className="row-result" />
                          </div>
                        ) : (
                          <div
                            className={`test-row expect-row ${row.pass ? "pass" : "fail"}`}
                            key={`${row.name}-${rowIndex}`}
                          >
                            <span className="row-kind">{row.step ? `STEP ${row.step}` : "EXPECT"}</span>
                            <span className="row-name">{row.name}</span>
                            <span className="expect-values">
                              <span className="row-value mono">{row.expected}</span>
                              {!row.pass ? (
                                <>
                                  <span className="arrow">→</span>
                                  <span className="row-value actual mono">{row.actual}</span>
                                </>
                              ) : null}
                            </span>
                            <span className="row-result">
                              {row.pass ? <Check size={12} /> : <X size={12} />}
                            </span>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
