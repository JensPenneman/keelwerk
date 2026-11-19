import type { EventWorker, RetentionRun } from '@keelwerk/core';

/** The event worker that purges the operational buffers (`runs: ['retention']`). */
export interface RetentionWorker extends EventWorker {
  /** One pass now over every scope served here, whatever the window; answers the runs it recorded. */
  pass(): Promise<readonly RetentionRun[]>;
  /** Resolves when no unit of the worker is running any more, an abandoned one included. */
  settled(): Promise<void>;
}
