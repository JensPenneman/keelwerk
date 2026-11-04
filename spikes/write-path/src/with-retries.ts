import { setTimeout as delay } from 'node:timers/promises';
import { errorCode } from './error-code.ts';

// Version conflict (the unique stream version, or the versioned update), serialization failure, deadlock.
const retryable = new Set(['23505', 'kw_conflict', '40001', '40P01']);

/**
 * Repeats a unit up to `limit` times with jitter on a version conflict, a serialization failure or a
 * deadlock (sections 7.9.4 phase 7 and 14.3.6); any other error propagates.
 */
export async function withRetries<T>(
  unit: () => Promise<T>,
  random: () => number,
  limit = 3,
): Promise<{
  readonly value: T | undefined;
  readonly retries: number;
  readonly codes: readonly string[];
}> {
  const codes: string[] = [];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return { value: await unit(), retries: attempt, codes };
    } catch (error) {
      const code = errorCode(error);
      if (code === undefined || !retryable.has(code)) throw error;
      codes.push(code);
      if (attempt === limit) return { value: undefined, retries: attempt, codes };
      // Full jitter over a window that doubles per attempt; the specification leaves the window open.
      await delay(random() * 2 ** attempt * 2);
    }
  }
}
