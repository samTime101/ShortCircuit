export interface SourceSpan {
  line: number;
  column: number;
  offset: number;
  length: number;
}

export interface ProgramAst {
  kind: "Program";
  circuits: CircuitAst[];
  tests: TestAst[];
}

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
  | OnBlockAst;

export interface InputDeclAst {
  kind: "Input";
  name: string;
  width: number | null;
  span: SourceSpan;
}

export interface OutputDeclAst {
  kind: "Output";
  path: string[];
  span: SourceSpan;
}

export interface StateDeclAst {
  kind: "State";
  name: string;
  width: number | null;
  init: LiteralAst | null;
  span: SourceSpan;
}

export interface AssignmentAst {
  kind: "Assignment";
  target: string[];
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

export type SequentialStatementAst = SequentialAssignmentAst | IfAst;

export interface SequentialAssignmentAst {
  kind: "SequentialAssignment";
  target: string[];
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
  path: string[];
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
  index: number;
  span: SourceSpan;
}

export interface SliceAst {
  kind: "Slice";
  target: ExpressionAst;
  hi: number;
  lo: number;
  span: SourceSpan;
}

export type TestStatementAst = TestInputAst | TestExpectAst;

export interface TestInputAst {
  kind: "TestInput";
  name: string;
  value: LiteralAst;
  span: SourceSpan;
}

export interface TestExpectAst {
  kind: "TestExpect";
  path: string[];
  value: LiteralAst;
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
