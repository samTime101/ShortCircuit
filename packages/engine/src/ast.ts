export interface SourceSpan {
  line: number;
  column: number;
  offset: number;
  length: number;
}

export interface ProgramAst {
  kind: "Program";
  /** Compile-time constants declared before the circuits. */
  constants: ConstDeclAst[];
  circuits: CircuitAst[];
  tests: TestAst[];
}

/** A compile-time integer expression. */
export type ConstExprAst =
  | { kind: "ConstNumber"; value: number; span: SourceSpan }
  | { kind: "ConstName"; name: string; span: SourceSpan }
  | {
      kind: "ConstBinary";
      op: "+" | "-" | "*" | "/" | "%";
      left: ConstExprAst;
      right: ConstExprAst;
      span: SourceSpan;
    }
  | { kind: "ConstUnary"; op: "-"; operand: ConstExprAst; span: SourceSpan };

/** A compile-time constant declaration. */
export interface ConstDeclAst {
  kind: "Const";
  name: string;
  value: ConstExprAst;
  span: SourceSpan;
}

/** One segment of a path, optionally indexed as in cell[0].port. */
export interface PathSegment {
  name: string;
  index: ConstExprAst | null;
}

export type Path = PathSegment[];

export interface CircuitAst {
  kind: "Circuit";
  name: string;
  span: SourceSpan;
  body: CircuitItemAst[];
}

export type CircuitItemAst =
  | InputDeclAst
  | OutputDeclAst
  | StateDeclAst
  | AssignmentAst
  | ForAst
  | OnBlockAst;

export interface InputDeclAst {
  kind: "Input";
  name: string;
  width: ConstExprAst | null;
  span: SourceSpan;
}

export interface OutputDeclAst {
  kind: "Output";
  path: Path;
  span: SourceSpan;
}

export interface StateDeclAst {
  kind: "State";
  name: string;
  width: ConstExprAst | null;
  init: LiteralAst | null;
  span: SourceSpan;
}

export interface AssignmentAst {
  kind: "Assignment";
  target: Path;
  value: ExpressionAst;
  span: SourceSpan;
}

/** A compile-time loop, unrolled before analysis. */
export interface ForAst {
  kind: "For";
  variable: string;
  from: ConstExprAst;
  to: ConstExprAst;
  body: CircuitItemAst[];
  span: SourceSpan;
}

export interface OnBlockAst {
  kind: "On";
  edge: "rising" | "falling";
  clock: ReferenceAst;
  body: SequentialStatementAst[];
  span: SourceSpan;
}

export type SequentialStatementAst = SequentialAssignmentAst | IfAst;

export interface SequentialAssignmentAst {
  kind: "SequentialAssignment";
  target: Path;
  value: ExpressionAst;
  span: SourceSpan;
}

export interface IfAst {
  kind: "If";
  condition: ExpressionAst;
  thenBody: SequentialStatementAst[];
  elseBody: SequentialStatementAst[] | null;
  span: SourceSpan;
}

export type ExpressionAst =
  | LiteralAst
  | ReferenceAst
  | CallAst
  | IndexAst
  | SliceAst;

export interface LiteralAst {
  kind: "Literal";
  raw: string;
  span: SourceSpan;
}

export interface ReferenceAst {
  kind: "Reference";
  path: Path;
  span: SourceSpan;
}

export interface CallArgumentAst {
  name: string | null;
  value: ExpressionAst;
  span: SourceSpan;
}

export interface CallAst {
  kind: "Call";
  name: string;
  args: CallArgumentAst[];
  span: SourceSpan;
}

export interface IndexAst {
  kind: "Index";
  target: ExpressionAst;
  index: ConstExprAst;
  span: SourceSpan;
}

export interface SliceAst {
  kind: "Slice";
  target: ExpressionAst;
  hi: ConstExprAst;
  lo: ConstExprAst;
  span: SourceSpan;
}

export type TestStatementAst =
  | TestInputAst
  | TestExpectAst
  | TestLoadAst
  | TestStepAst
  | TestCycleAst;

export interface TestInputAst {
  kind: "TestInput";
  name: string;
  value: LiteralAst;
  span: SourceSpan;
}

export interface TestExpectAst {
  kind: "TestExpect";
  path: Path;
  value: LiteralAst;
  span: SourceSpan;
}

/** Forces a state signal to a value, for tests that need a starting point. */
export interface TestLoadAst {
  kind: "TestLoad";
  path: Path;
  value: LiteralAst;
  span: SourceSpan;
}

/** Groups input changes into a single simulation step. */
export interface TestStepAst {
  kind: "TestStep";
  statements: TestStatementAst[];
  span: SourceSpan;
}

/** Pulses a clock 0 -> 1 -> 0 a number of times. */
export interface TestCycleAst {
  kind: "TestCycle";
  clock: string;
  count: number;
  span: SourceSpan;
}

export interface TestCaseAst {
  kind: "Case";
  label: string;
  statements: TestStatementAst[];
  span: SourceSpan;
}

export interface TestAst {
  kind: "Test";
  name: string;
  cases: TestCaseAst[];
  span: SourceSpan;
}
