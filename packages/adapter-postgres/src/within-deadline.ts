import { setTimeout as delay } from 'node:timers/promises';

/** Waits for `work` at most `ms` milliseconds; resolves `true` when the time ran out first. */
export async function withinDeadline(work: Promise<unknown>, ms: number): Promise<boolean> {
  const timer = new AbortController();
  const timedOut = await Promise.race([
    work.then(
      () => false,
      () => false,
    ),
    delay(Math.max(0, ms), undefined, { signal: timer.signal }).then(
      () => true,
      () => false,
    ),
  ]);
  timer.abort();
  return timedOut;
}
