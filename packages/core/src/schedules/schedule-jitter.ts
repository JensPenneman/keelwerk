import { sha256 } from '../crypto/sha256.ts';
import { durationMs } from '../effects/duration-ms.ts';

/**
 * The delay in milliseconds (0 to the jitter, inclusive) of one tick's job: the first 8 hexadecimal
 * digits of sha256(`${ref}\n${scopeId}\n${tick in epoch milliseconds}`) modulo the jitter plus one;
 * 0 without a jitter. It is fixed by its inputs, so every process and every test computes the same
 * run time, and the jobs of one tick spread over the jitter instead of arriving together.
 */
export function scheduleJitter(
  ref: string,
  scopeId: string,
  tick: Temporal.Instant,
  jitter: string | undefined,
): number {
  if (jitter === undefined) return 0;
  const hash = sha256(`${ref}\n${scopeId}\n${tick.epochMilliseconds}`);
  return Number.parseInt(hash.slice(0, 8), 16) % (durationMs(jitter) + 1);
}
