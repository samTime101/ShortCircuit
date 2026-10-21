export interface SourceSpan {
  line: number;
  column: number;
  offset: number;
  length: number;
}

export interface ProgramAst {
  kind: "Program";
  imports: ImportAst[];
  circuits: CircuitAst[];
  tests: TestAst[];
}

/** A top-level package import. */
export interface ImportAst {
  kind: "Import";
  packageName: string;
  /** Optional qualifier, as in `IMPORT "@scope/pkg" AS Pkg`. */
  alias: string | null;
  span: SourceSpan;
}

/** A numeric width, bit index, or slice bound. */
export interface ConstExprAst {
  kind: "ConstNumber";
  value: number;
  span: SourceSpan;
}

/** One segment of a path, optionally indexed as in cell[0].port. */
export interface PathSegment {
  name: string;
  /** Numeric instance indexes, as in cell[0][1]. */
  indexes: ConstExprAst[];
}

export type Path = PathSegment[];

export interface CircuitAst {
  kind: "Circuit";
  name: string;
  /** Set when the circuit came from a package. */
  packageName?: string;
  packageVersion?: string;
  span: SourceSpan;
  body: CircuitItemAst[];
}

export type CircuitItemAst =
  | InputDeclAst
  | OutputDeclAst
  | StateDeclAst
  | AssignmentAst
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

export interface OnBlockAst {
  kind: "On";
  edge: "rising" | "falling";
  clock: ReferenceAst;
  body: SequentialStatementAst[];
  span: SourceSpan;
}

export type SequentialStatementAst = SequentialAssignmentAst;

export interface SequentialAssignmentAst {
  kind: "SequentialAssignment";
  target: Path;
  value: ExpressionAst;
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
