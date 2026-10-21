import type {
  AssignmentAst,
  CallAst,
  CircuitAst,
  ConstExprAst,
  ExpressionAst,
  InputDeclAst,
  LiteralAst,
  OnBlockAst,
  OutputDeclAst,
  Path,
  ProgramAst,
  ReferenceAst,
  SequentialStatementAst,
  SourceSpan,
  StateDeclAst,
  TestAst,
  TestStatementAst,
} from "./ast";
import {
  BUILTINS,
  isReservedName as isCoreReservedName,
  lookupBuiltin,
  type BuiltinSpec,
} from "./builtins";
import {
  findPackageMacro,
  macroBodyForArity,
  type ImportResolution,
  type PackageCatalog,
  type ResolvedPackageMacro,
} from "./packages";
import { DiagnosticBag, suggestName } from "./diagnostics";
import { plainFor } from "./plainLanguage";
import { valueAsIndex } from "./values";
import { LANGUAGE_VERSION } from "./version";
import type {
  CircuitIR,
  CircuitInput,
  CircuitNode,
  CircuitOutput,
  CircuitState,
  ClockEvent,
  CompileOptions,
  CompileResult,
  Diagnostic,
  ProgramIR,
  TestCaseIR,
  TestExpectationIR,
  TestInputIR,
  TestInstructionIR,
  TestSuiteIR,
} from "./types";
import {
  bitLength,
  fitsWidth,
  formatBinary,
  maskFor,
  parseLanguageLiteral,
  parseNumericLiteral,
  parseTestLiteral,
  type BitValue,
} from "./values";

interface SignalDecl {
  kind: "input" | "state" | "assignment";
  name: string;
  width: number;
  line: number;
  column: number;
  ast?: AssignmentAst;
}

interface StateSpec {
  name: string;
  width: number;
  init: bigint;
  initBinary: string;
  line: number;
  column: number;
}

interface CircuitStructure {
  ast: CircuitAst;
  name: string;
  /** Set when the circuit came from a package. */
  packageName?: string;
  inputs: CircuitInput[];
  inputWidths: Map<string, number>;
  states: StateSpec[];
  stateByName: Map<string, StateSpec>;
  assignments: Map<string, AssignmentAst>;
  signals: Map<string, SignalDecl>;
  outputs: OutputDeclAst[];
  outputFullNames: Set<string>;
  ons: OnBlockAst[];
  line: number;
  column: number;
}

interface ValueRef {
  node: string;
  width: number;
}

interface ResolvedValue {
  kind: "value";
  ref: ValueRef;
  origin: "input" | "state" | "assignment";
}

interface ResolvedBundle {
  kind: "bundle";
  circuit: string;
  outputs: Map<string, ValueRef>;
  shortOutputs: Map<string, ValueRef>;
}

type ResolvedEntry = ResolvedValue | ResolvedBundle;

/** Per-case state used while compiling a test program. */
interface TestCaseContext {
  inputByName: Map<string, CircuitInput>;
  outputByName: Map<string, CircuitOutput>;
  outputByPort: Map<string, CircuitOutput>;
  stateByName: Map<string, CircuitState>;
  inputs: TestInputIR[];
  expectations: TestExpectationIR[];
  assigned: Set<string>;
  expected: Set<string>;
  duplicateInputs: Array<{ name: string; line: number; column: number }>;
  duplicateExpects: Array<{ name: string; line: number; column: number }>;
  /** True when the case uses STEP, CYCLE, or LOAD. */
  sequential: boolean;
}

interface NameEntry {
  kind: "input" | "state" | "assignment";
  name: string;
  ast?: AssignmentAst;
}

interface BuildContext {
  nodeIds: Set<string>;
  states: CircuitState[];
  events: ClockEvent[];
  instances: number;
  maxDepth: number;
  limitHit: boolean;
}

const DEFAULT_OPTIONS: Required<CompileOptions> = {
  maxNodes: 20_000,
  maxDepth: 32,
  maxInstances: 500,
  maxWidth: 4096,
  maxDiagnostics: 100,
  packages: [],
  disableDefaultPackages: false,
  enabledPackages: [],
  disabledPackages: [],
};

const EMPTY_IMPORT_RESOLUTION: ImportResolution = {
  aliases: new Map(),
  unqualifiedPackages: new Set(),
  importedPackages: new Set(),
  imports: [],
  diagnostics: [],
};

function spanLine(span: SourceSpan): number {
  return span.line;
}

function spanColumn(span: SourceSpan): number {
  return span.column;
}

function joinName(scope: string[], name: string): string {
  return [...scope, name].join(".");
}

function pathName(path: Path): string {
  return path.map((segment) => segment.name).join(".");
}

function exprDescription(expr: ExpressionAst): string {
  switch (expr.kind) {
    case "Literal":
      return expr.raw;
    case "Reference":
      return pathName(expr.path);
    case "Call":
      return `${expr.name}(...)`;
    case "Index":
      return `${exprDescription(expr.target)}[?]`;
    case "Slice":
      return `${exprDescription(expr.target)}[?]`;
  }
}

function uniqueMap<T>(entries: Array<[string, T]>): Map<string, T> {
  return new Map(entries);
}

export class ProgramAnalyzer {
  private readonly bag: DiagnosticBag;
  private readonly options: Required<CompileOptions>;
  private readonly nodeMap = new Map<string, CircuitNode>();
  private nodeCount = 0;
  private opSerial = 0;
  private constantSerial = 0;
  private eventSerial = 0;
  private readonly structures = new Map<string, CircuitStructure>();
  private readonly structuresInOrder: CircuitStructure[] = [];
  private readonly circuits: CircuitIR[] = [];
  private readonly tests: TestSuiteIR[] = [];
  private readonly internalCircuitNames: Set<string>;
  private instanceCounter = 0;
  private nodeLimitReported = false;

  constructor(
    private readonly source: string,
    private readonly program: ProgramAst,
    options: CompileOptions = {},
    parserDiagnostics: Diagnostic[] = [],
    private readonly packageCatalog: PackageCatalog = {
      packages: [],
      macros: new Map(),
      circuits: [],
      diagnostics: [],
    },
    private readonly importResolution: ImportResolution = EMPTY_IMPORT_RESOLUTION,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.bag = new DiagnosticBag(this.options.maxDiagnostics);
    this.internalCircuitNames = new Set(packageCatalog.circuits.map((entry) => entry.circuit.name));
    for (const diagnostic of parserDiagnostics) this.bag.add(diagnostic);
    for (const diagnostic of packageCatalog.diagnostics) this.bag.add(diagnostic);
    for (const diagnostic of importResolution.diagnostics) this.bag.add(diagnostic);
  }

  analyze(): CompileResult {
    const started = Date.now();
    this.buildStructures();

    for (const structure of this.structuresInOrder) {
      if (this.internalCircuitNames.has(structure.name)) continue;
      this.buildTopCircuit(structure);
    }

    this.compileTests();

    const diagnostics = this.bag.sorted().map((diagnostic) => {
      const plain = plainFor(diagnostic);
      return plain ? { ...diagnostic, plain } : diagnostic;
    });
    const ok = !this.bag.blocked;
    const ir: ProgramIR | null = ok
      ? {
          schema: "shortcircuit.ir/v1",
          language: LANGUAGE_VERSION,
          circuits: this.circuits,
          tests: this.tests,
        }
      : null;

    return {
      ok,
      source: this.source,
      diagnostics,
      circuits: this.circuits,
      tests: this.tests,
      ir,
      elapsedMs: Date.now() - started,
    };
  }

  private buildStructures(): void {
    for (const circuit of this.program.circuits) {
      if (circuit.name === "_invalid_") continue;
      if (this.structures.has(circuit.name)) {
        const previous = this.structures.get(circuit.name)!;
        this.bag.error(
          "E202",
          `Duplicate circuit name "${circuit.name}".`,
          circuit.span.line,
          circuit.span.column,
          {
            hint: "Circuit names are case-sensitive and must be unique.",
            related: [
              {
                message: "First definition is here.",
                line: previous.line,
                column: previous.column,
              },
            ],
          },
        );
        continue;
      }
      const structure = this.buildStructure(circuit, circuit.packageName);
      this.structures.set(structure.name, structure);
      this.structuresInOrder.push(structure);
    }
  }

  private buildStructure(ast: CircuitAst, packageName?: string): CircuitStructure {
    const line = ast.span.line;
    const column = ast.span.column;
    if (this.isReservedName(ast.name, Boolean(packageName))) {
      this.bag.error(
        "E200",
        `"${ast.name}" is reserved and cannot be used as a circuit name.`,
        line,
        column,
        { hint: "Choose a name that is not a keyword or built-in component." },
      );
    }

    const signals = new Map<string, SignalDecl>();
    const inputs: CircuitInput[] = [];
    const inputWidths = new Map<string, number>();
    const states: StateSpec[] = [];
    const stateByName = new Map<string, StateSpec>();
    const assignments = new Map<string, AssignmentAst>();
    const outputFullNames = new Set<string>();
    const outputs: OutputDeclAst[] = [];
    const ons: OnBlockAst[] = [];

    const declare = (decl: SignalDecl): boolean => {
      if (this.isReservedName(decl.name, Boolean(packageName))) {
        this.bag.error(
          "E200",
          `"${decl.name}" is reserved and cannot be used as a signal name.`,
          decl.line,
          decl.column,
          {
            hint: "Keywords and built-in gate names are reserved. Try a descriptive name such as data_in.",
          },
        );
      }
      const previous = signals.get(decl.name);
      if (previous) {
        this.bag.error(
          "E202",
          `Signal "${decl.name}" is defined more than once.`,
          decl.line,
          decl.column,
          {
            hint: "Every signal gets exactly one definition in a circuit.",
            related: [
              {
                message: `Previous definition as ${previous.kind}.`,
                line: previous.line,
                column: previous.column,
              },
            ],
          },
        );
        return false;
      }
      signals.set(decl.name, decl);
      return true;
    };

    for (const item of ast.body) {
      if (item.kind === "Input") {
        const width = this.constNumber(item.width, `Width of input "${item.name}"`) ?? 1;
        this.checkWidth(width, item.span, `Input ${item.name}`);
        const declared = declare({
          kind: "input",
          name: item.name,
          width,
          line: item.span.line,
          column: item.span.column,
        });
        if (declared) {
          inputs.push({
            name: item.name,
            width,
            line: item.span.line,
            column: item.span.column,
          });
          inputWidths.set(item.name, width);
        }
      } else if (item.kind === "State") {
        const state = this.buildStateSpec(item);
        if (declare({
          kind: "state",
          name: item.name,
          width: state.width,
          line: item.span.line,
          column: item.span.column,
        })) {
          states.push(state);
          stateByName.set(state.name, state);
        }
      } else if (item.kind === "Assignment") {
        if (item.target.length !== 1) {
          this.bag.error(
            "E207",
            "An assignment target must be a single signal name.",
            item.span.line,
            item.span.column,
            {
              hint:
                "Assign a circuit instance to a name first, then access its outputs with name.port.",
            },
          );
          continue;
        }
        const name = item.target[0]!.name;
        const declared = declare({
          kind: "assignment",
          name,
          width: 1,
          line: item.span.line,
          column: item.span.column,
          ast: item,
        });
        if (declared) assignments.set(name, item);
      } else if (item.kind === "Output") {
        const fullName = pathName(item.path);
        if (outputFullNames.has(fullName)) {
          this.bag.error(
            "E208",
            `Output "${fullName}" is declared more than once.`,
            item.span.line,
            item.span.column,
          );
          continue;
        }
        outputFullNames.add(fullName);
        outputs.push(item);
      } else if (item.kind === "On") {
        ons.push(item);
      }
    }

    return {
      ast,
      name: ast.name,
      packageName,
      inputs,
      inputWidths,
      states,
      stateByName,
      assignments,
      signals,
      outputs,
      outputFullNames,
      ons,
      line,
      column,
    };
  }

  private buildStateSpec(item: StateDeclAst): StateSpec {
    const init = item.init ? this.readLiteral(item.init, `initial value of ${item.name}`) : null;
    let width = this.constNumber(item.width, `Width of state "${item.name}"`);
    if (width === null && init === null) {
      this.bag.error(
        "E304",
        `State "${item.name}" needs a width or an initial value.`,
        item.span.line,
        item.span.column,
        {
          hint: `Write STATE ${item.name} : BUS(8) = 0 or STATE ${item.name} = 0.`,
        },
      );
      width = 1;
    }
    if (width === null) width = init?.width ?? 1;
    this.checkWidth(width, item.span, `State ${item.name}`);
    if (init && !fitsWidth(init.value, width)) {
      this.bag.error(
        "E305",
        `Initial value ${item.init?.raw} does not fit in the ${width}-bit state "${item.name}".`,
        item.init?.span.line ?? item.span.line,
        item.init?.span.column ?? item.span.column,
        { hint: `Use at most ${bitLength(maskFor(width))} bits, or widen the state.` },
      );
    }
    return {
      name: item.name,
      width,
      init: init?.value ?? 0n,
      initBinary: formatBinary(init?.value ?? 0n, width),
      line: item.span.line,
      column: item.span.column,
    };
  }

  private buildTopCircuit(structure: CircuitStructure): void {
    this.instanceCounter = 0;
    const context: BuildContext = {
      nodeIds: new Set(),
      states: [],
      events: [],
      instances: 0,
      maxDepth: 0,
      limitHit: false,
    };
    const builder = new ScopeBuilder(
      this,
      structure,
      structure.packageName,
      structure.name,
      [],
      true,
      new Map(),
      context,
      [structure.name],
      0,
    );
    const built = builder.build();
    this.validateEventConflicts(context);

    const nodes = [...context.nodeIds]
      .map((id) => this.nodeMap.get(id))
      .filter((node): node is CircuitNode => Boolean(node));
    const maxWidth = nodes.reduce((max, node) => Math.max(max, node.width), 0);
    const stateNames = new Set(context.states.map((state) => state.node));
    const inputs = structure.inputs;

    const outputs: CircuitOutput[] = built.outputs.map((output) => ({
      name: output.name,
      portName: output.portName,
      node: output.node,
      width: output.width,
      line: output.line,
      column: output.column,
    }));

    this.circuits.push({
      name: structure.name,
      line: structure.line,
      inputs,
      outputs,
      states: context.states,
      nodes,
      events: context.events,
      sequential: context.events.length > 0 || stateNames.size > 0,
      stats: {
        nodes: nodes.length,
        states: context.states.length,
        events: context.events.length,
        maxDepth: this.computeMaxDepth(nodes),
        maxWidth,
      },
    });
  }

  private validateEventConflicts(context: BuildContext): void {
    const seen = new Map<string, ClockEvent>();
    for (const event of context.events) {
      const key = `${event.edge}:${event.clock}:${event.updates.map((u) => u.state).join(",")}`;
      for (const update of event.updates) {
        const stateKey = `${event.edge}:${event.clock}:${update.state}`;
        const previous = seen.get(stateKey);
        if (previous) {
          this.bag.error(
            "E312",
            "A state signal has multiple clocked drivers on the same edge.",
            event.line,
            event.column,
            {
              hint:
                "Only one ON block may update a given state for a given clock edge. Combine the logic into one block.",
              related: [
                {
                  message: "Other clocked driver.",
                  line: previous.line,
                  column: previous.column,
                },
              ],
            },
          );
        } else {
          seen.set(stateKey, event);
        }
      }
      void key;
    }
  }

  private computeMaxDepth(nodes: CircuitNode[]): number {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const depths = new Map<string, number>();
    const visiting = new Set<string>();
    const visit = (id: string): number => {
      const cached = depths.get(id);
      if (cached !== undefined) return cached;
      if (visiting.has(id)) return 0;
      const node = byId.get(id);
      if (!node) return 0;
      if (node.operands.length === 0) {
        depths.set(id, 0);
        return 0;
      }
      visiting.add(id);
      let depth = 0;
      for (const operand of node.operands) depth = Math.max(depth, visit(operand) + 1);
      visiting.delete(id);
      depths.set(id, depth);
      return depth;
    };
    let max = 0;
    for (const node of nodes) max = Math.max(max, visit(node.id));
    return max;
  }

  private compileTests(): void {
    for (const test of this.program.tests) {
      this.compileTest(test);
    }
  }

  private compileTest(test: TestAst): void {
    const structure = this.structures.get(test.name);
    const circuit = this.circuits.find((entry) => entry.name === test.name);
    if (!structure || !circuit) {
      const suggestion = suggestName(test.name, this.structures.keys(), 3);
      this.bag.error(
        "E203",
        `TEST refers to unknown circuit "${test.name}".`,
        test.span.line,
        test.span.column,
        {
          hint: suggestion
            ? `Did you mean "${suggestion}"? Test names match circuit names exactly.`
            : "Declare the circuit before referencing it in a TEST block.",
          suggestion,
          length: test.name.length,
        },
      );
      return;
    }

    const inputByName = new Map(circuit.inputs.map((input) => [input.name, input]));
    const outputByName = new Map(circuit.outputs.map((output) => [output.name, output]));
    const outputByPort = new Map<string, CircuitOutput>();
    const duplicatePorts = new Set<string>();
    for (const output of circuit.outputs) {
      if (outputByPort.has(output.portName)) duplicatePorts.add(output.portName);
      else outputByPort.set(output.portName, output);
    }
    for (const duplicate of duplicatePorts) outputByPort.delete(duplicate);
    const stateByName = new Map(circuit.states.map((state) => [state.name, state]));

    const cases: TestCaseIR[] = [];
    for (const [caseIndex, testCase] of test.cases.entries()) {
      const context: TestCaseContext = {
        inputByName,
        outputByName,
        outputByPort,
        stateByName,
        inputs: [],
        expectations: [],
        assigned: new Set<string>(),
        expected: new Set<string>(),
        duplicateInputs: [],
        duplicateExpects: [],
        sequential: false,
      };

      const program = this.compileTestStatements(testCase.statements, context, false);

      if (!context.sequential && !circuit.sequential) {
        for (const input of circuit.inputs) {
          if (!context.assigned.has(input.name)) {
            this.bag.error(
              "E205",
              `Test case does not set input "${input.name}".`,
              testCase.span.line,
              testCase.span.column,
              {
                hint: "Set every circuit input in each test case so expected values are unambiguous.",
              },
            );
          }
        }
        for (const duplicate of context.duplicateInputs) {
          this.bag.error(
            "E209",
            `Input "${duplicate.name}" is assigned more than once in this test case.`,
            duplicate.line,
            duplicate.column,
            { hint: "A combinational test sets each input exactly once." },
          );
        }
        for (const duplicate of context.duplicateExpects) {
          this.bag.error(
            "E209",
            `Output "${duplicate.name}" is checked more than once in this test case.`,
            duplicate.line,
            duplicate.column,
            { hint: "A combinational test checks each output exactly once." },
          );
        }
      }

      if (context.expectations.length === 0) {
        this.bag.error(
          "E221",
          "Test case has no EXPECT statements.",
          testCase.span.line,
          testCase.span.column,
          { hint: "Add EXPECT output = value for at least one output." },
        );
      }

      cases.push({
        label: testCase.label || `Case ${caseIndex + 1}`,
        line: testCase.span.line,
        inputs: context.inputs,
        expectations: context.expectations,
        program,
      });
    }

    if (test.cases.length === 0) {
      this.bag.error(
        "E211",
        `TEST ${test.name} has no CASE blocks.`,
        test.span.line,
        test.span.column,
      );
    }

    this.tests.push({
      name: test.name,
      circuit: test.name,
      line: test.span.line,
      cases,
      runnable: true,
    });
  }

  /**
   * Compiles the ordered statements of a test case into IR instructions.
   * `STEP` blocks recurse, and `LOAD` is rejected inside them.
   */
  private compileTestStatements(
    statements: TestStatementAst[],
    context: TestCaseContext,
    insideStep: boolean,
  ): TestInstructionIR[] {
    const program: TestInstructionIR[] = [];

    for (const statement of statements) {
      if (statement.kind === "TestInput") {
        const port = context.inputByName.get(statement.name);
        if (!port) {
          const suggestion = suggestName(statement.name, context.inputByName.keys(), 3);
          this.bag.error(
            "E201",
            `Unknown input "${statement.name}" in test case.`,
            statement.span.line,
            statement.span.column,
            {
              hint: suggestion
                ? `Did you mean "${suggestion}"?`
                : `Available inputs: ${[...context.inputByName.keys()].join(", ") || "none"}.`,
              suggestion,
              length: statement.name.length,
            },
          );
          continue;
        }
        if (context.assigned.has(port.name)) {
          context.duplicateInputs.push({
            name: port.name,
            line: statement.span.line,
            column: statement.span.column,
          });
        } else {
          context.assigned.add(port.name);
        }
        const value = this.readTestLiteral(statement.value, `test input ${port.name}`, port.width);
        if (!fitsWidth(value.value, port.width)) {
          this.bag.error(
            "E305",
            `Value ${statement.value.raw} does not fit in ${port.width}-bit input "${port.name}".`,
            statement.span.line,
            statement.span.column,
          );
          continue;
        }
        const binary = formatBinary(value.value, port.width);
        context.inputs.push({
          name: port.name,
          width: port.width,
          value: binary,
          line: statement.span.line,
          column: statement.span.column,
        });
        program.push({
          kind: "input",
          name: port.name,
          width: port.width,
          value: binary,
          line: statement.span.line,
          column: statement.span.column,
        });
        continue;
      }

      if (statement.kind === "TestExpect") {
        const fullName = pathName(statement.path);
        const output =
          context.outputByName.get(fullName) ??
          (statement.path.length === 1
            ? context.outputByPort.get(statement.path[0]!.name)
            : undefined);
        const state = context.stateByName.get(fullName);

        if (!output && !state) {
          const candidates = [
            ...new Set([
              ...context.outputByName.keys(),
              ...context.outputByPort.keys(),
              ...context.stateByName.keys(),
            ]),
          ];
          const suggestion = suggestName(fullName, candidates, 3);
          this.bag.error(
            "E201",
            `Unknown output "${fullName}" in test case.`,
            statement.span.line,
            statement.span.column,
            {
              hint: suggestion
                ? `Did you mean "${suggestion}"?`
                : `Available outputs and state: ${candidates.join(", ") || "none"}.`,
              suggestion,
              length: fullName.length,
            },
          );
          continue;
        }

        const name = output ? output.name : state!.name;
        const width = output ? output.width : state!.width;
        if (context.expected.has(name)) {
          context.duplicateExpects.push({
            name,
            line: statement.span.line,
            column: statement.span.column,
          });
        } else {
          context.expected.add(name);
        }
        const value = this.readTestLiteral(statement.value, `expected value ${name}`, width);
        if (!fitsWidth(value.value, width)) {
          this.bag.error(
            "E305",
            `Expected value ${statement.value.raw} does not fit in ${width}-bit signal "${name}".`,
            statement.span.line,
            statement.span.column,
          );
          continue;
        }
        const binary = formatBinary(value.value, width);
        context.expectations.push({
          name: output ? output.portName : name,
          actualName: name,
          width,
          value: binary,
          line: statement.span.line,
          column: statement.span.column,
        });
        program.push({
          kind: "expect",
          name: output ? output.portName : name,
          actualName: name,
          target: output ? "output" : "state",
          width,
          value: binary,
          line: statement.span.line,
          column: statement.span.column,
        });
        continue;
      }

      if (statement.kind === "TestLoad") {
        const fullName = pathName(statement.path);
        const state = context.stateByName.get(fullName);
        if (!state) {
          const candidates = [...context.stateByName.keys()];
          const suggestion = suggestName(fullName, candidates, 3);
          this.bag.error(
            "E230",
            `LOAD target "${fullName}" is not a state signal.`,
            statement.span.line,
            statement.span.column,
            {
              hint: suggestion
                ? `Did you mean state "${suggestion}"?`
                : `LOAD can only set stored state. Available state: ${candidates.join(", ") || "none"}.`,
              suggestion,
              length: fullName.length,
            },
          );
          continue;
        }
        if (insideStep) {
          this.bag.error(
            "E232",
            "LOAD cannot be used inside a STEP block.",
            statement.span.line,
            statement.span.column,
            {
              hint: "LOAD sets a starting value, so it belongs at the top of a case, outside STEP.",
            },
          );
          continue;
        }
        const value = this.readTestLiteral(statement.value, `loaded value ${state.name}`, state.width);
        if (!fitsWidth(value.value, state.width)) {
          this.bag.error(
            "E305",
            `Value ${statement.value.raw} does not fit in the ${state.width}-bit state "${state.name}".`,
            statement.span.line,
            statement.span.column,
          );
          continue;
        }
        context.sequential = true;
        program.push({
          kind: "load",
          name: state.name,
          width: state.width,
          value: formatBinary(value.value, state.width),
          line: statement.span.line,
          column: statement.span.column,
        });
        continue;
      }

      if (statement.kind === "TestStep") {
        context.sequential = true;
        program.push({
          kind: "step",
          statements: this.compileTestStatements(statement.statements, context, true),
          line: statement.span.line,
          column: statement.span.column,
        });
        continue;
      }

      // TestCycle
      const clock = context.inputByName.get(statement.clock);
      if (!clock) {
        const suggestion = suggestName(statement.clock, context.inputByName.keys(), 3);
        this.bag.error(
          "E231",
          `CYCLE clock "${statement.clock}" is not an input of this circuit.`,
          statement.span.line,
          statement.span.column,
          {
            hint: suggestion
              ? `Did you mean "${suggestion}"?`
              : `Available inputs: ${[...context.inputByName.keys()].join(", ") || "none"}.`,
          },
        );
        continue;
      }
      if (clock.width !== 1) {
        this.bag.error(
          "E303",
          `CYCLE clock "${clock.name}" must be 1 bit, but is ${clock.width} bits.`,
          statement.span.line,
          statement.span.column,
          { hint: "CYCLE pulses a single clock line, for example CYCLE clock 3." },
        );
        continue;
      }
      if (statement.count < 1) {
        this.bag.error(
          "E125",
          `CYCLE count must be at least 1, but is ${statement.count}.`,
          statement.span.line,
          statement.span.column,
          { hint: "Write CYCLE clock 1 to pulse the clock once." },
        );
        continue;
      }
      context.sequential = true;
      program.push({
        kind: "cycle",
        clock: clock.name,
        count: statement.count,
        line: statement.span.line,
        column: statement.span.column,
      });
    }

    return program;
  }

  // ---- Shared services used by scope builders -----------------------------

  /** The original source text, used to point diagnostics at exact columns. */
  get sourceText(): string {
    return this.source;
  }

  addNode(node: CircuitNode, context: BuildContext): boolean {
    if (this.nodeCount >= this.options.maxNodes) {
      if (!this.nodeLimitReported) {
        this.nodeLimitReported = true;
        this.bag.error(
          "E320",
          `Circuit expansion exceeded the limit of ${this.options.maxNodes.toLocaleString()} nodes.`,
          node.line,
          node.column,
          {
            hint:
              "Reduce nested circuit depth or size, or raise the maxNodes compilation option for a trusted program.",
          },
        );
      }
      context.limitHit = true;
      return false;
    }
    if (this.nodeMap.has(node.id)) {
      this.bag.error(
        "E321",
        `Internal graph error: duplicate node id "${node.id}".`,
        node.line,
        node.column,
      );
      return false;
    }
    this.nodeCount += 1;
    this.nodeMap.set(node.id, node);
    context.nodeIds.add(node.id);
    return true;
  }

  nextOperationId(prefix: string): string {
    this.opSerial += 1;
    return `${prefix}/op:${this.opSerial}`;
  }

  nextConstantId(prefix: string): string {
    this.constantSerial += 1;
    return `${prefix}/const:${this.constantSerial}`;
  }

  nextEventId(prefix: string): string {
    this.eventSerial += 1;
    return `${prefix}/event:${this.eventSerial}`;
  }

  get widthLimit(): number {
    return this.options.maxWidth;
  }

  get maxInstances(): number {
    return this.options.maxInstances;
  }

  get maxDepth(): number {
    return this.options.maxDepth;
  }

  beginInstance(context: BuildContext, line: number, column: number): boolean {
    context.instances += 1;
    this.instanceCounter += 1;
    if (context.instances > this.options.maxInstances) {
      this.bag.error(
        "E322",
        `Circuit expansion exceeded the instance limit of ${this.options.maxInstances}.`,
        line,
        column,
      );
      return false;
    }
    return true;
  }

  error(code: string, message: string, line: number, column: number, hint?: string): void {
    this.bag.error(code, message, line, column, { hint });
  }

  /** Records a diagnostic that can offer a one-click rename. */
  errorWithSuggestion(
    code: string,
    message: string,
    line: number,
    column: number,
    suggestion: string | undefined,
    length: number,
    hint: string,
  ): void {
    this.bag.error(code, message, line, column, { hint, suggestion, length });
  }

  errorWithRelated(
    code: string,
    message: string,
    line: number,
    column: number,
    hint: string | undefined,
    related: Array<{ message: string; line: number; column: number }>,
  ): void {
    this.bag.error(code, message, line, column, { hint, related });
  }

  warning(code: string, message: string, line: number, column: number, hint?: string): void {
    this.bag.warning(code, message, line, column, { hint });
  }

  getStructure(name: string, requesterPackage?: string): CircuitStructure | undefined {
    const resolved = this.resolvePackageName(name);
    if (!resolved) return undefined;
    const structure = this.structures.get(resolved.exportName);
    if (!structure) return undefined;
    if (resolved.packageName) {
      return structure.packageName === resolved.packageName ? structure : undefined;
    }
    if (!structure.packageName) return structure;
    if (requesterPackage) return structure;
    return this.importResolution.unqualifiedPackages.has(structure.packageName)
      ? structure
      : undefined;
  }

  getPackageMacro(
    name: string,
    requesterPackage?: string,
  ): ResolvedPackageMacro | undefined {
    const resolved = this.resolvePackageName(name);
    if (!resolved) return undefined;
    const macro = findPackageMacro(this.packageCatalog, resolved.exportName);
    if (!macro) return undefined;
    if (resolved.packageName) {
      return macro.packageName === resolved.packageName ? macro : undefined;
    }
    if (requesterPackage) return macro;
    return this.importResolution.unqualifiedPackages.has(macro.packageName)
      ? macro
      : undefined;
  }

  /**
   * Normalize an optionally qualified name.
   *
   * `Pkg.AND` resolves through the import alias table; `AND` is left for the
   * caller to check against the project's unqualified package set.
   */
  private resolvePackageName(
    name: string,
  ): { exportName: string; packageName?: string } | null {
    if (!name.includes(".")) return { exportName: name };
    const parts = name.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const [alias, exportName] = parts;
    let packageName = this.importResolution.aliases.get(alias);
    if (!packageName) {
      for (const [candidate, candidatePackage] of this.importResolution.aliases) {
        if (candidate.toUpperCase() === alias!.toUpperCase()) {
          packageName = candidatePackage;
          break;
        }
      }
    }
    return packageName ? { exportName, packageName } : null;
  }

  /**
   * Keywords, core built-ins, package macros, and package circuits own their
   * names. Package sources may use their own circuit names for declarations.
   */
  isReservedName(name: string, allowPackageNames = false): boolean {
    return (
      isCoreReservedName(name) ||
      this.packageCatalog.macros.has(name.toUpperCase()) ||
      (!allowPackageNames && this.internalCircuitNames.has(name))
    );
  }

  getPackageMacros(): Iterable<ResolvedPackageMacro> {
    return this.packageCatalog.macros.values();
  }

  getStructures(): Iterable<CircuitStructure> {
    return this.structuresInOrder;
  }

  getNode(id: string): CircuitNode | undefined {
    return this.nodeMap.get(id);
  }

  readTestLiteral(literal: LiteralAst, context = "literal", targetWidth?: number): BitValue {
    try {
      const value = parseTestLiteral(literal.raw);
      this.warnAmbiguousLiteral(literal, "binary", targetWidth);
      if (value.width > this.options.maxWidth) {
        this.bag.error(
          "E320",
          `${context} is ${value.width} bits wide; the maximum supported width is ${this.options.maxWidth}.`,
          literal.span.line,
          literal.span.column,
        );
      }
      return value;
    } catch {
      this.bag.error(
        "E118",
        `Invalid number literal "${literal.raw}".`,
        literal.span.line,
        literal.span.column,
      );
      return { width: 1, value: 0n };
    }
  }

  readLiteral(literal: LiteralAst, context = "literal"): BitValue {
    try {
      const value = parseLanguageLiteral(literal.raw);
      this.warnAmbiguousLiteral(literal, "decimal");
      if (value.width > this.options.maxWidth) {
        this.bag.error(
          "E320",
          `${context} is ${value.width} bits wide; the maximum supported width is ${this.options.maxWidth}.`,
          literal.span.line,
          literal.span.column,
        );
      }
      return value;
    } catch {
      this.bag.error(
        "E118",
        `Invalid number literal "${literal.raw}".`,
        literal.span.line,
        literal.span.column,
      );
      return { width: 1, value: 0n };
    }
  }

  /** Reads a numeric width or index. */
  constNumber(expression: ConstExprAst | null, context: string): number | null {
    if (!expression) return null;
    return expression.value;
  }

  /**
   * Warns when a bare digit string could be read two ways, such as 10 or 11.
   * A leading zero makes both readings agree, so those are left alone.
   */
  private warnAmbiguousLiteral(
    literal: LiteralAst,
    reading: "decimal" | "binary",
    targetWidth?: number,
  ): void {
    const raw = literal.raw.replaceAll("_", "");
    if (!/^[01]+$/.test(raw) || raw.length < 2 || raw.startsWith("0")) return;
    const decimal = Number.parseInt(raw, 10);
    const binary = Number.parseInt(raw, 2);
    if (decimal === binary) return;
    if (reading === "decimal") {
      // Only a small number is plausibly meant as binary; a long run of digits
      // is obviously a bit pattern.
      if (decimal > 255) return;
    } else if (targetWidth !== undefined) {
      // In a test the value has to fit the port, so the two readings only clash
      // when the decimal one fits as well.
      if (decimal > 2 ** targetWidth - 1) return;
    }
    this.bag.warning(
      "W402",
      reading === "decimal"
        ? `"${literal.raw}" is read as the decimal number ${decimal}. Write 0b${raw} for the binary value ${binary}.`
        : `"${literal.raw}" is read as the binary value ${binary} in a test. Write 0b${raw} to be explicit.`,
      literal.span.line,
      literal.span.column,
      {
        hint:
          reading === "decimal"
            ? "Binary values always need the 0b prefix."
            : "Test values made only of 0 and 1 are read as binary.",
      },
    );
  }

  private checkWidth(width: number, span: SourceSpan, context: string): void {
    if (!Number.isSafeInteger(width) || width < 1) {
      this.bag.error(
        "E303",
        `${context} has invalid width ${width}.`,
        span.line,
        span.column,
        { hint: "Widths must be positive whole numbers." },
      );
    } else if (width > this.options.maxWidth) {
      this.bag.error(
        "E320",
        `${context} is ${width} bits wide; the maximum supported width is ${this.options.maxWidth}.`,
        span.line,
        span.column,
      );
    }
  }
}

interface BuiltOutput {
  name: string;
  portName: string;
  node: string;
  width: number;
  line: number;
  column: number;
}

class ScopeBuilder {
  private readonly entries = new Map<string, NameEntry>();
  private readonly resolved = new Map<string, ResolvedEntry>();
  private readonly resolving: string[] = [];
  private readonly stateRefs = new Map<string, ValueRef>();
  private readonly onBlocks: OnBlockAst[];

  constructor(
    private readonly analyzer: ProgramAnalyzer,
    private readonly structure: CircuitStructure,
    private readonly packageName: string | undefined,
    private readonly prefix: string,
    private readonly scope: string[],
    private readonly topLevel: boolean,
    private readonly inputBindings: Map<string, ValueRef>,
    private readonly context: BuildContext,
    private readonly stack: string[],
    private readonly depth: number,
  ) {
    this.onBlocks = structure.ons;
  }

  build(): { outputs: BuiltOutput[] } {
    this.declareEntries();
    for (const name of this.structure.assignments.keys()) {
      this.resolveEntry(name);
    }
    const outputs = this.resolveOutputs();
    this.compileEvents();
    return { outputs };
  }

  private declareEntries(): void {
    for (const input of this.structure.inputs) {
      let binding = this.inputBindings.get(input.name);
      if (!binding) {
        if (this.topLevel) {
          binding = {
            node: `${this.prefix}/in:${input.name}`,
            width: input.width,
          };
          this.addNode({
            id: binding.node,
            kind: "input",
            width: input.width,
            label: input.name,
            scope: this.scope,
            operands: [],
            inputName: input.name,
            line: input.line,
            column: input.column,
          });
        } else {
          binding = this.createConstant(0n, input.width, input.line, input.column, "0");
          this.analyzer.error(
            "E323",
            `Internal instance binding error: input "${input.name}" is not connected.`,
            input.line,
            input.column,
          );
        }
      }
      this.entries.set(input.name, { kind: "input", name: input.name });
      this.resolved.set(input.name, {
        kind: "value",
        ref: binding,
        origin: "input",
      });
    }

    for (const state of this.structure.states) {
      const node = `${this.prefix}/state:${state.name}`;
      this.addNode({
        id: node,
        kind: "state",
        width: state.width,
        label: state.name,
        scope: this.scope,
        operands: [],
        value: state.initBinary,
        line: state.line,
        column: state.column,
      });
      this.stateRefs.set(state.name, { node, width: state.width });
      this.entries.set(state.name, { kind: "state", name: state.name });
      this.resolved.set(state.name, {
        kind: "value",
        ref: { node, width: state.width },
        origin: "state",
      });
      this.context.states.push({
        name: joinName(this.scope, state.name),
        node,
        width: state.width,
        init: state.initBinary,
        line: state.line,
        column: state.column,
      });
    }

    for (const [name, ast] of this.structure.assignments) {
      this.entries.set(name, { kind: "assignment", name, ast });
    }
  }

  private resolveEntry(name: string): ResolvedEntry | undefined {
    const cached = this.resolved.get(name);
    if (cached) return cached;
    const entry = this.entries.get(name);
    if (!entry) return undefined;

    if (entry.kind === "assignment") {
      if (this.resolving.includes(name)) {
        const cycle = [...this.resolving.slice(this.resolving.indexOf(name)), name];
        this.analyzer.errorWithRelated(
          "E310",
          "Combinational feedback detected.",
          entry.ast?.span.line ?? 1,
          entry.ast?.span.column ?? 1,
          "Use a STATE signal and a clocked block if this feedback is intended to store state.",
          [
            {
              message: `Dependency cycle: ${cycle.join(" -> ")}`,
              line: entry.ast?.span.line ?? 1,
              column: entry.ast?.span.column ?? 1,
            },
          ],
        );
        return {
          kind: "value",
          ref: this.fallbackRef(entry.ast?.span.line ?? 1, entry.ast?.span.column ?? 1),
          origin: "assignment",
        };
      }

      this.resolving.push(name);
      let result: ResolvedEntry;
      try {
        result = this.resolveAssignment(name, entry.ast!);
      } finally {
        this.resolving.pop();
      }
      this.resolved.set(name, result);
      return result;
    }

    return this.resolved.get(name);
  }

  private resolveAssignment(name: string, ast: AssignmentAst): ResolvedEntry {
    if (ast.value.kind === "Call" && this.isBundleCall(ast.value.name)) {
      return this.instantiateCall(ast.value, name);
    }
    const ref = this.resolveExpression(ast.value, name);
    return { kind: "value", ref, origin: "assignment" };
  }

  private isBundleCall(name: string): boolean {
    return Boolean(this.analyzer.getStructure(name, this.packageName));
  }

  private resolveReference(
    reference: ReferenceAst,
    macroBindings?: Map<string, ValueRef>,
  ): ValueRef {
    const [first, ...rest] = reference.path;
    if (!first) return this.fallbackRef(reference.span.line, reference.span.column);
    const base = first.name;
    const macroRef = macroBindings?.get(base);
    if (macroRef) {
      if (rest.length > 0) {
        this.analyzer.error(
          "E212",
          `Macro parameter "${base}" has no ports, so "${pathName(reference.path)}" cannot be accessed.`,
          reference.span.line,
          reference.span.column,
        );
        return macroRef;
      }
      return macroRef;
    }
    const entry = this.entries.get(base);
    if (!entry) {
      const suggestion = suggestName(base, this.entries.keys(), 2);
      const available = [...this.entries.keys()];
      this.analyzer.errorWithSuggestion(
        "E201",
        `Unknown signal "${base}".`,
        reference.span.line,
        reference.span.column,
        suggestion,
        base.length,
        suggestion
          ? `Did you mean "${suggestion}"? Available signals: ${available.join(", ") || "none"}.`
          : `Available signals: ${available.join(", ") || "none"}.`,
      );
      return this.fallbackRef(reference.span.line, reference.span.column);
    }

    const resolved = this.resolveEntry(base);
    if (!resolved) return this.fallbackRef(reference.span.line, reference.span.column);

    if (resolved.kind === "value") {
      if (rest.length > 0) {
        this.analyzer.error(
          "E212",
          `Signal "${base}" has no ports, so "${pathName(reference.path)}" cannot be accessed.`,
          reference.span.line,
          reference.span.column,
          "Only a circuit instance exposes named outputs. Use a scalar signal directly.",
        );
        return resolved.ref;
      }
      return resolved.ref;
    }

    if (rest.length === 0) {
      const outputs = [...resolved.outputs.keys()];
      this.analyzer.error(
        "E213",
        `"${base}" is a circuit instance, not a signal.`,
        reference.span.line,
        reference.span.column,
        outputs.length
          ? `Access one of its outputs instead: ${outputs
              .slice(0, 4)
              .map((output) => `${base}.${output}`)
              .join(", ")}${outputs.length > 4 ? ", ..." : ""}.`
          : "The instance has no outputs.",
      );
      return this.fallbackRef(reference.span.line, reference.span.column);
    }

    const full = rest.map((segment) => segment.name).join(".");
    const output =
      resolved.outputs.get(full) ??
      (rest.length === 1 ? resolved.shortOutputs.get(rest[0]!.name) : undefined);
    if (!output) {
      const candidates = [...new Set([...resolved.outputs.keys(), ...resolved.shortOutputs.keys()])];
      const suggestion = suggestName(full, candidates, 3);
      this.analyzer.errorWithSuggestion(
        "E204",
        `Circuit instance "${base}" has no output "${full}".`,
        reference.span.line,
        reference.span.column,
        suggestion ? `${base}.${suggestion}` : undefined,
        full.length,
        suggestion
          ? `Did you mean "${base}.${suggestion}"?`
          : `Available outputs: ${candidates.join(", ") || "none"}.`,
      );
      return this.fallbackRef(reference.span.line, reference.span.column);
    }
    return output;
  }

  private resolveExpression(
    expr: ExpressionAst,
    preferredLabel?: string,
    macroBindings?: Map<string, ValueRef>,
  ): ValueRef {
    switch (expr.kind) {
      case "Literal": {
        const literal = this.analyzer.readLiteral(expr);
        return this.createConstant(
          literal.value,
          literal.width,
          expr.span.line,
          expr.span.column,
          preferredLabel ?? expr.raw,
        );
      }
      case "Reference":
        return this.resolveReference(expr, macroBindings);
      case "Call":
        return this.compileCall(expr, preferredLabel, macroBindings);
      case "Index": {
        const index = this.analyzer.constNumber(expr.index, "Bit index");
        if (index === null) return this.fallbackRef(expr.span.line, expr.span.column);
        return this.compileSlice(expr.target, index, index, expr.span, preferredLabel, macroBindings);
      }
      case "Slice": {
        const hi = this.analyzer.constNumber(expr.hi, "Slice bound");
        const lo = this.analyzer.constNumber(expr.lo, "Slice bound");
        if (hi === null || lo === null) return this.fallbackRef(expr.span.line, expr.span.column);
        return this.compileSlice(expr.target, hi, lo, expr.span, preferredLabel, macroBindings);
      }
    }
  }

  private compileSlice(
    target: ExpressionAst,
    hi: number,
    lo: number,
    span: SourceSpan,
    preferredLabel?: string,
    macroBindings?: Map<string, ValueRef>,
  ): ValueRef {
    const ref = this.resolveExpression(target, undefined, macroBindings);
    if (!Number.isInteger(hi) || !Number.isInteger(lo) || hi < 0 || lo < 0) {
      this.analyzer.error(
        "E214",
        "Slice indexes must be non-negative whole numbers.",
        span.line,
        span.column,
      );
      return this.fallbackRef(span.line, span.column);
    }
    if (hi < lo) {
      this.analyzer.error(
        "E215",
        `Slice upper index ${hi} is smaller than lower index ${lo}.`,
        span.line,
        span.column,
        "LogicFlow slices use [high:low], for example data[7:4].",
      );
      return this.fallbackRef(span.line, span.column);
    }
    if (hi >= ref.width) {
      this.analyzer.error(
        "E216",
        `Bit index ${hi} is outside the ${ref.width}-bit signal range 0..${ref.width - 1}.`,
        span.line,
        span.column,
      );
      return this.fallbackRef(span.line, span.column);
    }
    const width = hi - lo + 1;
    const id = this.analyzer.nextOperationId(this.prefix);
    this.addNode({
      id,
      kind: "operation",
      op: "SLICE",
      width,
      label: preferredLabel ?? `${exprDescription(target)}[${hi === lo ? hi : `${hi}:${lo}`}]`,
      scope: this.scope,
      operands: [ref.node],
      params: { hi, lo },
      line: span.line,
      column: span.column,
    });
    return { node: id, width };
  }

  private compileCall(
    call: CallAst,
    preferredLabel?: string,
    macroBindings?: Map<string, ValueRef>,
  ): ValueRef {
    const packageMacro = this.analyzer.getPackageMacro(call.name, this.packageName);
    if (packageMacro) {
      return this.compileMacroCall(call, packageMacro, preferredLabel, macroBindings);
    }
    if (this.isBundleCall(call.name)) {
      this.analyzer.error(
        "E217",
        `Circuit instance "${call.name}" must be assigned to a name before its outputs are used.`,
        call.span.line,
        call.span.column,
        `Write instance = ${call.name}(...) on its own line, then use instance.output.`,
      );
      return this.fallbackRef(call.span.line, call.span.column);
    }

    const spec = lookupBuiltin(call.name);
    if (!spec) {
      const candidates = [
        ...new Set([
          ...[...this.analyzer.getStructures()].map((entry) => entry.name),
          ...BUILTIN_NAMES,
          ...[...this.analyzer.getPackageMacros()].map((macro) => macro.name),
        ]),
      ];
      const suggestion = suggestName(call.name, candidates, 3);
      this.analyzer.errorWithSuggestion(
        "E210",
        `Unknown component or function "${call.name}".`,
        call.span.line,
        call.span.column,
        suggestion,
        call.name.length,
        suggestion
          ? `Did you mean ${suggestion}(...)?`
          : "Use a built-in gate/component or define a CIRCUIT with that name.",
      );
      return this.fallbackRef(call.span.line, call.span.column);
    }

    if (call.args.some((arg) => arg.name !== null)) {
      this.analyzer.error(
        "E218",
        `Built-in function ${spec.name} uses positional arguments, not named arguments.`,
        call.span.line,
        call.span.column,
        `Write ${spec.name}(${call.args.map((arg) => exprDescription(arg.value)).join(", ")}).`,
      );
    }

    const refs = call.args.map((arg) => this.resolveExpression(arg.value, undefined, macroBindings));
    const argExprs = call.args.map((arg) => arg.value);
    if (call.args.length < spec.minArgs || call.args.length > spec.maxArgs) {
      this.analyzer.error(
        "E302",
        `${spec.name} expects ${arityText(spec)}, but received ${call.args.length}.`,
        call.span.line,
        call.span.column,
        this.arityHint(spec),
      );
      return this.fallbackRef(call.span.line, call.span.column);
    }

    switch (spec.name) {
      case "NAND": {
        const width = this.commonWidth(refs, argExprs, spec.name, call.span);
        return this.addOperation(spec.name, width, preferredLabel ?? spec.name, refs.map((ref) => ref.node), call.span, {
          arity: call.args.length,
        });
      }
      case "CONCAT": {
        const width = refs.reduce((total, ref) => total + ref.width, 0);
        if (width <= 0 || width > this.analyzer.widthLimit) {
          this.analyzer.error(
            "E320",
            `CONCAT result would be ${width} bits; the maximum supported width is ${this.analyzer.widthLimit}.`,
            call.span.line,
            call.span.column,
          );
          return this.fallbackRef(call.span.line, call.span.column);
        }
        return this.addOperation(
          "CONCAT",
          width,
          preferredLabel ?? "CONCAT",
          refs.map((ref) => ref.node),
          call.span,
          { parts: refs.length },
        );
      }
      case "SLICE": {
        const high = this.constantArgument(call, argExprs[1], "SLICE upper index");
        const low = this.constantArgument(call, argExprs[2], "SLICE lower index");
        if (high === null || low === null) return this.fallbackRef(call.span.line, call.span.column);
        if (high < low) {
          this.analyzer.error(
            "E215",
            `SLICE upper index ${high} is smaller than lower index ${low}.`,
            call.span.line,
            call.span.column,
            "SLICE(value, high, low) uses inclusive high and low bounds.",
          );
          return this.fallbackRef(call.span.line, call.span.column);
        }
        if (high >= refs[0]!.width) {
          this.analyzer.error(
            "E216",
            `SLICE upper index ${high} is outside the ${refs[0]!.width}-bit input.`,
            call.span.line,
            call.span.column,
          );
          return this.fallbackRef(call.span.line, call.span.column);
        }
        return this.addOperation(
          "SLICE",
          high - low + 1,
          preferredLabel ?? "SLICE",
          [refs[0]!.node],
          call.span,
          { hi: high, lo: low },
        );
      }
      case "BROADCAST": {
        const valueRef = refs[1];
        if (!valueRef) return this.fallbackRef(call.span.line, call.span.column);
        const select = this.coerce(
          refs[0]!,
          1,
          argExprs[0]!,
          "BROADCAST select",
          call.span,
        );
        if (select.width !== 1) return this.fallbackRef(call.span.line, call.span.column);
        return this.addOperation(
          "BROADCAST",
          valueRef.width,
          preferredLabel ?? "BROADCAST",
          [select.node],
          call.span,
          { sourceWidth: valueRef.width },
        );
      }
      case "ZEXT":
      case "SEXT": {
        const target = this.constantArgument(call, argExprs[1], `${spec.name} width`);
        if (target === null) return this.fallbackRef(call.span.line, call.span.column);
        if (target < 1) {
          this.analyzer.error(
            "E303",
            `${spec.name} width must be at least 1, but is ${target}.`,
            call.span.line,
            call.span.column,
            `Write ${spec.name}(value, 8) to widen a value to eight bits.`,
          );
          return this.fallbackRef(call.span.line, call.span.column);
        }
        if (target < refs[0]!.width) {
          this.analyzer.error(
            "E332",
            `${spec.name} width ${target} is smaller than the ${refs[0]!.width}-bit value.`,
            call.span.line,
            call.span.column,
            `${spec.name} only widens a value. Use SLICE(value, ${target - 1}, 0) to narrow it.`,
          );
          return this.fallbackRef(call.span.line, call.span.column);
        }
        return this.addOperation(
          spec.name,
          target,
          preferredLabel ?? spec.name,
          [refs[0]!.node],
          call.span,
          { sourceWidth: refs[0]!.width },
        );
      }
      case "REPEAT": {
        const count = this.constantArgument(call, argExprs[1], "REPEAT count");
        if (count === null) return this.fallbackRef(call.span.line, call.span.column);
        if (count < 1) {
          this.analyzer.error(
            "E303",
            `REPEAT count must be at least 1, but is ${count}.`,
            call.span.line,
            call.span.column,
            "Write REPEAT(value, 2) to repeat a value twice.",
          );
          return this.fallbackRef(call.span.line, call.span.column);
        }
        const sourceWidth = refs[0]!.width;
        const width = sourceWidth * count;
        if (width > this.analyzer.widthLimit) {
          this.analyzer.error(
            "E320",
            `REPEAT would produce ${width} bits; the maximum supported width is ${this.analyzer.widthLimit}.`,
            call.span.line,
            call.span.column,
          );
          return this.fallbackRef(call.span.line, call.span.column);
        }
        return this.addOperation(
          "REPEAT",
          width,
          preferredLabel ?? spec.name,
          [refs[0]!.node],
          call.span,
          { count, sourceWidth },
        );
      }
      case "REVERSE": {
        return this.addOperation(
          "REVERSE",
          refs[0]!.width,
          preferredLabel ?? spec.name,
          [refs[0]!.node],
          call.span,
          { sourceWidth: refs[0]!.width },
        );
      }
      default:
        return this.fallbackRef(call.span.line, call.span.column);
    }
  }

  private compileMacroCall(
    call: CallAst,
    macro: ResolvedPackageMacro,
    preferredLabel?: string,
    outerBindings?: Map<string, ValueRef>,
  ): ValueRef {
    if (call.args.some((arg) => arg.name !== null)) {
      this.analyzer.error(
        "E218",
        `Package macro ${macro.name} uses positional arguments, not named arguments.`,
        call.span.line,
        call.span.column,
        `Write ${macro.name}(${call.args.map((arg) => exprDescription(arg.value)).join(", ")}).`,
      );
    }
    const refs = call.args.map((arg) =>
      this.resolveExpression(arg.value, undefined, outerBindings),
    );
    return this.compileMacroWithRefs(macro, refs, call.span, preferredLabel);
  }

  private compileMacroWithRefs(
    macro: ResolvedPackageMacro,
    refs: ValueRef[],
    span: SourceSpan,
    preferredLabel?: string,
  ): ValueRef {
    const min = macro.minArgs ?? macro.args.length;
    const max = macro.maxArgs === null || macro.maxArgs === undefined
      ? Number.POSITIVE_INFINITY
      : macro.maxArgs;
    if (refs.length < min || refs.length > max) {
      const expectation = max === Number.POSITIVE_INFINITY
        ? `at least ${min} argument${min === 1 ? "" : "s"}`
        : min === max
          ? `${min} argument${min === 1 ? "" : "s"}`
          : `${min} to ${max} arguments`;
      this.analyzer.error(
        "E302",
        `${macro.name} expects ${expectation}, but received ${refs.length}.`,
        span.line,
        span.column,
        macro.signature ? `Signature: ${macro.signature}.` : undefined,
      );
      return this.fallbackRef(span.line, span.column);
    }

    if (macro.fold) {
      const foldMacro = this.analyzer.getPackageMacro(macro.fold, this.packageName);
      if (!foldMacro) {
        this.analyzer.error(
          "E999",
          `Package macro ${macro.name} references missing fold helper ${macro.fold}.`,
          span.line,
          span.column,
        );
        return this.fallbackRef(span.line, span.column);
      }
      let result = refs[0]!;
      for (let index = 1; index < refs.length; index += 1) {
        result = this.compileMacroWithRefs(
          foldMacro,
          [result, refs[index]!],
          span,
          preferredLabel,
        );
      }
      return result;
    }

    const body = macroBodyForArity(macro, refs.length);
    if (!body.ast) {
      this.analyzer.error(
        "E999",
        body.error ?? macro.parseError ?? `Package macro ${macro.name} has no body.`,
        span.line,
        span.column,
      );
      return this.fallbackRef(span.line, span.column);
    }

    const bindings = new Map<string, ValueRef>();
    for (let index = 0; index < macro.args.length; index += 1) {
      const ref = refs[index];
      if (ref) bindings.set(macro.args[index]!, ref);
    }
    for (let index = 0; index < body.restNames.length; index += 1) {
      const ref = refs[macro.args.length + index];
      if (ref) bindings.set(body.restNames[index]!, ref);
    }
    return this.resolveExpression(body.ast, preferredLabel ?? macro.name, bindings);
  }

  private constantArgument(call: CallAst, expr: ExpressionAst | undefined, context: string): number | null {
    if (!expr || expr.kind !== "Literal") {
      this.analyzer.error(
        "E219",
        `${context} must be a number literal.`,
        expr?.span.line ?? call.span.line,
        expr?.span.column ?? call.span.column,
        "Slice indexes are compile-time constants, for example SLICE(data, 7, 4).",
      );
      return null;
    }
    const value = parseNumericLiteral(expr.raw);
    if (value === null) {
      this.analyzer.error(
        "E219",
        `${context} must be a plain decimal integer.`,
        expr.span.line,
        expr.span.column,
      );
      return null;
    }
    return value;
  }

  private arityHint(spec: BuiltinSpec): string {
    switch (spec.name) {
      case "SLICE":
        return "SLICE(value, hi, lo) uses inclusive, constant bit indexes.";
      default:
        return `${spec.name} accepts ${arityText(spec)}.`;
    }
  }

  private commonWidth(
    refs: ValueRef[],
    exprs: ExpressionAst[],
    context: string,
    span: SourceSpan,
  ): number {
    if (refs.length === 0) return 1;
    const signalRefs = refs.filter((_, index) => !this.isConstant(refs[index]!));
    const candidates = signalRefs.length > 0 ? signalRefs : refs;
    const widths = new Set(candidates.map((ref) => ref.width));
    let target = Math.max(...candidates.map((ref) => ref.width));
    if (widths.size > 1) {
      const details = refs
        .map((ref, index) => `${exprDescription(exprs[index] ?? fallbackExpr(span))}: ${ref.width} bit${ref.width === 1 ? "" : "s"}`)
        .join(", ");
      this.analyzer.error(
        "E301",
        `${context} requires compatible input widths (${details}).`,
        span.line,
        span.column,
        "Use a bit selection such as a[0], or make both signals the same width.",
      );
    }

    for (let index = 0; index < refs.length; index++) {
      const ref = refs[index]!;
      if (ref.width !== target && !this.isConstant(ref)) continue;
      refs[index] = this.coerce(
        ref,
        target,
        exprs[index] ?? fallbackExpr(span),
        context,
        span,
      );
    }
    return target;
  }

  private coerce(
    ref: ValueRef,
    targetWidth: number,
    expr: ExpressionAst,
    context: string,
    span: SourceSpan,
  ): ValueRef {
    if (ref.width === targetWidth) return ref;
    const node = this.analyzer.getNode(ref.node);
    if (node?.kind === "constant") {
      const value = BigInt(`0b${node.value ?? "0"}`);
      if (value <= maskFor(targetWidth)) {
        return this.createConstant(value, targetWidth, span.line, span.column, node.label);
      }
      this.analyzer.error(
        "E305",
        `${context} needs ${targetWidth} bits, but literal ${node.label} does not fit.`,
        span.line,
        span.column,
      );
      return ref;
    }
    if (ref.width !== targetWidth) {
      this.analyzer.error(
        "E308",
        `${context} expects ${targetWidth} bit${targetWidth === 1 ? "" : "s"}, but ${exprDescription(expr)} is ${ref.width} bits.`,
        span.line,
        span.column,
        "Explicitly slice or concatenate the signal so widths match.",
      );
    }
    return ref;
  }

  private isConstant(ref: ValueRef): boolean {
    return this.analyzer.getNode(ref.node)?.kind === "constant";
  }

  private addOperation(
    op: string,
    width: number,
    label: string,
    operands: string[],
    span: SourceSpan,
    params: Record<string, string | number | boolean> = {},
  ): ValueRef {
    if (width < 1 || width > this.analyzer.widthLimit) {
      this.analyzer.error(
        "E320",
        `Operation ${op} would be ${width} bits wide; the maximum supported width is ${this.analyzer.widthLimit}.`,
        span.line,
        span.column,
      );
      return this.fallbackRef(span.line, span.column);
    }
    const id = this.analyzer.nextOperationId(this.prefix);
    this.addNode({
      id,
      kind: "operation",
      op,
      width,
      label,
      scope: this.scope,
      operands,
      params,
      line: span.line,
      column: span.column,
    });
    return { node: id, width };
  }

  private addNode(node: CircuitNode): void {
    this.analyzer.addNode(node, this.context);
  }

  private createConstant(
    value: bigint,
    width: number,
    line: number,
    column: number,
    label: string,
  ): ValueRef {
    const widthLimit = this.analyzer.widthLimit;
    const safeWidth = Math.max(1, Math.min(width, widthLimit));
    const normalized = value & maskFor(safeWidth);
    const id = this.analyzer.nextConstantId(this.prefix);
    this.addNode({
      id,
      kind: "constant",
      width: safeWidth,
      label,
      scope: this.scope,
      operands: [],
      value: formatBinary(normalized, safeWidth),
      line,
      column,
    });
    return { node: id, width: safeWidth };
  }

  private fallbackRef(line: number, column: number): ValueRef {
    return this.createConstant(0n, 1, line, column, "0");
  }

  /**
   * Finds the column of a name on a line, so diagnostics and one-click fixes
   * point at the name itself rather than at the start of the statement.
   */
  private locateName(line: number, column: number, name: string): number {
    const sourceLine = this.analyzer.sourceText.split("\n")[line - 1] ?? "";
    const index = sourceLine.indexOf(name, Math.max(0, column - 1));
    return index === -1 ? column : index + 1;
  }

  private resolveOutputs(): BuiltOutput[] {
    const outputs: BuiltOutput[] = [];
    const seen = new Set<string>();
    for (const declaration of this.structure.outputs) {
      const reference: ReferenceAst = {
        kind: "Reference",
        path: declaration.path,
        span: {
          ...declaration.span,
          column: this.locateName(
            declaration.span.line,
            declaration.span.column,
            declaration.path[0]?.name ?? "",
          ),
        },
      };
      const ref = this.resolveReference(reference);
      const name = pathName(declaration.path);
      if (seen.has(name)) continue;
      seen.add(name);
      outputs.push({
        name,
        portName: declaration.path[declaration.path.length - 1]?.name ?? name,
        node: ref.node,
        width: ref.width,
        line: declaration.span.line,
        column: declaration.span.column,
      });
    }
    return outputs;
  }

  private instantiateCall(call: CallAst, instanceName: string): ResolvedEntry {
    const custom = this.analyzer.getStructure(call.name, this.packageName);
    if (custom) return this.instantiateCustom(custom, call, instanceName);
    return {
      kind: "value",
      ref: this.fallbackRef(call.span.line, call.span.column),
      origin: "assignment",
    };
  }

  private instantiateCustom(
    target: CircuitStructure,
    call: CallAst,
    instanceName: string,
  ): ResolvedEntry {
    const span = call.span;
    if (this.stack.includes(target.name)) {
      this.analyzer.error(
        "E324",
        `Recursive circuit instantiation detected: ${[...this.stack, target.name].join(" -> ")}.`,
        span.line,
        span.column,
        "A circuit cannot contain itself, directly or indirectly. Use a STATE element for feedback instead.",
      );
      return this.fallbackBundleFor(target, span);
    }
    if (this.depth + 1 > this.analyzer.maxDepth) {
      this.analyzer.error(
        "E320",
        `Circuit nesting exceeds the maximum depth of ${this.analyzer.maxDepth}.`,
        span.line,
        span.column,
      );
      return this.fallbackBundleFor(target, span);
    }
    if (!this.analyzer.beginInstance(this.context, span.line, span.column)) {
      return this.fallbackBundleFor(target, span);
    }
    this.context.maxDepth = Math.max(this.context.maxDepth, this.depth + 1);

    const bindings = this.bindCircuitArguments(target, call);
    const childPrefix = `${this.prefix}/${instanceName}`;
    const child = new ScopeBuilder(
      this.analyzer,
      target,
      target.packageName,
      childPrefix,
      [...this.scope, instanceName],
      false,
      bindings,
      this.context,
      [...this.stack, target.name],
      this.depth + 1,
    );
    const built = child.build();
    return this.bundleFromOutputs(target.name, target, built.outputs, span);
  }

  private bundleFromOutputs(
    circuitName: string,
    structure: CircuitStructure,
    builtOutputs: BuiltOutput[],
    span: SourceSpan,
  ): ResolvedBundle {
    const outputs = new Map<string, ValueRef>();
    for (const output of builtOutputs) {
      outputs.set(output.name, { node: output.node, width: output.width });
    }
    for (const declaration of structure.outputs) {
      const fullName = pathName(declaration.path);
      if (!outputs.has(fullName)) {
        outputs.set(fullName, this.fallbackRef(span.line, span.column));
      }
    }
    const grouped = new Map<string, Array<[string, ValueRef]>>();
    for (const declaration of structure.outputs) {
      const port = declaration.path[declaration.path.length - 1]!.name;
      const ref = outputs.get(pathName(declaration.path))!;
      const list = grouped.get(port) ?? [];
      list.push([port, ref]);
      grouped.set(port, list);
    }
    const shortOutputs = new Map<string, ValueRef>();
    for (const [port, entries] of grouped) {
      if (entries.length === 1) shortOutputs.set(port, entries[0]![1]);
    }
    return {
      kind: "bundle",
      circuit: circuitName,
      outputs,
      shortOutputs,
    };
  }

  private fallbackBundleFor(target: CircuitStructure, span: SourceSpan): ResolvedBundle {
    return this.bundleFromOutputs(target.name, target, [], span);
  }

  private bindCircuitArguments(
    target: CircuitStructure,
    call: CallAst,
  ): Map<string, ValueRef> {
    const bindings = new Map<string, ValueRef>();
    const inputNames = target.inputs.map((input) => input.name);
    const anyNamed = call.args.some((arg) => arg.name !== null);
    const allNamed = call.args.every((arg) => arg.name !== null);

    if (anyNamed && !allNamed) {
      this.analyzer.error(
        "E306",
        `Circuit ${target.name} must use either all positional or all named arguments.`,
        call.span.line,
        call.span.column,
        `Example: instance = ${target.name}(${inputNames.map((name) => `${name} = value`).join(", ")}).`,
      );
    }

    if (allNamed) {
      const seen = new Set<string>();
      for (const arg of call.args) {
        const name = arg.name!;
        if (!target.inputWidths.has(name)) {
          const suggestion = suggestName(name, inputNames, 3);
          this.analyzer.errorWithSuggestion(
            "E204",
            `Circuit ${target.name} has no input "${name}".`,
            arg.span.line,
            arg.span.column,
            suggestion,
            name.length,
            suggestion
              ? `Did you mean "${suggestion}"? Inputs: ${inputNames.join(", ")}.`
              : `Available inputs: ${inputNames.join(", ") || "none"}.`,
          );
          continue;
        }
        if (seen.has(name)) {
          this.analyzer.error(
            "E209",
            `Input "${name}" is connected more than once.`,
            arg.span.line,
            arg.span.column,
          );
          continue;
        }
        seen.add(name);
        const ref = this.resolveExpression(arg.value);
        bindings.set(
          name,
          this.coerce(
            ref,
            target.inputWidths.get(name)!,
            arg.value,
            `${target.name} input ${name}`,
            arg.span,
          ),
        );
      }
      for (const input of target.inputs) {
        if (!seen.has(input.name)) {
          this.analyzer.error(
            "E205",
            `Circuit ${target.name} input "${input.name}" is not connected.`,
            call.span.line,
            call.span.column,
            `Connect every input by name: ${input.name} = value.`,
          );
          bindings.set(input.name, this.createConstant(0n, input.width, call.span.line, call.span.column, "0"));
        }
      }
      return bindings;
    }

    if (call.args.length !== target.inputs.length) {
      this.analyzer.error(
        "E307",
        `Circuit ${target.name} expects ${target.inputs.length} input${target.inputs.length === 1 ? "" : "s"}, but received ${call.args.length}.`,
        call.span.line,
        call.span.column,
        `Inputs in order: ${inputNames.join(", ") || "none"}.`,
      );
    }
    for (const [index, input] of target.inputs.entries()) {
      const arg = call.args[index];
      if (!arg) {
        bindings.set(input.name, this.createConstant(0n, input.width, call.span.line, call.span.column, "0"));
        continue;
      }
      const ref = this.resolveExpression(arg.value);
      bindings.set(
        input.name,
        this.coerce(
          ref,
          target.inputWidths.get(input.name)!,
          arg.value,
          `${target.name} input ${input.name}`,
          arg.span,
        ),
      );
    }
    return bindings;
  }

  private compileEvents(): void {
    for (const block of this.onBlocks) {
      const clock = this.resolveReference(block.clock);
      if (clock.width !== 1) {
        this.analyzer.error(
          "E303",
          `Clock "${pathName(block.clock.path)}" must be 1 bit, but is ${clock.width} bits.`,
          block.clock.span.line,
          block.clock.span.column,
        );
      }
      const clockNode = this.analyzer.getNode(clock.node);
      if (clockNode?.kind === "constant") {
        this.analyzer.warning(
          "W301",
          "This clock is a constant and will never trigger.",
          block.clock.span.line,
          block.clock.span.column,
          "Connect the edge to an INPUT or a changing signal.",
        );
      }

      const updates = this.compileSequentialStatements(block.body, new Map());
      const eventUpdates: ClockEvent["updates"] = [];
      for (const [stateNode, value] of updates) {
        eventUpdates.push({ state: stateNode, value: value.node });
      }
      if (eventUpdates.length === 0) {
        this.analyzer.warning(
          "W302",
          "This clocked block does not update any state.",
          block.span.line,
          block.span.column,
        );
        continue;
      }
      this.context.events.push({
        id: this.analyzer.nextEventId(this.prefix),
        edge: block.edge,
        clock: clock.node,
        scope: this.scope,
        updates: eventUpdates,
        line: block.span.line,
        column: block.span.column,
      });
    }
  }

  private compileSequentialStatements(
    statements: SequentialStatementAst[],
    base: Map<string, ValueRef>,
  ): Map<string, ValueRef> {
    const updates = new Map(base);
    for (const statement of statements) {
      if (statement.target.length !== 1) {
        this.analyzer.error(
          "E207",
          "A clocked assignment target must be a single state name.",
          statement.span.line,
          statement.span.column,
        );
        continue;
      }
      const name = statement.target[0]!.name;
      const state = this.stateRefs.get(name);
      if (!state) {
        const available = [...this.stateRefs.keys()];
        const suggestion = suggestName(name, available, 3);
        this.analyzer.errorWithSuggestion(
          "E220",
          `"${name}" is not a STATE signal in this circuit.`,
          statement.span.line,
          statement.span.column,
          suggestion,
          name.length,
          suggestion
            ? `Did you mean state "${suggestion}"?`
            : "Only STATE signals can be updated inside an ON block. Use a combinational assignment for ordinary signals.",
        );
        continue;
      }
      const stateSpec = this.structure.stateByName.get(name)!;
      if (updates.has(state.node)) {
        this.analyzer.warning(
          "W303",
          `State "${name}" is assigned more than once along this clock path.`,
          statement.span.line,
          statement.span.column,
          "The later assignment wins. Compute a single next-state value before the ON block.",
        );
      }
      const ref = this.resolveExpression(statement.value);
      updates.set(
        state.node,
        this.coerce(ref, stateSpec.width, statement.value, `State ${name}`, statement.span),
      );
    }
    return updates;
  }
}

const BUILTIN_NAMES = BUILTINS.map((spec) => spec.name);


function arityText(spec: BuiltinSpec): string {
  if (spec.maxArgs === Number.POSITIVE_INFINITY) {
    return `at least ${spec.minArgs} inputs`;
  }
  if (spec.minArgs === spec.maxArgs) {
    return `${spec.minArgs} argument${spec.minArgs === 1 ? "" : "s"}`;
  }
  return `${spec.minArgs} to ${spec.maxArgs} arguments`;
}

function fallbackExpr(span: SourceSpan): ExpressionAst {
  return {
    kind: "Literal",
    raw: "0",
    span,
  };
}
