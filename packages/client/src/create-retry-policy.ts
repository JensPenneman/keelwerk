import type { RetryPolicy } from './retry-policy.ts';

function sleep(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** The default policy (three retries, 200 ms base, 5 s cap) with the given members replaced. */
export function createRetryPolicy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
  return {
    retries: 3,
    baseDelayMs: 200,
    maxDelayMs: 5000,
    random: Math.random,
    sleep,
    ...overrides,
  };
}
