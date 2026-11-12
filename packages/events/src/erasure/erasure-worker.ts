import type { EventWorker } from '@keelwerk/core';

/** The event worker that runs erasures (`runs: ['erasure']`). */
export interface ErasureWorker extends EventWorker {
  /** One pass now: every erasure record of the ledger union not yet finished here; answers the count finished. */
  pass(): Promise<number>;
  /** Resolves when no unit of the worker is running any more, an abandoned one included. */
  settled(): Promise<void>;
}
