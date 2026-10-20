import { compile, type CompileOptions, type CompileResult } from "@shortcircuit/engine";

/**
 * A compiler that runs in a worker when the browser has one, and on the main
 * thread when it does not. The studio only ever sees a promise.
 *
 * The client can be disposed and used again: any request that is still
 * waiting finishes on the main thread, so a remount never loses a result.
 */

export interface CompilerClient {
  compile(source: string, options?: CompileOptions): Promise<CompileResult>;
  dispose(): void;
}

interface Pending {
  source: string;
  options: CompileOptions;
  resolve(result: CompileResult): void;
  reject(error: Error): void;
}

export function createCompilerClient(): CompilerClient {
  let worker: Worker | null = null;
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let broken = false;

  const ensureWorker = (): Worker | null => {
    if (broken) return null;
    if (worker) return worker;
    try {
      worker = new Worker(new URL("../worker/compile.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      broken = true;
      return null;
    }

    worker.onmessage = (event: MessageEvent<{ id: number; result: CompileResult }>) => {
      const { id, result } = event.data;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      entry.resolve(result);
    };

    worker.onerror = () => {
      // The worker is gone: finish the outstanding work on the main thread so
      // the studio keeps working.
      broken = true;
      worker?.terminate();
      worker = null;
      for (const [, entry] of pending) {
        pending.delete(Number([...pending.keys()][0]));
        entry.resolve(compile(entry.source, entry.options));
      }
    };

    return worker;
  };

  return {
    compile(source, options) {
      const settings = options ?? {};
      const active = ensureWorker();
      if (!active) {
        return Promise.resolve(compile(source, settings));
      }
      const id = nextId;
      nextId += 1;
      return new Promise<CompileResult>((resolve, reject) => {
        pending.set(id, { source, options: settings, resolve, reject });
        active.postMessage({ id, source, options: settings });
      });
    },
    dispose() {
      // Finish any waiting request on the main thread, then let the worker go.
      for (const [id, entry] of [...pending]) {
        pending.delete(id);
        entry.resolve(compile(entry.source, entry.options));
      }
      worker?.terminate();
      worker = null;
    },
  };
}
