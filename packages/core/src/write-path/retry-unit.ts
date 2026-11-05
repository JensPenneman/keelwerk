import { isUniqueConflict } from '../errors/is-unique-conflict.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { RetryableUnitError } from '../storage/retryable-unit-error.ts';

/** The most times a unit is repeated after the first run (section 14.3.6). */
const retries = 3;

function isRetryable(error: unknown): boolean {
  if (error instanceof RetryableUnitError) return true;
  return (
    error instanceof KeelwerkError &&
    error.code === 'core.version_mismatch' &&
    (error.details as { readonly ifVersion?: boolean } | undefined)?.ifVersion !== true
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** How `retryUnit` waits and draws its jitter; the defaults are the clock and `Math.random`. */
export interface RetryOptions {
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  readonly signal?: AbortSignal;
  /** Repeat the unit once on a unique-index violation, so `decide` sees the committed row (command units only). */
  readonly retryUnique?: boolean;
}

/**
 * Runs `run` and repeats it up to three times on a version conflict, a serialization failure or a
 * deadlock, waiting a random time of up to 2, 4 and 8 ms (full jitter, decision 117). A conflict
 * the caller asked for with `ifVersion` is not repeated. After the last repeat the failure
 * reaches the caller; a unique violation in a command's unit (`retryUnique`) is repeated once, without waiting; an adapter's `RetryableUnitError` never does, it is `unavailable`.
 */
export async function retryUnit<T>(run: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const sleep = options.sleep ?? wait;
  const random = options.random ?? Math.random;
  let uniqueRepeated = false;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (options.retryUnique === true && isUniqueConflict(error)) {
        // Two attempts in total: a second violation is a real conflict.
        if (uniqueRepeated || options.signal?.aborted === true) throw error;
        uniqueRepeated = true;
        continue;
      }
      if (!isRetryable(error)) throw error;
      if (attempt >= retries || options.signal?.aborted === true) {
        if (error instanceof RetryableUnitError) {
          throw new KeelwerkError({
            kind: 'unavailable',
            code: 'core.unavailable',
            message: 'The command could not be committed after repeated attempts.',
            cause: error,
          });
        }
        throw error;
      }
      await sleep(random() * 2 ** (attempt + 1));
    }
  }
}
