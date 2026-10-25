import type { CircuitIR, TestSuiteIR } from "@shortcircuit/engine";
import type {
  StudioCompileData,
  StudioDerivedPayload,
} from "./studioCompute";
import type { StudioDerivedKind } from "./studioModel";

export interface CompileWorkerRequest {
  type: "compile";
  id: number;
  filePath: string;
  source: string;
  activeCircuitName?: string;
  /** [absolute path, unsaved source] pairs for open package files. */
  openSources: Array<[string, string]>;
}

export interface DeriveWorkerRequest {
  type: "derive";
  id: number;
  kind: StudioDerivedKind;
  circuit: CircuitIR;
  allCircuits: CircuitIR[];
  tests: TestSuiteIR[];
}

export interface InvalidateWorkerRequest {
  type: "invalidate";
  id: number;
}

export type StudioWorkerRequest =
  | CompileWorkerRequest
  | DeriveWorkerRequest
  | InvalidateWorkerRequest;

/** A request before the client assigns its correlation id. */
export type StudioWorkerRequestInput =
  | Omit<CompileWorkerRequest, "id">
  | Omit<DeriveWorkerRequest, "id">
  | Omit<InvalidateWorkerRequest, "id">;

export type StudioWorkerResponse =
  | { type: "compileResult"; id: number; data: StudioCompileData }
  | {
      type: "deriveResult";
      id: number;
      kind: StudioDerivedKind;
      payload: StudioDerivedPayload;
    }
  | { type: "invalidated"; id: number }
  | { type: "error"; id: number; message: string };
