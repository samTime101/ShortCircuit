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

export interface CompilerClientOptions {
  /**
   * How long one worker request may run before the client assumes the worker
   * is wedged, terminates it, and finishes the work on the main thread.
   */
  timeoutMs?: number;
}

interface Pending {
  source: string;
  options: CompileOptions;
  resolve(result: CompileResult): void;
  reject(error: Error): void;
  timer: number | null;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export function createCompilerClient(options: CompilerClientOptions = {}): CompilerClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let worker: Worker | null = null;
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let broken = false;

  const clearEntryTimer = (entry: Pending): void => {
    if (entry.timer !== null) {
      window.clearTimeout(entry.timer);
      entry.timer = null;
    }
  };

  /**
   * Finishes every waiting request on the main thread. This is the recovery
   * path for a crash, a message-decoding failure, and a timeout.
   */
  const drainOnMainThread = (): void => {
    const entries = [...pending.values()];
    pending.clear();
    for (const entry of entries) {
      clearEntryTimer(entry);
      try {
        entry.resolve(compile(entry.source, entry.options));
      } catch (error) {
        entry.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };

  /** Terminates the current worker; it will not be reused after a failure. */
  const retireWorker = (): void => {
    const current = worker;
    worker = null;
    broken = true;
    if (!current) return;
    current.onmessage = null;
    current.onerror = null;
    current.onmessageerror = null;
    current.terminate();
  };

  const failWorker = (): void => {
    retireWorker();
    drainOnMainThread();
  };

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

    const active = worker;
    active.onmessage = (event: MessageEvent<{ id: number; result: CompileResult }>) => {
      const { id, result } = event.data;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      clearEntryTimer(entry);
      entry.resolve(result);
    };

    active.onerror = () => {
      // The worker is gone: finish the outstanding work on the main thread so
      // the studio keeps working.
      failWorker();
    };

    // Some browser kills surface a message-decoding failure instead of an
    // error event. Treat it the same way rather than leaving promises hanging.
    active.onmessageerror = () => {
      failWorker();
    };

    return active;
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
        const entry: Pending = {
          source,
          options: settings,
          resolve,
          reject,
          timer: null,
        };
        pending.set(id, entry);
        entry.timer = window.setTimeout(() => {
          // A request that never answers must not leave the UI spinning.
          if (!pending.has(id)) return;
          failWorker();
        }, timeoutMs);
        try {
          active.postMessage({ id, source, options: settings });
        } catch {
          // A worker that cannot accept a message is broken too. Retire it and
          // finish every queued request on the main thread, not just this one.
          failWorker();
        }
      });
    },
    dispose() {
      // Finish any waiting request on the main thread, then let the worker go.
      drainOnMainThread();
      const current = worker;
      worker = null;
      if (current) {
        current.onmessage = null;
        current.onerror = null;
        current.onmessageerror = null;
        current.terminate();
      }
    },
  };
}
