import { compile, type CompileOptions, type CompileResult } from "@shortcircuit/engine";

/**
 * The compile worker.
 *
 * Compilation runs off the main thread, so a large design never blocks
 * typing. Every request carries an id, and the studio drops results that are
 * older than the newest request.
 */

interface CompileRequest {
  id: number;
  source: string;
  options?: CompileOptions;
}

self.onmessage = (event: MessageEvent<CompileRequest>) => {
  const { id, source, options } = event.data;
  const result = compile(source, options ?? {});
  (self as unknown as Worker).postMessage({ id, result });
};
