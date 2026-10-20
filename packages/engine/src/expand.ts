import type {
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

  constructor(private readonly options: Required<ExpandOptions>) {
    this.bag = new DiagnosticBag(100);
  }

  run(program: ProgramAst): { program: ProgramAst; diagnostics: Diagnostic[] } {
    const env = new Map<string, number>();

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
      program: { kind: "Program", constants: [], circuits, tests },
      diagnostics: this.bag.sorted(),
    };
  }

  private expandCircuit(circuit: CircuitAst, env: Map<string, number>): CircuitAst {
    return {
      ...circuit,
      body: this.expandItems(circuit.body, env, 0),
    };
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
      const indexed = item.target.some((segment) => segment.index !== null);
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

  /** Rewrites indexed path segments into plain names, such as cell[0] to cell_0. */
  private rewritePath(path: Path, env: Map<string, number>): Path {
    return path.map((segment) => {
      if (!segment.index) return { name: segment.name, index: null };
      const value = this.evaluate(segment.index, env);
      if (value === null) return { name: segment.name, index: null };
      this.arrayNames.add(segment.name);
      return { name: `${segment.name}_${value}`, index: null };
    });
  }

  private foldExpression(expression: ExpressionAst, env: Map<string, number>): ExpressionAst {
    switch (expression.kind) {
      case "Literal":
        return expression;
      case "Reference":
        return { ...expression, path: this.rewritePath(expression.path, env) };
      case "Call":
        return {
          ...expression,
          args: expression.args.map((arg) => ({ ...arg, value: this.foldExpression(arg.value, env) })),
        };
      case "Index": {
        // bit[0] reads a signal created by a loop, when such an array exists.
        if (expression.target.kind === "Reference" && expression.target.path.length === 1) {
          const base = expression.target.path[0]!.name;
          if (this.arrayNames.has(base)) {
            const value = this.evaluate(expression.index, env);
            if (value === null) return expression;
            return {
              kind: "Reference",
              path: [{ name: `${base}_${value}`, index: null }],
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
