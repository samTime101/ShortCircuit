import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compile } from "@shortcircuit/engine";
import { createCompilerClient } from "../lib/compilerClient";

const SOURCE = `CIRCUIT Wire
  INPUT a
  OUTPUT b
  b = a
END`;

type Behavior = "respond" | "silent" | "crash" | "messageerror" | "throw";

interface WorkerRequest {
  id: number;
  source: string;
  options: object;
}

class FakeWorker {
  static instances: FakeWorker[] = [];
  static behavior: Behavior = "respond";

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly requests: WorkerRequest[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(request: WorkerRequest): void {
    this.requests.push(request);
    if (FakeWorker.behavior === "throw") {
      throw new Error("worker is gone");
    }
    if (FakeWorker.behavior === "silent") return;
    queueMicrotask(() => {
      if (this.terminated) return;
      if (FakeWorker.behavior === "crash") {
        this.onerror?.({} as ErrorEvent);
        return;
      }
      if (FakeWorker.behavior === "messageerror") {
        this.onmessageerror?.(new MessageEvent("messageerror"));
        return;
      }
      this.onmessage?.({
        data: { id: request.id, result: compile(request.source) },
      } as MessageEvent);
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

function installWorker(behavior: Behavior): void {
  FakeWorker.behavior = behavior;
  FakeWorker.instances = [];
  (globalThis as unknown as { Worker: typeof Worker }).Worker =
    FakeWorker as unknown as typeof Worker;
}

describe("compiler client", () => {
  it("compiles a source, falling back to the main thread when there is no worker", async () => {
    const client = createCompilerClient();
    try {
      const result = await client.compile(SOURCE);
      expect(result.ok).toBe(true);
      expect(result.circuits[0]?.name).toBe("Wire");
    } finally {
      client.dispose();
    }
  });

  it("reports diagnostics from a broken source", async () => {
    const client = createCompilerClient();
    try {
      const result = await client.compile(
        'IMPORT "@shortcircuit/gates"\nCIRCUIT Broken\nINPUT a\nx = AND(a, missing)\nEND',
      );
      expect(result.ok).toBe(false);
      expect(result.diagnostics.some((item) => item.code === "E201")).toBe(true);
    } finally {
      client.dispose();
    }
  });
});

describe("compiler client with a worker", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "Worker");

  beforeEach(() => {
    installWorker("respond");
  });

  afterEach(() => {
    if (original) Object.defineProperty(globalThis, "Worker", original);
    else Reflect.deleteProperty(globalThis, "Worker");
  });

  it("sends the request to the worker and resolves its reply", async () => {
    const client = createCompilerClient();
    try {
      const result = await client.compile(SOURCE);
      expect(result.ok).toBe(true);
      expect(FakeWorker.instances).toHaveLength(1);
      expect(FakeWorker.instances[0]!.requests).toHaveLength(1);
      expect(FakeWorker.instances[0]!.requests[0]!.source).toBe(SOURCE);
      expect(FakeWorker.instances[0]!.terminated).toBe(false);
    } finally {
      client.dispose();
    }
  });

  it("falls back to the main thread when the worker crashes", async () => {
    installWorker("crash");
    const client = createCompilerClient();
    try {
      const result = await client.compile(SOURCE);
      expect(result.ok).toBe(true);
      expect(FakeWorker.instances).toHaveLength(1);
      expect(FakeWorker.instances[0]!.terminated).toBe(true);

      // A retired worker is never reused; the next compile stays local.
      const again = await client.compile(SOURCE);
      expect(again.ok).toBe(true);
      expect(FakeWorker.instances).toHaveLength(1);
    } finally {
      client.dispose();
    }
  });

  it("falls back when a message cannot be decoded", async () => {
    installWorker("messageerror");
    const client = createCompilerClient();
    try {
      const result = await client.compile(SOURCE);
      expect(result.ok).toBe(true);
      expect(FakeWorker.instances[0]!.terminated).toBe(true);
    } finally {
      client.dispose();
    }
  });

  it("times out a silent worker and settles every pending request", async () => {
    installWorker("silent");
    const client = createCompilerClient({ timeoutMs: 10 });
    try {
      const results = await Promise.all([client.compile(SOURCE), client.compile(SOURCE)]);
      expect(results.map((result) => result.ok)).toEqual([true, true]);
      expect(FakeWorker.instances[0]!.requests).toHaveLength(2);
      expect(FakeWorker.instances[0]!.terminated).toBe(true);
    } finally {
      client.dispose();
    }
  });

  it("falls back when the worker rejects the message", async () => {
    installWorker("throw");
    const client = createCompilerClient();
    try {
      const result = await client.compile(SOURCE);
      expect(result.ok).toBe(true);
      expect(FakeWorker.instances[0]!.terminated).toBe(true);

      const again = await client.compile(SOURCE);
      expect(again.ok).toBe(true);
      expect(FakeWorker.instances).toHaveLength(1);
    } finally {
      client.dispose();
    }
  });

  it("drains every queued request when a later postMessage throws", async () => {
    installWorker("silent");
    const client = createCompilerClient({ timeoutMs: 0 });
    try {
      const first = client.compile(SOURCE);
      FakeWorker.behavior = "throw";
      const second = client.compile(SOURCE);

      const results = await Promise.all([first, second]);
      expect(results.map((result) => result.ok)).toEqual([true, true]);
      expect(FakeWorker.instances).toHaveLength(1);
      expect(FakeWorker.instances[0]!.terminated).toBe(true);
    } finally {
      client.dispose();
    }
  });

  it("finishes pending work on dispose instead of leaving it hanging", async () => {
    installWorker("silent");
    const client = createCompilerClient({ timeoutMs: 0 });
    const pending = client.compile(SOURCE);
    client.dispose();

    const result = await pending;
    expect(result.ok).toBe(true);
    expect(FakeWorker.instances[0]!.terminated).toBe(true);
  });
});
