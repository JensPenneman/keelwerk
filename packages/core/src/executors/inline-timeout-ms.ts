import { durationMs } from '../effects/duration-ms.ts';
import type { ExecutorEntry } from '../registry/executor-entry.ts';

/** How long one inline run of an executor may take: its `timeout`, default 10 seconds (7.9.5). */
export function inlineTimeoutMs(executor: Pick<ExecutorEntry, 'timeout'>): number {
  return durationMs(executor.timeout ?? '10s');
}
