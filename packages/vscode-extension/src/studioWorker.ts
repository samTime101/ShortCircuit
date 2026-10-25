import { parentPort } from "node:worker_threads";
import { compileStudioSource, computeStudioDerived } from "./studioCompute";
import { invalidatePackageCache } from "./packageResolver";
import type { StudioWorkerRequest, StudioWorkerResponse } from "./studioWorkerProtocol";

/**
 * Studio background worker.
 *
 * Compilation, layout, test execution, and truth-table enumeration all happen
 * here so the VS Code extension host never blocks while the user types.
 */
if (!parentPort) {
  throw new Error("studio-worker must be started as a worker thread.");
}

const port = parentPort;

function respond(message: StudioWorkerResponse): void {
  port.postMessage(message);
}

port.on("message", (message: StudioWorkerRequest) => {
  try {
    if (message.type === "invalidate") {
      invalidatePackageCache();
      respond({ type: "invalidated", id: message.id });
      return;
    }

    if (message.type === "compile") {
      const data = compileStudioSource(message.filePath, message.source, {
        activeCircuitName: message.activeCircuitName,
        openSources: new Map(message.openSources),
      });
      respond({ type: "compileResult", id: message.id, data });
      return;
    }

    if (message.type === "derive") {
      const payload = computeStudioDerived(
        message.kind,
        message.circuit,
        message.allCircuits,
        message.tests,
      );
      respond({
        type: "deriveResult",
        id: message.id,
        kind: message.kind,
        payload,
      });
      return;
    }
  } catch (error) {
    respond({
      type: "error",
      id: message.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
