import { Worker } from "node:worker_threads";
import type {
  StudioWorkerRequestInput,
  StudioWorkerResponse,
} from "./studioWorkerProtocol";

interface PendingRequest {
  resolve(response: StudioWorkerResponse): void;
  reject(error: Error): void;
}

/**
 * Thin promise wrapper around a long-lived studio worker thread.
 *
 * A failed worker never takes the extension down: the provider falls back to
 * synchronous compilation for the current edit and keeps working.
 */
export class StudioWorkerClient {
  private worker: Worker | null = null;
  private pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private broken = false;
  private disposed = false;
  /** Workers we terminated on purpose; their exit events must be ignored. */
  private terminating = new Set<Worker>();

  constructor(
    private readonly workerPath: string,
    private readonly label: string,
  ) {}

  public get available(): boolean {
    return !this.broken && !this.disposed;
  }

  /** True while at least one request is still running in this worker. */
  public get busy(): boolean {
    return this.pending.size > 0;
  }

  public request(
    message: StudioWorkerRequestInput,
  ): Promise<StudioWorkerResponse> {
    const worker = this.ensureWorker();
    if (!worker) {
      return Promise.reject(new Error(`${this.label} worker is unavailable.`));
    }

    const id = this.nextId;
    this.nextId += 1;
    return new Promise<StudioWorkerResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ ...message, id });
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Drops any in-flight job by terminating the worker, then starts fresh. */
  public restart(): void {
    const worker = this.worker;
    if (!worker) return;
    this.worker = null;
    this.terminating.add(worker);
    this.rejectAll(new Error(`${this.label} worker was restarted.`));
    void worker.terminate().catch(() => undefined);
  }

  /** Clears cached package manifests/sources inside a live worker. */
  public invalidate(): void {
    const worker = this.worker;
    if (!worker) return;
    this.nextId += 1;
    try {
      worker.postMessage({ type: "invalidate", id: this.nextId });
    } catch {
      // The next request will start a fresh worker with an empty cache.
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const worker = this.worker;
    this.worker = null;
    this.rejectAll(new Error(`${this.label} worker was disposed.`));
    if (worker) void worker.terminate().catch(() => undefined);
  }

  private ensureWorker(): Worker | null {
    if (this.disposed || this.broken) return null;
    if (this.worker) return this.worker;

    try {
      const worker = new Worker(this.workerPath);
      worker.on("message", (message: StudioWorkerResponse) => {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        this.pending.delete(message.id);
        if (message.type === "error") {
          entry.reject(new Error(message.message));
        } else {
          entry.resolve(message);
        }
      });
      worker.on("error", (error) => {
        if (this.disposed || this.terminating.has(worker)) return;
        if (this.worker !== worker) return;
        this.fail(error instanceof Error ? error : new Error(String(error)));
      });
      worker.on("exit", (code) => {
        // A worker we replaced may exit after a newer one has already started.
        // It must not reject the new worker's requests or mark the client broken.
        if (this.terminating.delete(worker)) return;
        if (this.worker === worker) this.worker = null;
        if (this.disposed) return;
        this.rejectAll(
          new Error(`${this.label} worker exited with code ${code}.`),
        );
        if (code !== 0) this.broken = true;
      });
      this.worker = worker;
      return worker;
    } catch (error) {
      this.broken = true;
      console.warn(
        `[ShortCircuit] Could not start ${this.label} worker:`,
        error,
      );
      return null;
    }
  }

  private fail(error: Error): void {
    this.broken = true;
    const worker = this.worker;
    this.worker = null;
    if (worker) void worker.terminate().catch(() => undefined);
    this.rejectAll(error);
    console.warn(`[ShortCircuit] ${this.label} worker failed:`, error);
  }

  private rejectAll(error: Error): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const entry of pending) entry.reject(error);
  }
}
