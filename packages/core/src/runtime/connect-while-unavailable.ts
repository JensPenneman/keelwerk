import { isKeelwerkError } from '../errors/is-keelwerk-error.ts';
import type { Logger } from '../observability/logger.ts';
import { backgroundRetryMs } from './background-retry-ms.ts';

/** Waits `ms`, or less when `signal` aborts; true when it was cut short. */
function pause(ms: number, signal: AbortSignal | undefined): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve(true);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(false);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * The code the driver or the system gave the error behind `error` (`ECONNREFUSED`, `ENOTFOUND`,
 * `57P03`, ...), or `no code` for a failure that has none. Never the error itself or its message:
 * what the wait logs carries no connection string, user name or password.
 */
function causeCode(error: Error): string {
  const { cause } = error;
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return 'no code';
  return typeof cause.code === 'string' ? cause.code : 'no code';
}

/** What `connectWhileUnavailable` needs besides the connect itself. */
export interface StartWait {
  readonly log: Logger;
  /**
   * Ends the wait: the start then fails with the last `core.unavailable`. Without one the wait has
   * no end.
   */
  readonly signal: AbortSignal | undefined;
  /** Default `Math.random`. */
  readonly random?: () => number;
}

/**
 * One connect of the start (section 3.3): while it rejects with `core.unavailable`, the database is
 * not reachable yet, so it waits by `backgroundRetryMs`, says so once per wait, with the placement
 * and the code of the cause, and connects again. Any other error ends the start at once: waiting
 * cannot cure a wrong password, a missing database or a version the adapter refuses. A host name
 * that does not resolve waits like a refused port: under a container runtime that is a database
 * whose container is not up yet, and the code in each warning shows a mistyped host. Each attempt
 * is awaited to its end, so a later close never meets a connect that is still open; only the pause
 * is cut short by the signal.
 */
export async function connectWhileUnavailable<T>(
  what: string,
  connect: () => Promise<T>,
  wait: StartWait,
): Promise<T> {
  for (let failures = 1; ; failures += 1) {
    try {
      return await connect();
    } catch (error) {
      if (!isKeelwerkError(error) || error.code !== 'core.unavailable') throw error;
      if (wait.signal?.aborted === true) throw error;
      const waitMs = backgroundRetryMs(failures, wait.random);
      wait.log.warn('the database is not reachable; the start waits and tries again', {
        placement: what,
        waitMs,
        message: error.message,
        cause: causeCode(error),
      });
      if (await pause(waitMs, wait.signal)) throw error;
    }
  }
}
