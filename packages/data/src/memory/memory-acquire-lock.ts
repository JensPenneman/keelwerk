import type { UnitOptions } from '@keelwerk/core';
import { KeelwerkError } from '@keelwerk/core';
import type { MemoryDatabase } from './memory-database.ts';

/**
 * Waits for the namespace's turn, but not longer than the unit's `timeoutMs` and not past its
 * signal. A unit that gives up leaves the queue: its place is released as soon as it is reached.
 */
export async function memoryAcquireLock(
  database: MemoryDatabase,
  key: string,
  options: UnitOptions,
): Promise<() => void> {
  const waiting = database.lock(key);
  const timeout =
    options.timeoutMs === undefined ? undefined : AbortSignal.timeout(options.timeoutMs);
  const signals = [options.signal, timeout].filter((signal) => signal !== undefined);
  if (signals.length === 0) return waiting;
  const stop = AbortSignal.any(signals);
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () =>
      reject(
        timeout?.aborted === true && options.signal?.aborted !== true
          ? new KeelwerkError({
              kind: 'unavailable',
              code: 'core.timeout',
              message: 'The unit waited too long for its turn.',
              details: { timeoutMs: options.timeoutMs },
            })
          : stop.reason,
      );
    if (stop.aborted) onAbort();
    else stop.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([waiting, aborted]);
  } catch (error) {
    waiting.then(
      (release) => release(),
      () => undefined,
    );
    throw error;
  } finally {
    stop.removeEventListener('abort', onAbort);
  }
}
