import type {
  CallAst,
  CircuitItemAst,
  CircuitAst,
  ConstExprAst,
  ExpressionAst,
  ForAst,
  Path,
  PathSegment,
  ProgramAst,
  SequentialStatementAst,
  TestAst,
  TestCaseAst,
  TestStatementAst,
} from "./ast";
import { DiagnosticBag } from "./diagnostics";
import type { Diagnostic } from "./types";

/**
 * Compile-time expansion.
 *
 * `CONST` declarations and `FOR` loops are resolved here, before the analyzer
 * sees the design. Loops are unrolled into ordinary statements, constant
 * expressions are folded into numbers, and indexed names such as `cell[0]`
 * become plain names such as `cell_0`.
 */

export interface ExpandOptions {
  /** Maximum nesting depth of FOR loops. */
  maxLoopDepth?: number;
  /** Maximum number of statements one loop may expand to. */
  maxUnrolledItems?: number;
}

const DEFAULT_OPTIONS: Required<ExpandOptions> = {
  maxLoopDepth: 4,
  maxUnrolledItems: 20_000,
};

export function expandProgram(
  program: ProgramAst,
  options: ExpandOptions = {},
): { program: ProgramAst; diagnostics: Diagnostic[] } {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const expander = new Expander(settings);
  return expander.run(program);
}

class Expander {
  private readonly bag: DiagnosticBag;
  private unrolled = 0;
  /** Names created by an indexed assignment inside a loop, such as cell. */
  private readonly arrayNames = new Set<string>();
  /** Every circuit in the program, by name. */
  private readonly circuitsByName = new Map<string, CircuitAst>();
  /** The constants declared at the top level. */
  private readonly constants = new Map<string, number>();
  /** Specialized copies of parameterized circuits, by their parameter set. */
  private readonly specializations = new Map<string, { name: string; circuit: CircuitAst }>();
  /** Copies created while expanding, added to the program at the end. */
  private readonly created: CircuitAst[] = [];

  constructor(private readonly options: Required<ExpandOptions>) {
    this.bag = new DiagnosticBag(100);
  }

  run(program: ProgramAst): { program: ProgramAst; diagnostics: Diagnostic[] } {
    const env = new Map<string, number>();

    for (const circuit of program.circuits) this.circuitsByName.set(circuit.name, circuit);

    for (const declaration of program.constants) {
      const value = this.evaluate(declaration.value, env);
      if (value === null) continue;
      if (env.has(declaration.name)) {
        this.bag.error(
          "E402",
          `Constant "${declaration.name}" is declared more than once.`,
          declaration.span.line,
          declaration.span.column,
          { hint: "Give every constant a unique name." },
        );
        continue;
      }
      env.set(declaration.name, value);
    }

    const circuits = program.circuits.map((circuit) => this.expandCircuit(circuit, env));
    const tests = program.tests.map((test) => this.expandTest(test, env));

    return {
      program: {
        kind: "Program",
        constants: [],
        circuits: [...circuits, ...this.created],
        tests,
      },
      diagnostics: this.bag.sorted(),
    };
  }

  /**
   * Expands a circuit, binding its parameter defaults.
   *
   * A parameterized circuit is compiled once per parameter set. The copies get
   * their own names, such as Register&lt;N=16&gt;, so the graph can hold them
   * side by side.
   */
  private expandCircuit(circuit: CircuitAst, env: Map<string, number>): CircuitAst {
    const scope = new Map(env);
    for (const parameter of circuit.params) {
      const value = this.evaluate(parameter.default, scope);
      if (value === null) continue;
      scope.set(parameter.name, value);
    }
    return { ...circuit, body: this.expandItems(circuit.body, scope, 0) };
  }

  /** The values a call gives to a circuit, over the declared defaults. */
  private parameterValues(
    target: CircuitAst,
    call: CallAst,
    env: Map<string, number>,
  ): Map<string, number> | null {
    const values = new Map<string, number>();
    const declared = new Map(target.params.map((parameter) => [parameter.name, parameter]));

    for (const parameter of target.params) {
      const value = this.evaluate(parameter.default, env);
      if (value === null) return null;
      values.set(parameter.name, value);
    }

    let positional = 0;
    for (const given of call.params) {
      if (given.name === null) {
        const name = target.params[positional]?.name;
        positional += 1;
        if (!name) {
          this.bag.error(
            "E407",
            `${target.name} takes ${target.params.length} parameter${target.params.length === 1 ? "" : "s"}.`,
            given.span.line,
            given.span.column,
            { hint: "Give the parameter by name, or use the defaults." },
          );
          return null;
        }
        const value = this.evaluate(given.value, env);
        if (value === null) return null;
        values.set(name, value);
        continue;
      }
      if (!declared.has(given.name)) {
        this.bag.error(
          "E408",
          `${target.name} has no parameter "${given.name}".`,
          given.span.line,
          given.span.column,
          {
            hint: `Parameters: ${[...declared.keys()].join(", ") || "none"}.`,
          },
        );
        return null;
      }
      const value = this.evaluate(given.value, env);
      if (value === null) return null;
      values.set(given.name, value);
    }

    return values;
  }

  /** Creates, or reuses, the copy of a circuit for one parameter set. */
  private specialize(
    target: CircuitAst,
    values: Map<string, number>,
    env: Map<string, number>,
  ): string | null {
    const key = `${target.name}|${[...values.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([name, value]) => `${name}=${value}`)
      .join(",")}`;
    const existing = this.specializations.get(key);
    if (existing) return existing.name;

    const label = [...values.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join(", ");
    const name = `${target.name}<${label}>`;

    const scope = new Map(env);
    for (const [parameter, value] of values) scope.set(parameter, value);
    const body = this.expandItems(target.body, scope, 0);

    this.created.push({ ...target, name, params: [], body });
    this.specializations.set(key, { name, circuit: this.created[this.created.length - 1]! });
    return name;
  }

  private expandItems(
    items: CircuitItemAst[],
    env: Map<string, number>,
    depth: number,
  ): CircuitItemAst[] {
    const output: CircuitItemAst[] = [];

    for (const item of items) {
      if (item.kind !== "For") {
        output.push(this.expandItem(item, env));
        continue;
      }

      const from = this.evaluate(item.from, env);
      const to = this.evaluate(item.to, env);
      if (from === null || to === null) continue;

      if (to < from) {
        this.bag.warning(
          "W401",
          `The loop ${item.variable} IN ${from}..${to} has no values, so it is skipped.`,
          item.span.line,
          item.span.column,
          { hint: "Write the lower bound first." },
        );
        continue;
      }

      if (depth + 1 > this.options.maxLoopDepth) {
        this.bag.error(
          "E404",
          `FOR loops can be nested at most ${this.options.maxLoopDepth} deep.`,
          item.span.line,
          item.span.column,
          { hint: "Flatten the loop, or compute the values with a constant." },
        );
        continue;
      }

      for (let value = from; value <= to; value += 1) {
        this.unrolled += 1;
        if (this.unrolled > this.options.maxUnrolledItems) {
          this.bag.error(
            "E405",
            `This loop expands to more than ${this.options.maxUnrolledItems.toLocaleString()} statements.`,
            item.span.line,
            item.span.column,
            { hint: "Narrow the loop range." },
          );
          return output;
        }
        const scope = new Map(env);
        scope.set(item.variable, value);
        this.checkLoopTargets(item);
        output.push(...this.expandItems(item.body, scope, depth + 1));
      }
    }

    return output;
  }

  /** Every assignment inside a loop needs an index, or the names collide. */
  private checkLoopTargets(loop: ForAst): void {
    for (const item of loop.body) {
      if (item.kind !== "Assignment") continue;
      const indexed = item.target.some((segment) => segment.indexes.length > 0);
      if (indexed) continue;
      this.bag.error(
        "E406",
        `"${item.target[0]?.name ?? "signal"}" is assigned in a loop without an index.`,
        item.span.line,
        item.span.column,
        {
          hint: `Write ${item.target[0]?.name ?? "name"}[${loop.variable}] = ... so each iteration gets its own signal.`,
        },
      );
    }
  }

  private expandItem(item: CircuitItemAst, env: Map<string, number>): CircuitItemAst {
    switch (item.kind) {
      case "Input":
        return { ...item, width: item.width ? this.fold(item.width, env) : null };
      case "State":
        return { ...item, width: item.width ? this.fold(item.width, env) : null };
      case "Output":
        return { ...item, path: this.rewritePath(item.path, env) };
      case "Assignment":
        return {
          ...item,
          target: this.rewritePath(item.target, env),
          value: this.foldExpression(item.value, env),
        };
      case "On":
        return {
          ...item,
          clock: { ...item.clock, path: this.rewritePath(item.clock.path, env) },
          body: item.body.map((statement) => this.expandSequential(statement, env)),
        };
      case "For":
        return item;
      default:
        return item;
    }
  }

  private expandSequential(
    statement: SequentialStatementAst,
    env: Map<string, number>,
  ): SequentialStatementAst {
    if (statement.kind === "SequentialAssignment") {
      return {
        ...statement,
        value: this.foldExpression(statement.value, env),
      };
    }
    return {
      ...statement,
      condition: this.foldExpression(statement.condition, env),
      thenBody: statement.thenBody.map((entry) => this.expandSequential(entry, env)),
      elseBody: statement.elseBody
        ? statement.elseBody.map((entry) => this.expandSequential(entry, env))
        : null,
    };
  }

  private expandTest(test: TestAst, env: Map<string, number>): TestAst {
    return {
      ...test,
      cases: test.cases.map((testCase) => this.expandCase(testCase, env)),
    };
  }

  private expandCase(testCase: TestCaseAst, env: Map<string, number>): TestCaseAst {
    return {
      ...testCase,
      statements: testCase.statements.map((statement) => this.expandStatement(statement, env)),
    };
  }

  private expandStatement(
    statement: TestStatementAst,
    env: Map<string, number>,
  ): TestStatementAst {
    switch (statement.kind) {
      case "TestExpect":
        return { ...statement, path: this.rewritePath(statement.path, env) };
      case "TestLoad":
        return { ...statement, path: this.rewritePath(statement.path, env) };
      case "TestStep":
        return {
          ...statement,
          statements: statement.statements.map((entry) => this.expandStatement(entry, env)),
        };
      default:
        return statement;
    }
  }

  /**
   * Resolves a call to a parameterized circuit.
   *
   * Each parameter set gets its own copy of the circuit, so two instances with
   * different widths stay independent.
   */
  private resolveCall(call: CallAst, env: Map<string, number>): CallAst {
    const target = this.circuitsByName.get(call.name);
    if (!target) return call;

    if (target.params.length === 0) {
      if (call.params.length > 0) {
        this.bag.error(
          "E409",
          `${target.name} does not take parameters.`,
          call.params[0]!.span.line,
          call.params[0]!.span.column,
          { hint: "Remove the parameter list, or declare the parameters on the circuit." },
        );
      }
      return call;
    }

    const values = this.parameterValues(target, call, env);
    if (values === null) return call;
    const name = this.specialize(target, values, env);
    if (!name) return call;
    return { ...call, name, params: [] };
  }

  /**
   * Rewrites indexed path segments into plain names, so cell[0] becomes cell_0
   * and cell[0][1] becomes cell_0_1.
   */
  private rewritePath(path: Path, env: Map<string, number>): Path {
    return path.map((segment) => {
      if (segment.indexes.length === 0) return { name: segment.name, indexes: [] };
      const parts: number[] = [];
      for (const index of segment.indexes) {
        const value = this.evaluate(index, env);
        if (value === null) return { name: segment.name, indexes: [] };
        parts.push(value);
      }
      this.arrayNames.add(segment.name);
      return { name: `${segment.name}_${parts.join("_")}`, indexes: [] };
    });
  }

  private foldExpression(expression: ExpressionAst, env: Map<string, number>): ExpressionAst {
    switch (expression.kind) {
      case "Literal":
        return expression;
      case "Reference":
        return { ...expression, path: this.rewritePath(expression.path, env) };
      case "Call": {
        const folded = {
          ...expression,
          args: expression.args.map((arg) => ({ ...arg, value: this.foldExpression(arg.value, env) })),
        };
        return this.resolveCall(folded, env);
      }
      case "Index": {
        // bit[0] reads a signal created by a loop, when such an array exists.
        if (expression.target.kind === "Reference" && expression.target.path.length === 1) {
          const base = expression.target.path[0]!.name;
          if (this.arrayNames.has(base)) {
            const value = this.evaluate(expression.index, env);
            if (value === null) return expression;
            return {
              kind: "Reference",
              path: [{ name: `${base}_${value}`, indexes: [] }],
              span: expression.span,
            };
          }
        }
        return { ...expression, index: this.fold(expression.index, env) };
      }
      case "Slice":
        return {
          ...expression,
          hi: this.fold(expression.hi, env),
          lo: this.fold(expression.lo, env),
        };
      default:
        return expression;
    }
  }

  /** Folds a constant expression to a number, keeping the name when it is unknown. */
  private fold(expression: ConstExprAst, env: Map<string, number>): ConstExprAst {
    const value = this.evaluate(expression, env);
    if (value === null) return expression;
    return { kind: "ConstNumber", value, span: expression.span };
  }

  /** Evaluates a constant expression, reporting an error when it cannot. */
  private evaluate(expression: ConstExprAst, env: Map<string, number>): number | null {
    switch (expression.kind) {
      case "ConstNumber":
        return expression.value;
      case "ConstName": {
        const value = env.get(expression.name);
        if (value === undefined) {
          this.bag.error(
            "E401",
            `"${expression.name}" is not a known constant or loop variable.`,
            expression.span.line,
            expression.span.column,
            {
              hint: "Declare it with CONST, or use a loop variable that is in scope.",
            },
          );
          return null;
        }
        return value;
      }
      case "ConstUnary": {
        const operand = this.evaluate(expression.operand, env);
        if (operand === null) return null;
        return -operand;
      }
      case "ConstBinary": {
        const left = this.evaluate(expression.left, env);
        const right = this.evaluate(expression.right, env);
        if (left === null || right === null) return null;
        switch (expression.op) {
          case "+":
            return left + right;
          case "-":
            return left - right;
          case "*":
            return left * right;
          case "/":
            if (right === 0) {
              this.bag.error(
                "E403",
                "Division by zero in a compile-time expression.",
                expression.span.line,
                expression.span.column,
                { hint: "Guard the divisor, or use a value that is never zero." },
              );
              return null;
            }
            return Math.trunc(left / right);
          case "%":
            if (right === 0) {
              this.bag.error(
                "E403",
                "Remainder by zero in a compile-time expression.",
                expression.span.line,
                expression.span.column,
                { hint: "Guard the divisor, or use a value that is never zero." },
              );
              return null;
            }
            return left % right;
          default:
            return null;
        }
      }
      default:
        return null;
    }
  }
}
