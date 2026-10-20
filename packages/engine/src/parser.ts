import type {
  AssignmentAst,
  CallArgumentAst,
  CallAst,
  CircuitAst,
  CircuitItemAst,
  ExpressionAst,
  IfAst,
  InputDeclAst,
  LiteralAst,
  OnBlockAst,
  OutputDeclAst,
  ProgramAst,
  ReferenceAst,
  SequentialStatementAst,
  SourceSpan,
  StateDeclAst,
  TestAst,
  TestCaseAst,
  TestCycleAst,
  TestExpectAst,
  TestInputAst,
  TestLoadAst,
  TestStatementAst,
  TestStepAst,
} from "./ast";
import { DiagnosticBag } from "./diagnostics";
import { lex, type Token } from "./lexer";
import type { Diagnostic } from "./types";

const CIRCUIT_ITEM_KEYWORDS = new Set(["INPUT", "OUTPUT", "STATE", "ON"]);

function isIdentifier(token: Token): boolean {
  return token.kind === "identifier";
}

function keyword(token: Token, name: string): boolean {
  return token.kind === "identifier" && token.value.toUpperCase() === name;
}

function mergeSpan(start: Token, end: Token): SourceSpan {
  return {
    line: start.line,
    column: start.column,
    offset: start.offset,
    length: Math.max(1, end.offset + end.length - start.offset),
  };
}

function tokenSpan(token: Token): SourceSpan {
  return {
    line: token.line,
    column: token.column,
    offset: token.offset,
    length: Math.max(1, token.length),
  };
}

/** Recursive-descent parser for the LogicFlow 0.1 source language. */
export class Parser {
  private readonly tokens: Token[];
  private readonly bag: DiagnosticBag;
  private index = 0;
  private ifDepth = 0;

  constructor(
    source: string,
    diagnostics: Diagnostic[] = [],
    private readonly maxErrors = 100,
  ) {
    this.bag = new DiagnosticBag(maxErrors);
    for (const diagnostic of diagnostics) this.bag.add(diagnostic);
    const lexDiagnostics: Diagnostic[] = [];
    this.tokens = lex(source, lexDiagnostics);
    for (const diagnostic of lexDiagnostics) this.bag.add(diagnostic);
  }

  get diagnostics(): Diagnostic[] {
    return this.bag.sorted();
  }

  parse(): ProgramAst {
    const circuits: CircuitAst[] = [];
    const tests: TestAst[] = [];
    this.skipNewlines();

    while (!this.atEnd()) {
      const token = this.peek();
      if (keyword(token, "CIRCUIT")) {
        circuits.push(this.parseCircuit());
      } else if (keyword(token, "TEST")) {
        tests.push(this.parseTest());
      } else {
        this.error(
          "E100",
          `Expected CIRCUIT or TEST, found "${token.raw || "end of file"}".`,
          token,
          "Every top-level block starts with CIRCUIT or TEST.",
        );
        this.recoverToTopLevel();
      }
      this.skipNewlines();
    }

    return { kind: "Program", circuits, tests };
  }

  private parseCircuit(): CircuitAst {
    const start = this.expectKeyword("CIRCUIT");
    const name = this.expectIdentifier("a circuit name");
    this.finishStatement();
    const body: CircuitItemAst[] = [];
    let closed = false;

    while (!this.atEnd()) {
      this.skipNewlines();
      if (this.atEnd()) break;
      if (keyword(this.peek(), "END")) {
        this.advance();
        this.finishStatement();
        closed = true;
        break;
      }
      if (keyword(this.peek(), "CIRCUIT") || keyword(this.peek(), "TEST")) {
        this.error(
          "E101",
          `CIRCUIT ${name.value} is missing its END.`,
          start,
          "Add END to close the circuit before starting another block.",
        );
        break;
      }

      const item = this.parseCircuitItem();
      if (item) body.push(item);
    }

    if (!closed && this.atEnd()) {
      this.error(
        "E101",
        `CIRCUIT ${name.value} is missing its END.`,
        start,
        "Add END as the final line of the circuit.",
      );
    }

    return {
      kind: "Circuit",
      name: name.value,
      span: mergeSpan(start, this.previous()),
      body,
    };
  }

  private parseCircuitItem(): CircuitItemAst | null {
    const token = this.peek();
    if (keyword(token, "INPUT")) return this.parseInputDecl();
    if (keyword(token, "OUTPUT")) return this.parseOutputDecl();
    if (keyword(token, "STATE")) return this.parseStateDecl();
    if (keyword(token, "ON")) return this.parseOnBlock();
    if (isIdentifier(token)) {
      if (
        keyword(token, "END") ||
        keyword(token, "IF") ||
        keyword(token, "ELSE") ||
        keyword(token, "CASE") ||
        keyword(token, "EXPECT")
      ) {
        this.error(
          "E102",
          `"${token.value}" is not valid here.`,
          token,
          this.assignmentHint(token),
        );
        this.recoverToLineEnd();
        return null;
      }
      return this.parseAssignment();
    }

    this.error(
      "E103",
      `Expected INPUT, OUTPUT, STATE, ON, or an assignment, found "${token.raw || "end of file"}".`,
      token,
      "A circuit line declares a signal or assigns one with name = expression.",
    );
    this.recoverToLineEnd();
    return null;
  }

  private parseInputDecl(): InputDeclAst {
    const start = this.expectKeyword("INPUT");
    const name = this.expectIdentifier("an input name");
    let width: number | null = null;
    if (this.matchSymbol(":")) {
      width = this.parseWidthSpec();
    }
    if (this.checkSymbol("=")) {
      const token = this.peek();
      this.error(
        "E104",
        "INPUT declarations cannot have a value.",
        token,
        "Inputs are supplied by the simulation or by an enclosing circuit.",
      );
      this.advance();
      this.parseExpression();
    }
    this.finishStatement();
    return {
      kind: "Input",
      name: name.value,
      width,
      span: mergeSpan(start, this.previous()),
    };
  }

  private parseOutputDecl(): OutputDeclAst {
    const start = this.expectKeyword("OUTPUT");
    const path = this.parsePath();
    this.finishStatement();
    return {
      kind: "Output",
      path,
      span: mergeSpan(start, this.previous()),
    };
  }

  private parseStateDecl(): StateDeclAst {
    const start = this.expectKeyword("STATE");
    const name = this.expectIdentifier("a state name");
    let width: number | null = null;
    let init: LiteralAst | null = null;
    if (this.matchSymbol(":")) width = this.parseWidthSpec();
    if (this.matchSymbol("=")) init = this.parseLiteral();
    this.finishStatement();
    return {
      kind: "State",
      name: name.value,
      width,
      init,
      span: mergeSpan(start, this.previous()),
    };
  }

  private parseOnBlock(): OnBlockAst {
    const start = this.expectKeyword("ON");
    const edgeToken = this.peek();
    let edge: "rising" | "falling";
    if (keyword(edgeToken, "RISING_EDGE")) {
      this.advance();
      edge = "rising";
    } else if (keyword(edgeToken, "FALLING_EDGE")) {
      this.advance();
      edge = "falling";
    } else {
      this.error(
        "E105",
        "Expected RISING_EDGE or FALLING_EDGE after ON.",
        edgeToken,
        "Example: ON RISING_EDGE(clock):",
      );
      edge = "rising";
      if (!this.atEnd()) this.advance();
    }

    this.expectSymbol("(");
    const clock = this.parseReference();
    this.expectSymbol(")");
    this.expectSymbol(":");
    this.finishStatement();
    const body = this.parseSequentialBody(new Set(["END"]));
    this.expectKeyword("END");
    this.finishStatement();

    return {
      kind: "On",
      edge,
      clock,
      body,
      span: mergeSpan(start, this.previous()),
    };
  }

  private parseSequentialBody(terminators: Set<string>): SequentialStatementAst[] {
    const body: SequentialStatementAst[] = [];
    this.skipNewlines();
    while (!this.atEnd()) {
      const token = this.peek();
      if (token.kind === "identifier") {
        const upper = token.value.toUpperCase();
        if (terminators.has(upper) || upper === "ELSE") break;
      }
      if (keyword(token, "IF")) {
        body.push(this.parseIf());
      } else if (isIdentifier(token)) {
        body.push(this.parseSequentialAssignment());
      } else {
        this.error(
          "E106",
          `Expected IF or a state assignment, found "${token.raw || "end of file"}".`,
          token,
          "Clocked blocks may contain IF ... END blocks and assignments to STATE signals.",
        );
        this.recoverToLineEnd();
      }
      this.skipNewlines();
    }
    return body;
  }

  private parseIf(): IfAst {
    const start = this.expectKeyword("IF");
    if (this.ifDepth >= 64) {
      this.error(
        "E107",
        "IF blocks are nested too deeply.",
        start,
        "Split the condition into named combinational signals or reduce the nesting.",
      );
    }
    this.ifDepth += 1;
    const condition = this.parseExpression();
    this.expectSymbol(":");
    this.finishStatement();
    const thenBody = this.parseSequentialBody(new Set(["END", "ELSE"]));
    let elseBody: SequentialStatementAst[] | null = null;
    if (keyword(this.peek(), "ELSE")) {
      this.advance();
      this.expectSymbol(":");
      this.finishStatement();
      elseBody = this.parseSequentialBody(new Set(["END"]));
    }
    this.expectKeyword("END");
    this.finishStatement();
    this.ifDepth -= 1;
    return {
      kind: "If",
      condition,
      thenBody,
      elseBody,
      span: mergeSpan(start, this.previous()),
    };
  }

  private parseSequentialAssignment(): SequentialStatementAst {
    const start = this.peek();
    const target = this.parsePath();
    this.expectSymbol("=");
    const value = this.parseExpression();
    this.finishStatement();
    return {
      kind: "SequentialAssignment",
      target,
      value,
      span: mergeSpan(start, this.previous()),
    };
  }

  private parseAssignment(): AssignmentAst {
    const start = this.peek();
    const target = this.parsePath();
    this.expectSymbol("=");
    const value = this.parseExpression();
    this.finishStatement();
    return {
      kind: "Assignment",
      target,
      value,
      span: mergeSpan(start, this.previous()),
    };
  }

  private parseTest(): TestAst {
    const start = this.expectKeyword("TEST");
    const name = this.expectIdentifier("a circuit name");
    this.finishStatement();
    const cases: TestCaseAst[] = [];
    let closed = false;

    while (!this.atEnd()) {
      this.skipNewlines();
      if (this.atEnd()) break;
      if (keyword(this.peek(), "END")) {
        this.advance();
        this.finishStatement();
        closed = true;
        break;
      }
      if (!keyword(this.peek(), "CASE")) {
        this.error(
          "E108",
          `Expected CASE or END in TEST ${name.value}.`,
          this.peek(),
          "A test contains one or more CASE blocks, followed by END.",
        );
        this.recoverToTopLevel();
        break;
      }
      cases.push(this.parseCase());
    }

    if (!closed) {
      this.error(
        "E109",
        `TEST ${name.value} is missing its END.`,
        start,
        "Add END as the final line of the test.",
      );
    }

    return {
      kind: "Test",
      name: name.value,
      cases,
      span: mergeSpan(start, this.previous()),
    };
  }

  private parseCase(): TestCaseAst {
    const start = this.expectKeyword("CASE");
    let label = "";
    if (this.peek().kind === "string") {
      label = this.advance().value;
    } else if (
      this.peek().kind === "identifier" &&
      !keyword(this.peek(), "INPUT") &&
      !keyword(this.peek(), "EXPECT") &&
      !keyword(this.peek(), "END")
    ) {
      label = this.advance().value;
    }
    this.finishStatement();
    const statements: TestStatementAst[] = [];
    let closed = false;
    this.skipNewlines();

    while (!this.atEnd()) {
      const token = this.peek();
      if (keyword(token, "END")) {
        this.advance();
        this.finishStatement();
        closed = true;
        break;
      }
      if (keyword(token, "INPUT")) {
        statements.push(this.parseTestInput());
      } else if (keyword(token, "EXPECT")) {
        statements.push(this.parseTestExpect());
      } else if (keyword(token, "LOAD")) {
        statements.push(this.parseTestLoad());
      } else if (keyword(token, "STEP")) {
        statements.push(this.parseTestStep());
      } else if (keyword(token, "CYCLE")) {
        statements.push(this.parseTestCycle());
      } else if (keyword(token, "CASE") || keyword(token, "TEST") || keyword(token, "CIRCUIT")) {
        break;
      } else {
        this.error(
          "E110",
          `Expected INPUT, EXPECT, LOAD, STEP, CYCLE, or END in a CASE, found "${token.raw || "end of file"}".`,
          token,
          "Test cases assign INPUT signals, declare EXPECT values, and can group changes with STEP or pulse a clock with CYCLE.",
        );
        this.recoverToLineEnd();
      }
      this.skipNewlines();
    }

    if (!closed) {
      this.error(
        "E111",
        "CASE is missing its END.",
        start,
        "Add END to close this test case.",
      );
    }

    return {
      kind: "Case",
      label,
      statements,
      span: mergeSpan(start, this.previous()),
    };
  }

  private parseTestLoad(): TestLoadAst {
    const start = this.expectKeyword("LOAD");
    const path = this.parsePath();
    this.expectSymbol("=");
    const value = this.parseLiteral();
    this.finishStatement();
    return {
      kind: "TestLoad",
      path,
      value,
      span: mergeSpan(start, this.previous()),
    };
  }

  private parseTestStep(): TestStepAst {
    const start = this.expectKeyword("STEP");
    this.finishStatement();
    const statements: TestStatementAst[] = [];
    let closed = false;
    this.skipNewlines();

    while (!this.atEnd()) {
      const token = this.peek();
      if (keyword(token, "END")) {
        this.advance();
        this.finishStatement();
        closed = true;
        break;
      }
      if (keyword(token, "INPUT")) {
        statements.push(this.parseTestInput());
      } else if (keyword(token, "EXPECT")) {
        statements.push(this.parseTestExpect());
      } else if (keyword(token, "LOAD")) {
        statements.push(this.parseTestLoad());
      } else if (keyword(token, "STEP")) {
        statements.push(this.parseTestStep());
      } else if (keyword(token, "CYCLE")) {
        statements.push(this.parseTestCycle());
      } else {
        this.error(
          "E126",
          `Expected INPUT, EXPECT, STEP, CYCLE, or END inside STEP, found "${token.raw || "end of file"}".`,
          token,
          "A STEP groups input changes so they are applied together.",
        );
        this.recoverToLineEnd();
      }
      this.skipNewlines();
    }

    if (!closed) {
      this.error(
        "E124",
        "STEP is missing its END.",
        start,
        "Add END to close the step.",
      );
    }

    return {
      kind: "TestStep",
      statements,
      span: mergeSpan(start, this.previous()),
    };
  }

  private parseTestCycle(): TestCycleAst {
    const start = this.expectKeyword("CYCLE");
    const nameToken = this.expectIdentifier("a clock name");
    const countToken = this.expectKind("number", "a cycle count");
    const count = Number(countToken.raw.replaceAll("_", ""));
    if (!Number.isSafeInteger(count) || count < 1) {
      this.error(
        "E125",
        `Invalid cycle count "${countToken.raw}". Use a positive whole number.`,
        countToken,
        "CYCLE clock 1 pulses the clock once.",
      );
    }
    this.finishStatement();
    return {
      kind: "TestCycle",
      clock: nameToken.value,
      count,
      span: mergeSpan(start, this.previous()),
    };
  }

  private parseTestInput(): TestInputAst {
    const start = this.expectKeyword("INPUT");
    const nameToken = this.expectIdentifier("an input name");
    this.expectSymbol("=");
    const value = this.parseLiteral();
    this.finishStatement();
    return {
      kind: "TestInput",
      name: nameToken.value,
      value,
      span: mergeSpan(start, this.previous()),
    };
  }

  private parseTestExpect(): TestExpectAst {
    const start = this.expectKeyword("EXPECT");
    const path = this.parsePath();
    this.expectSymbol("=");
    const value = this.parseLiteral();
    this.finishStatement();
    return {
      kind: "TestExpect",
      path,
      value,
      span: mergeSpan(start, this.previous()),
    };
  }

  private parseWidthSpec(): number {
    const token = this.peek();
    if (token.kind === "number") {
      this.advance();
      const width = Number(token.raw.replaceAll("_", ""));
      if (!Number.isSafeInteger(width) || width < 1) {
        this.error(
          "E112",
          `Invalid width "${token.raw}". Widths must be positive whole numbers.`,
          token,
        );
        return 1;
      }
      return width;
    }
    if (isIdentifier(token) && token.value.toUpperCase() === "BUS") {
      this.advance();
      this.expectSymbol("(");
      const widthToken = this.expectKind("number", "a bus width");
      this.expectSymbol(")");
      const width = Number(widthToken.raw.replaceAll("_", ""));
      if (!Number.isSafeInteger(width) || width < 1) {
        this.error(
          "E112",
          `Invalid width "${widthToken.raw}". Bus widths must be positive whole numbers.`,
          widthToken,
          "Example: INPUT data : BUS(8)",
        );
        return 1;
      }
      return width;
    }

    this.error(
      "E113",
      "Expected a width such as 8 or BUS(8).",
      token,
      "Use INPUT data : BUS(8) for an 8-bit bus.",
    );
    if (!this.atEnd() && !this.checkNewline()) this.advance();
    return 1;
  }

  private parseExpression(): ExpressionAst {
    const token = this.peek();
    let expression: ExpressionAst;

    if (token.kind === "number") {
      expression = this.parseLiteral();
    } else if (isIdentifier(token)) {
      if (this.peek(1)?.value === "(") {
        expression = this.parseCall();
      } else {
        expression = this.parseReference();
      }
    } else if (this.checkSymbol("(")) {
      const start = this.advance();
      expression = this.parseExpression();
      this.expectSymbol(")");
      expression = {
        ...expression,
        span: {
          line: start.line,
          column: start.column,
          offset: start.offset,
          length: Math.max(1, this.peek().offset - start.offset),
        },
      };
    } else {
      this.error(
        "E114",
        `Expected a value or expression, found "${token.raw || "end of file"}".`,
        token,
        "Expressions are literals, signal names, or function calls such as AND(a, b).",
      );
      this.recoverToExpressionEnd();
      const fallback: LiteralAst = {
        kind: "Literal",
        raw: "0",
        span: tokenSpan(token),
      };
      return fallback;
    }

    return this.parsePostfix(expression);
  }

  private parsePostfix(initial: ExpressionAst): ExpressionAst {
    let expression = initial;
    while (this.checkSymbol("[")) {
      const startToken = this.peek();
      this.advance();
      const first = this.expectKind("number", "a bit index");
      const firstNumber = Number(first.raw.replaceAll("_", ""));
      let result: ExpressionAst;
      if (this.matchSymbol(":")) {
        const second = this.expectKind("number", "a slice end index");
        this.expectSymbol("]");
        const secondNumber = Number(second.raw.replaceAll("_", ""));
        result = {
          kind: "Slice",
          target: expression,
          hi: firstNumber,
          lo: secondNumber,
          span: {
            line: startToken.line,
            column: startToken.column,
            offset: startToken.offset,
            length: Math.max(1, this.peek().offset - startToken.offset),
          },
        };
      } else {
        this.expectSymbol("]");
        result = {
          kind: "Index",
          target: expression,
          index: firstNumber,
          span: {
            line: startToken.line,
            column: startToken.column,
            offset: startToken.offset,
            length: Math.max(1, this.peek().offset - startToken.offset),
          },
        };
      }
      expression = result;
    }
    return expression;
  }

  private parseCall(): CallAst {
    const name = this.advance();
    const start = name;
    this.expectSymbol("(");
    this.skipNewlines();
    const args: CallArgumentAst[] = [];
    let sawNamed = false;
    let sawPositionalAfterNamed = false;

    while (!this.atEnd() && !this.checkSymbol(")")) {
      const argStart = this.peek();
      let argName: string | null = null;
      if (
        this.peek().kind === "identifier" &&
        this.peek(1)?.kind === "symbol" &&
        this.peek(1)?.value === "="
      ) {
        argName = this.advance().value;
        this.advance(); // =
        sawNamed = true;
      } else if (sawNamed) {
        sawPositionalAfterNamed = true;
      }
      const value = this.parseExpression();
      args.push({
        name: argName,
        value,
        span: mergeSpan(argStart, this.previous()),
      });
      this.skipNewlines();
      if (this.matchSymbol(",")) {
        this.skipNewlines();
        if (this.checkSymbol(")")) break;
        continue;
      }
      if (!this.checkSymbol(")")) {
        this.error(
          "E115",
          "Expected a comma or closing parenthesis in the argument list.",
          this.peek(),
        );
        this.recoverToExpressionEnd();
      }
    }

    if (sawPositionalAfterNamed) {
      this.error(
        "E116",
        "Positional arguments cannot follow named arguments.",
        start,
        "Use either all positional arguments or all name = value arguments.",
      );
    }

    this.expectSymbol(")");
    return {
      kind: "Call",
      name: name.value,
      args,
      span: mergeSpan(start, this.previous()),
    };
  }

  private parseReference(): ReferenceAst {
    const start = this.peek();
    const path = this.parsePath();
    return {
      kind: "Reference",
      path,
      span: mergeSpan(start, this.previous()),
    };
  }

  private parsePath(): string[] {
    const first = this.expectIdentifier("a name");
    const path = [first.value];
    while (this.checkSymbol(".")) {
      this.advance();
      const segment = this.expectIdentifier("a name after the dot");
      path.push(segment.value);
    }
    return path;
  }

  private parseLiteral(): LiteralAst {
    const token = this.peek();
    if (token.kind !== "number") {
      this.error(
        "E117",
        `Expected a number, found "${token.raw || "end of file"}".`,
        token,
        "Logic values are written as 0, 1, 0b1010, 0x0F, or binary strings such as 00000011.",
      );
      if (!this.atEnd() && !this.checkNewline() && !this.checkSymbol(")")) this.advance();
      return { kind: "Literal", raw: "0", span: tokenSpan(token) };
    }
    this.advance();
    const clean = token.raw.replaceAll("_", "");
    if (
      !/^(?:0[bB][01]+|0[xX][0-9a-fA-F]+|[0-9]+)$/.test(clean) ||
      clean === "0b" ||
      clean === "0x"
    ) {
      this.error(
        "E118",
        `Invalid number literal "${token.raw}".`,
        token,
        "Use decimal, 0b binary, 0x hexadecimal, or a binary string such as 00000011.",
      );
    }
    return { kind: "Literal", raw: token.raw, span: tokenSpan(token) };
  }

  private assignmentHint(token: Token): string {
    if (token.kind === "identifier") {
      return `To assign a signal, write ${token.value} = expression.`;
    }
    return "Check the line and close the previous block if necessary.";
  }

  private finishStatement(): void {
    if (this.atEnd()) return;
    if (this.checkNewline()) {
      this.skipNewlines();
      return;
    }
    this.error(
      "E119",
      `Expected the end of the line; found "${this.peek().raw}".`,
      this.peek(),
      "LogicFlow statements are line-oriented. Start each declaration or assignment on a new line.",
    );
    this.recoverToLineEnd();
  }

  private recoverToLineEnd(): void {
    while (!this.atEnd() && !this.checkNewline()) this.advance();
    this.skipNewlines();
  }

  private recoverToExpressionEnd(): void {
    let depth = 0;
    while (!this.atEnd()) {
      const token = this.peek();
      if (token.kind === "symbol" && (token.value === "(" || token.value === "[")) depth += 1;
      if (token.kind === "symbol" && (token.value === ")" || token.value === "]")) {
        if (depth === 0) return;
        depth -= 1;
      }
      if (token.kind === "newline" || (token.kind === "symbol" && token.value === "," && depth === 0)) {
        return;
      }
      this.advance();
    }
  }

  private recoverToTopLevel(): void {
    while (!this.atEnd()) {
      if (keyword(this.peek(), "CIRCUIT") || keyword(this.peek(), "TEST")) return;
      this.advance();
    }
  }

  private skipNewlines(): void {
    while (this.checkNewline()) this.advance();
  }

  private atEnd(): boolean {
    return this.peek().kind === "eof";
  }

  private checkNewline(): boolean {
    return this.peek().kind === "newline";
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)]!;
  }

  private previous(): Token {
    return this.tokens[Math.max(0, this.index - 1)]!;
  }

  private advance(): Token {
    const token = this.peek();
    if (!this.atEnd()) this.index += 1;
    return token;
  }

  private checkSymbol(symbol: string): boolean {
    const token = this.peek();
    return token.kind === "symbol" && token.value === symbol;
  }

  private matchSymbol(symbol: string): boolean {
    if (!this.checkSymbol(symbol)) return false;
    this.advance();
    return true;
  }

  private expectSymbol(symbol: string): Token {
    if (this.checkSymbol(symbol)) return this.advance();
    this.error(
      "E120",
      `Expected "${symbol}", found "${this.peek().raw || "end of file"}".`,
      this.peek(),
    );
    return this.peek();
  }

  private expectKeyword(name: string): Token {
    if (keyword(this.peek(), name)) return this.advance();
    this.error(
      "E121",
      `Expected ${name}, found "${this.peek().raw || "end of file"}".`,
      this.peek(),
    );
    return { ...this.peek(), value: name, kind: "identifier" };
  }

  private expectIdentifier(description: string): Token {
    if (isIdentifier(this.peek())) return this.advance();
    this.error(
      "E122",
      `Expected ${description}, found "${this.peek().raw || "end of file"}".`,
      this.peek(),
    );
    return {
      ...this.peek(),
      kind: "identifier",
      value: "_invalid_",
      raw: "_invalid_",
      length: 9,
    };
  }

  private expectKind(kind: Token["kind"], description: string): Token {
    if (this.peek().kind === kind) return this.advance();
    this.error(
      "E123",
      `Expected ${description}, found "${this.peek().raw || "end of file"}".`,
      this.peek(),
    );
    return this.peek();
  }

  private error(code: string, message: string, token: Token, hint?: string): void {
    this.bag.error(code, message, token.line, token.column, {
      length: token.length,
      hint,
    });
  }
}

export function parse(source: string, maxErrors = 100): {
  program: ProgramAst;
  diagnostics: Diagnostic[];
} {
  const parser = new Parser(source, [], maxErrors);
  const program = parser.parse();
  return { program, diagnostics: parser.diagnostics };
}
