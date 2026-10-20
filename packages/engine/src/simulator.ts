import type {
  CircuitIR,
  CircuitNode,
  ClockEdge,
  SimulationSnapshot,
  SignalSnapshot,
} from "./types";
import {
  formatBinary,
  maskFor,
  normalize,
  parseSimulationInput,
  valueAsIndex,
} from "./values";

export class SimulationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SimulationError";
  }
}

function bitsToBigInt(bits: string | undefined): bigint {
  if (!bits) return 0n;
  return BigInt(`0b${bits}`);
}

function signal(width: number, value: bigint): SignalSnapshot {
  const normalized = normalize(value, width);
  return {
    width,
    binary: formatBinary(normalized, width),
    decimal: normalized.toString(10),
  };
}

/**
 * Evaluates one compiled circuit.
 *
 * Combinational nodes are evaluated from current inputs and state. Clock
 * events are detected after input mutation, all next-state expressions are
 * sampled against the old state, and updates commit together.
 */
export class Simulator {
  private readonly nodes: Map<string, CircuitNode>;
  private readonly order: string[];
  private readonly inputWidths = new Map<string, number>();
  private readonly outputWidths = new Map<string, number>();
  private readonly outputNodes = new Map<string, string>();
  private readonly stateInitial = new Map<string, bigint>();
  private readonly stateValues = new Map<string, bigint>();
  private readonly inputs = new Map<string, bigint>();
  private values = new Map<string, bigint>();
  private clockValues = new Map<string, string>();
  private firedEvents: Array<{ edge: ClockEdge; clock: string; scope: string[] }> = [];
  private initialRuntimeError: SimulationError | null = null;
  private tolerateDivideByZero = false;

  constructor(readonly circuit: CircuitIR) {
    this.nodes = new Map(circuit.nodes.map((node) => [node.id, node]));
    for (const input of circuit.inputs) {
      this.inputWidths.set(input.name, input.width);
      this.inputs.set(input.name, 0n);
    }
    for (const output of circuit.outputs) {
      this.outputWidths.set(output.name, output.width);
      this.outputNodes.set(output.name, output.node);
    }
    for (const state of circuit.states) {
      const value = bitsToBigInt(state.init);
      this.stateInitial.set(state.node, value);
      this.stateValues.set(state.node, value);
    }
    this.order = this.topologicalOrder();
    // Initial inputs are all zero. A DIVIDE by zero must not make the circuit
    // impossible to open: record it, keep the simulator usable, and let the
    // host show the error until inputs make the graph evaluable.
    this.evaluate(true);
    this.captureClockBaseline();
  }

  /** Divide-by-zero encountered while evaluating the all-zero initial state. */
  get runtimeError(): SimulationError | null {
    return this.initialRuntimeError;
  }

  get inputNames(): string[] {
    return [...this.inputWidths.keys()];
  }

  get outputNames(): string[] {
    return [...this.outputWidths.keys()];
  }

  getInputWidth(name: string): number | undefined {
    return this.inputWidths.get(name);
  }

  getOutputWidth(name: string): number | undefined {
    return this.outputWidths.get(name);
  }

  getInputValues(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [name, width] of this.inputWidths) {
      result[name] = formatBinary(this.inputs.get(name) ?? 0n, width);
    }
    return result;
  }

  setInput(name: string, value: string | number | bigint): SimulationSnapshot {
    return this.setInputs({ [name]: value });
  }

  setInputs(values: Record<string, string | number | bigint>): SimulationSnapshot {
    // Validate every value before touching simulator state, so a bad field in a
    // multi-input update cannot leave a partially applied transition behind.
    const validated = new Map<string, bigint>();
    for (const [name, raw] of Object.entries(values)) {
      const width = this.inputWidths.get(name);
      if (width === undefined) {
        throw new SimulationError("R400", `Unknown input "${name}" for circuit ${this.circuit.name}.`);
      }
      let value: bigint;
      if (typeof raw === "bigint") {
        value = raw;
      } else if (typeof raw === "number") {
        if (!Number.isSafeInteger(raw) || raw < 0) {
          throw new SimulationError("R401", `Input "${name}" must be a non-negative safe integer or binary string.`);
        }
        value = BigInt(raw);
      } else {
        try {
          value = parseSimulationInput(raw, width);
        } catch (error) {
          throw new SimulationError(
            "R402",
            `Invalid value for input "${name}": ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (value < 0n || value > maskFor(width)) {
        throw new SimulationError(
          "R401",
          `Value for input "${name}" does not fit in ${width} bit${width === 1 ? "" : "s"}.`,
        );
      }
      validated.set(name, value);
    }
    for (const [name, value] of validated) this.inputs.set(name, value);
    return this.afterInputsChanged();
  }

  /**
   * Forces a state signal to a value, the way the "set state" control does.
   * The graph is re-evaluated against the new value; no clock edge is fired.
   */
  setState(name: string, value: string | number | bigint): SimulationSnapshot {
    const state = this.circuit.states.find((entry) => entry.name === name);
    if (!state) {
      throw new SimulationError("R410", `Unknown state "${name}" for circuit ${this.circuit.name}.`);
    }
    let parsed: bigint;
    if (typeof value === "bigint") {
      parsed = value;
    } else if (typeof value === "number") {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new SimulationError(
          "R411",
          `Value for state "${name}" must be a non-negative whole number or binary string.`,
        );
      }
      parsed = BigInt(value);
    } else {
      const cleaned = value.replaceAll("_", "").replaceAll(" ", "");
      const binaryDigits = /^(?:0[bB])?[01]+$/.test(cleaned)
        ? cleaned.replace(/^0[bB]/, "").length
        : -1;
      if (binaryDigits > state.width) {
        throw new SimulationError(
          "R411",
          `Value for state "${name}" is ${binaryDigits} bits wide, but the state is ${state.width} bit${state.width === 1 ? "" : "s"}.`,
        );
      }
      try {
        parsed = parseSimulationInput(value, state.width);
      } catch (error) {
        throw new SimulationError(
          "R412",
          `Invalid value for state "${name}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (parsed < 0n || parsed > maskFor(state.width)) {
      throw new SimulationError(
        "R411",
        `Value for state "${name}" does not fit in ${state.width} bit${state.width === 1 ? "" : "s"}.`,
      );
    }
    this.stateValues.set(state.node, parsed);
    this.evaluate();
    this.captureClockBaseline();
    return this.snapshot();
  }

  toggleInputBit(name: string, bit: number): SimulationSnapshot {
    const width = this.inputWidths.get(name);
    if (width === undefined) {
      throw new SimulationError("R400", `Unknown input "${name}".`);
    }
    if (!Number.isInteger(bit) || bit < 0 || bit >= width) {
      throw new SimulationError("R403", `Bit ${bit} is outside input "${name}" (${width} bits).`);
    }
    const current = this.inputs.get(name) ?? 0n;
    const next = current ^ (1n << BigInt(bit));
    return this.setInput(name, next);
  }

  reset(): SimulationSnapshot {
    for (const [node, value] of this.stateInitial) this.stateValues.set(node, value);
    this.firedEvents = [];
    this.initialRuntimeError = null;
    this.evaluate();
    this.captureClockBaseline();
    return this.snapshot();
  }

  clearInputs(): SimulationSnapshot {
    for (const name of this.inputWidths.keys()) this.inputs.set(name, 0n);
    return this.afterInputsChanged();
  }

  snapshot(): SimulationSnapshot {
    const inputs: Record<string, SignalSnapshot> = {};
    for (const [name, width] of this.inputWidths) {
      inputs[name] = signal(width, this.inputs.get(name) ?? 0n);
    }
    const outputs: Record<string, SignalSnapshot> = {};
    for (const [name, width] of this.outputWidths) {
      const node = this.outputNodes.get(name)!;
      outputs[name] = signal(width, this.values.get(node) ?? 0n);
    }
    const states: Record<string, SignalSnapshot> = {};
    for (const state of this.circuit.states) {
      states[state.name] = signal(state.width, this.stateValues.get(state.node) ?? 0n);
    }
    const nodes: Record<string, string> = {};
    for (const [id, value] of this.values) {
      const node = this.nodes.get(id);
      if (!node) continue;
      nodes[id] = formatBinary(value, node.width);
    }
    return {
      inputs,
      outputs,
      states,
      nodes,
      clockValues: Object.fromEntries(this.clockValues),
      firedEvents: this.firedEvents,
      ...(this.initialRuntimeError
        ? {
            runtimeError: {
              code: this.initialRuntimeError.code,
              message: this.initialRuntimeError.message,
            },
          }
        : {}),
    };
  }

  nodeValue(id: string): bigint | undefined {
    return this.values.get(id);
  }

  inputValue(name: string): bigint {
    return this.inputs.get(name) ?? 0n;
  }

  stateValue(node: string): bigint {
    return this.stateValues.get(node) ?? 0n;
  }

  private afterInputsChanged(): SimulationSnapshot {
    const before = new Map(this.clockValues);
    this.firedEvents = [];
    this.initialRuntimeError = null;
    this.evaluate();

    const triggered = this.circuit.events.filter((event) => {
      const previous = before.get(event.clock);
      const node = this.nodes.get(event.clock);
      if (!node) return false;
      const previousValue = previous ? bitsToBigInt(previous) : 0n;
      const currentValue = normalize(this.values.get(event.clock) ?? 0n, node.width);
      return (
        (event.edge === "rising" && previousValue === 0n && currentValue === 1n) ||
        (event.edge === "falling" && previousValue === 1n && currentValue === 0n)
      );
    });

    if (triggered.length > 0) {
      const updates = new Map<string, bigint>();
      for (const event of triggered) {
        this.firedEvents.push({
          edge: event.edge,
          clock: event.clock,
          scope: event.scope,
        });
        for (const update of event.updates) {
          const next = this.values.get(update.value);
          if (next === undefined) {
            throw new SimulationError(
              "R404",
              `Clock event references a signal that could not be evaluated (${update.value}).`,
            );
          }
          const existing = updates.get(update.state);
          if (existing !== undefined && existing !== next) {
            throw new SimulationError(
              "R405",
              `Two clock events tried to write conflicting values to state ${update.state} in the same step.`,
            );
          }
          updates.set(update.state, next);
        }
      }
      for (const [state, value] of updates) this.stateValues.set(state, value);
      this.evaluate();
    }

    this.captureClockBaseline();
    return this.snapshot();
  }

  private captureClockBaseline(): void {
    this.clockValues = new Map();
    for (const event of this.circuit.events) {
      const node = this.nodes.get(event.clock);
      if (!node) continue;
      this.clockValues.set(
        event.clock,
        formatBinary(this.values.get(event.clock) ?? 0n, node.width),
      );
    }
  }

  private evaluate(tolerateDivideByZero = false): void {
    const values = new Map<string, bigint>();
    this.tolerateDivideByZero = tolerateDivideByZero;
    try {
      for (const id of this.order) {
        const node = this.nodes.get(id)!;
        let value: bigint;
        switch (node.kind) {
          case "input":
            value = normalize(this.inputs.get(node.inputName ?? "") ?? 0n, node.width);
            break;
          case "constant":
            value = normalize(bitsToBigInt(node.value), node.width);
            break;
          case "state":
            value = normalize(this.stateValues.get(node.id) ?? 0n, node.width);
            break;
          case "operation": {
            const operands = node.operands.map((operand) => {
              const operandValue = values.get(operand);
              if (operandValue === undefined) {
                throw new SimulationError(
                  "R404",
                  `Node ${node.label} depends on ${operand}, which was not evaluated.`,
                );
              }
              return operandValue;
            });
            value = this.evaluateOperation(node, operands);
            break;
          }
        }
        values.set(id, normalize(value, node.width));
      }
      this.values = values;
    } finally {
      this.tolerateDivideByZero = false;
    }
  }

  private evaluateOperation(node: CircuitNode, operands: bigint[]): bigint {
    const width = node.width;
    const mask = maskFor(width);
    const op = node.op ?? "";
    switch (op) {
      case "AND": {
        let result = mask;
        for (const operand of operands) result &= operand;
        return result;
      }
      case "OR": {
        let result = 0n;
        for (const operand of operands) result |= operand;
        return result;
      }
      case "XOR": {
        let result = 0n;
        for (const operand of operands) result ^= operand;
        return result;
      }
      case "NAND": {
        let result = mask;
        for (const operand of operands) result &= operand;
        return (~result) & mask;
      }
      case "NOR": {
        let result = 0n;
        for (const operand of operands) result |= operand;
        return (~result) & mask;
      }
      case "XNOR": {
        let result = 0n;
        for (const operand of operands) result ^= operand;
        return (~result) & mask;
      }
      case "NOT":
        return (~(operands[0] ?? 0n)) & mask;
      case "BUFFER":
        return operands[0] ?? 0n;
      case "ADD":
        return ((operands[0] ?? 0n) + (operands[1] ?? 0n)) & mask;
      case "SUBTRACT":
        return ((operands[0] ?? 0n) - (operands[1] ?? 0n)) & mask;
      case "MULTIPLY":
        return ((operands[0] ?? 0n) * (operands[1] ?? 0n)) & mask;
      case "DIVIDE": {
        const divisor = operands[1] ?? 0n;
        if (divisor === 0n) {
          const error = new SimulationError(
            "R500",
            `DIVIDE by zero in ${node.label}. Guard the divisor before dividing.`,
          );
          if (this.tolerateDivideByZero) {
            this.initialRuntimeError = error;
            return 0n;
          }
          throw error;
        }
        return ((operands[0] ?? 0n) / divisor) & mask;
      }
      case "EQUAL":
        return (operands[0] ?? 0n) === (operands[1] ?? 0n) ? 1n : 0n;
      case "LESS":
        return (operands[0] ?? 0n) < (operands[1] ?? 0n) ? 1n : 0n;
      case "GREATER":
        return (operands[0] ?? 0n) > (operands[1] ?? 0n) ? 1n : 0n;
      case "COMPARE": {
        const a = operands[0] ?? 0n;
        const b = operands[1] ?? 0n;
        return a === b ? 0n : a < b ? 1n : 2n;
      }
      case "MUX": {
        const select = operands[2] ?? 0n;
        return select === 0n ? (operands[0] ?? 0n) : (operands[1] ?? 0n);
      }
      case "CONCAT": {
        let result = 0n;
        for (let index = 0; index < operands.length; index++) {
          result =
            (result << BigInt(this.operandWidth(node, index))) |
            (operands[index] ?? 0n);
        }
        return result & mask;
      }
      case "SLICE": {
        const hi = Number(node.params?.hi ?? 0);
        const lo = Number(node.params?.lo ?? 0);
        return ((operands[0] ?? 0n) >> BigInt(lo)) & maskFor(hi - lo + 1);
      }
      case "SHIFT_LEFT": {
        const amount = BigInt(valueAsIndex(operands[1] ?? 0n));
        if (amount >= BigInt(width)) return 0n;
        return ((operands[0] ?? 0n) << amount) & mask;
      }
      case "SHIFT_RIGHT": {
        const amount = BigInt(valueAsIndex(operands[1] ?? 0n));
        if (amount >= BigInt(width)) return 0n;
        return (operands[0] ?? 0n) >> amount;
      }
      case "ZEXT": {
        return operands[0] ?? 0n;
      }
      case "SEXT": {
        const value = operands[0] ?? 0n;
        const sourceWidth = this.operandWidth(node, 0);
        const signBit = (value >> BigInt(Math.max(0, sourceWidth - 1))) & 1n;
        if (signBit === 0n) return value;
        const extension = maskFor(width) ^ maskFor(sourceWidth);
        return (value | extension) & mask;
      }
      case "POPCOUNT": {
        let value = operands[0] ?? 0n;
        let count = 0n;
        while (value > 0n) {
          count += value & 1n;
          value >>= 1n;
        }
        return count;
      }
      case "REDUCE_AND": {
        const sourceWidth = this.operandWidth(node, 0);
        const value = operands[0] ?? 0n;
        return value === maskFor(sourceWidth) ? 1n : 0n;
      }
      case "REDUCE_OR": {
        return (operands[0] ?? 0n) !== 0n ? 1n : 0n;
      }
      case "REDUCE_XOR": {
        let value = operands[0] ?? 0n;
        let parity = 0n;
        while (value > 0n) {
          parity ^= value & 1n;
          value >>= 1n;
        }
        return parity;
      }
      case "REPEAT": {
        const sourceWidth = this.operandWidth(node, 0);
        const count = Number(node.params?.count ?? 1);
        const value = operands[0] ?? 0n;
        let result = 0n;
        for (let index = 0; index < count; index += 1) {
          result = (result << BigInt(sourceWidth)) | value;
        }
        return result & mask;
      }
      case "REVERSE": {
        const sourceWidth = this.operandWidth(node, 0);
        const value = operands[0] ?? 0n;
        let result = 0n;
        for (let index = 0; index < sourceWidth; index += 1) {
          const bit = (value >> BigInt(index)) & 1n;
          result |= bit << BigInt(sourceWidth - 1 - index);
        }
        return result;
      }
      case "DECODER": {
        const select = valueAsIndex(operands[0] ?? 0n);
        if (select >= width) return 0n;
        return 1n << BigInt(select);
      }
      case "ENCODER": {
        const input = operands[0] ?? 0n;
        if (input === 0n) return 0n;
        return BigInt(input.toString(2).length - 1);
      }
      default:
        throw new SimulationError("R406", `Unsupported operation "${op}" in node ${node.id}.`);
    }
  }

  private operandWidth(node: CircuitNode, index: number): number {
    // CONCAT operands can differ in width; the IR's dependency nodes know best.
    const operandId = node.operands[index];
    const operandNode = operandId ? this.nodes.get(operandId) : undefined;
    return operandNode?.width ?? 1;
  }

  private topologicalOrder(): string[] {
    const order: string[] = [];
    const state = new Map<string, "visiting" | "done">();
    const visit = (id: string) => {
      const marker = state.get(id);
      if (marker === "done") return;
      if (marker === "visiting") {
        throw new SimulationError("R407", `Combinational loop detected at node ${id}.`);
      }
      const node = this.nodes.get(id);
      if (!node) {
        throw new SimulationError("R408", `IR references missing node ${id}.`);
      }
      state.set(id, "visiting");
      for (const operand of node.operands) visit(operand);
      state.set(id, "done");
      order.push(id);
    };
    for (const node of this.circuit.nodes) visit(node.id);
    return order;
  }
}
