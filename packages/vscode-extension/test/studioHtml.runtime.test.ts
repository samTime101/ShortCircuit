// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { compile, Simulator } from "@shortcircuit/engine";
import { buildLayout } from "../src/graphLayout";
import { getStudioHtml } from "../src/studioHtml";
import {
  buildCircuitSummaries,
  buildIrSummary,
  buildTestsModel,
  normalizeInputs,
  snapshotToModel,
  type StudioModel,
} from "../src/studioModel";

const SOURCE = `
CIRCUIT HALF
  INPUT a
  INPUT b
  nand_ab = NAND(a, b)
  OUTPUT nand_ab
END

TEST HALF
  CASE "high"
    INPUT a = 1
    INPUT b = 1
    EXPECT nand_ab = 0
  END
  CASE "low"
    INPUT a = 0
    INPUT b = 1
    EXPECT nand_ab = 1
  END
END
`;

function makeModel(
  inputs: Record<string, string>,
  revision: number,
  source = SOURCE,
): StudioModel {
  const result = compile(source);
  const circuit = result.circuits[0]!;
  const simulator = new Simulator(circuit);
  const normalized = normalizeInputs(circuit, inputs);
  const snapshot = simulator.setInputs({ ...normalized });
  const circuits = buildCircuitSummaries(result.circuits);
  const layout = buildLayout(circuit);
  const ir = buildIrSummary(circuit);
  return {
    circuits,
    activeCircuit: circuit.name,
    inputs: normalized,
    snapshot: snapshotToModel(snapshot),
    layout,
    truthTable: null,
    waveform: null,
    tests: null,
    ir,
    irText: null,
    diagnostics: [],
    revision,
    structureKey: JSON.stringify({
      circuits,
      activeCircuit: circuit.name,
      layout,
      ir,
    }),
    derivedKey: JSON.stringify(circuit),
  };
}

function loadStudio(model: StudioModel, revision = 1) {
  const posted: any[] = [];
  const dom = new JSDOM(getStudioHtml(model, { revision }), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      (window as any).acquireVsCodeApi = () => ({
        postMessage: (message: unknown) => posted.push(message),
        getState: () => ({}),
        setState: () => undefined,
      });
    },
  });
  return { dom, window: dom.window, document: dom.window.document, posted };
}

function send(window: any, data: unknown) {
  window.dispatchEvent(new window.MessageEvent("message", { data }));
}

describe("studio webview runtime", () => {
  it("patches values, preserves derived views, and ignores stale revisions", async () => {
    const model = makeModel({ a: "0", b: "0" }, 1);
    const { window, document, posted } = loadStudio(model);
    await new Promise((resolve) => setTimeout(resolve, 80));

    const inputRow = document.querySelector('[data-input-name="a"]');
    expect(inputRow).toBeTruthy();

    const truth = {
      circuit: "HALF",
      inputs: [
        { name: "a", width: 1 },
        { name: "b", width: 1 },
      ],
      outputs: [{ name: "nand_ab", width: 1 }],
      rows: [
        { input: { a: "0", b: "0" }, output: { nand_ab: "1" } },
        { input: { a: "0", b: "1" }, output: { nand_ab: "1" } },
      ],
    };
    const tests = buildTestsModel(compile(SOURCE));
    expect(tests?.failed).toBe(0);

    send(window, { type: "setTab", tab: "tests" });
    expect(posted.some((message) => message.type === "requestData" && message.kind === "tests")).toBe(true);
    expect(document.getElementById("tests-list")!.textContent).toContain("Running tests");

    send(window, { type: "derived", kind: "tests", payload: tests, revision: 1 });
    expect(document.getElementById("tests-count")!.textContent).toBe("2");
    expect(document.getElementById("tests-summary")!.textContent).toContain("ALL TESTS PASSED");

    send(window, { type: "setTab", tab: "truth" });
    send(window, { type: "derived", kind: "truthTable", payload: truth, revision: 1 });
    const truthTable = document.querySelector("#truth-table-view table");
    expect(truthTable).toBeTruthy();

    // Structure is unchanged, so the update should patch values in place.
    send(window, { type: "update", payload: makeModel({ a: "1", b: "0" }, 2), revision: 2, forceReset: false });
    expect(document.querySelector('[data-input-name="a"]')).toBe(inputRow);
    expect(document.querySelector("#truth-table-view table")).toBe(truthTable);

    const outputPill = () =>
      document.querySelector('[data-output-name="nand_ab"] .output-pill')!.textContent;
    expect(outputPill()).toBe("1");

    // A simulation from the previous revision must not overwrite the new one.
    send(window, {
      type: "simulation",
      payload: {
        inputs: { a: "1", b: "1" },
        snapshot: {
          inputs: {},
          outputs: { nand_ab: { width: 1, binary: "0" } },
          nodes: {},
        },
      },
      revision: 1,
    });
    expect(outputPill()).toBe("1");

    send(window, {
      type: "simulation",
      payload: {
        inputs: { a: "1", b: "1" },
        snapshot: {
          inputs: {},
          outputs: { nand_ab: { width: 1, binary: "0" } },
          nodes: {},
        },
      },
      revision: 2,
    });
    expect(outputPill()).toBe("0");

    window.close();
  });

  it("drops derived views when circuit semantics change", async () => {
    const model = makeModel({ a: "0", b: "0" }, 1);
    const { window, document, posted } = loadStudio(model);
    await new Promise((resolve) => setTimeout(resolve, 80));

    send(window, { type: "setTab", tab: "truth" });
    send(window, {
      type: "derived",
      kind: "truthTable",
      payload: {
        circuit: "HALF",
        inputs: [
          { name: "a", width: 1 },
          { name: "b", width: 1 },
        ],
        outputs: [{ name: "nand_ab", width: 1 }],
        rows: [{ input: { a: "0", b: "0" }, output: { nand_ab: "1" } }],
      },
      revision: 1,
    });
    expect(document.querySelector("#truth-table-view table")).toBeTruthy();

    // A behavior change can leave the drawn graph identical (for example a
    // constant or operation parameter). The old truth table must not survive.
    const updated = makeModel(
      { a: "0", b: "0" },
      2,
      SOURCE.replace("nand_ab = NAND(a, b)", "nand_ab = NOR(a, b)"),
    );
    updated.structureKey = model.structureKey;
    send(window, { type: "update", payload: updated, revision: 2 });

    expect(document.querySelector("#truth-table-view table")).toBeNull();
    expect(document.getElementById("truth-table-view")!.textContent).toContain(
      "Computing truth table",
    );
    expect(
      posted.some(
        (message) => message.type === "requestData" && message.kind === "truthTable",
      ),
    ).toBe(true);

    window.close();
  });
});
