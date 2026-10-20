import type { CircuitIR, TruthTable } from "./types";
import { Simulator } from "./simulator";
import { formatBinary, maskFor } from "./values";

export interface TruthTableOptions {
  maxInputBits?: number;
  maxRows?: number;
}

/**
 * Exhaustively enumerates every input combination for a combinational circuit.
 * Bus inputs are enumerated bit by bit, not as abstract symbols.
 */
export function generateTruthTable(
  circuit: CircuitIR,
  options: TruthTableOptions = {},
): TruthTable {
  const maxInputBits = Math.min(options.maxInputBits ?? 12, 20);
  const maxRows = options.maxRows ?? 1 << maxInputBits;
  const inputs = circuit.inputs.map((input) => ({ name: input.name, width: input.width }));
  const outputs = circuit.outputs.map((output) => ({ name: output.name, width: output.width }));
  const inputBits = inputs.reduce((sum, input) => sum + input.width, 0);

  if (circuit.sequential) {
    return {
      circuit: circuit.name,
      inputBits,
      inputs,
      outputs,
      rows: [],
      truncated: true,
      reason:
        "Truth tables are available for combinational circuits. This circuit contains clocks or stored state.",
    };
  }
  if (inputBits > maxInputBits) {
    return {
      circuit: circuit.name,
      inputBits,
      inputs,
      outputs,
      rows: [],
      truncated: true,
      reason: `This circuit has ${inputBits} input bits. Exhaustive enumeration is capped at ${maxInputBits} bits (${2 ** maxInputBits} rows).`,
    };
  }

  const totalRows = 2 ** inputBits;
  if (totalRows > maxRows) {
    return {
      circuit: circuit.name,
      inputBits,
      inputs,
      outputs,
      rows: [],
      truncated: true,
      reason: `This table needs ${totalRows} rows, above the current limit of ${maxRows}.`,
    };
  }

  const simulator = new Simulator(circuit);
  const rows: TruthTable["rows"] = [];
  try {
    for (let row = 0; row < totalRows; row++) {
      const inputValues: Record<string, string> = {};
      let offset = inputBits;
      for (const input of inputs) {
        offset -= input.width;
        const value = (BigInt(row) >> BigInt(offset)) & maskFor(input.width);
        inputValues[input.name] = formatBinary(value, input.width);
      }
      const snapshot = simulator.setInputs(inputValues);
      const outputValues: Record<string, string> = {};
      for (const output of outputs) {
        outputValues[output.name] = snapshot.outputs[output.name]?.binary ?? "";
      }
      rows.push({ input: inputValues, output: outputValues });
    }
  } catch (error) {
    return {
      circuit: circuit.name,
      inputBits,
      inputs,
      outputs,
      // Never expose a partially enumerated table as if it were exhaustive.
      rows: [],
      truncated: true,
      reason: `Simulation stopped: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return {
    circuit: circuit.name,
    inputBits,
    inputs,
    outputs,
    rows,
    truncated: false,
  };
}
