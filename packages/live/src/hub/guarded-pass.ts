import type { LiveKernel, Logger, Unit } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { logCodeOf } from './log-code-of.ts';
import type { PassState } from './pass-state.ts';
import type { ResolvedHubLimits } from './resolve-hub-limits.ts';

const noop = (): undefined => undefined;

/** What one guarded pass runs with. */
export interface GuardedPassInput<T> {
  readonly kernel: LiveKernel;
  readonly limits: ResolvedHubLimits;
  readonly log: Logger;
  readonly scopeId: string;
  /** How many listeners the reader has now, for the log line of an abandoned pass. */
  readonly listeners: () => number;
  readonly state: PassState;
  /** The work inside the unit; `expired` throws once the pass is past its deadline or was closed. */
  readonly work: (unit: Unit, expired: () => void) => Promise<T>;
}

/**
 * Races a pass's unit against its deadline: late work can deliver nothing, and its late failure is
 * logged once. Closing the reader aborts the pass at once: its timer goes and its unit settles on
 * its own, which `state.units` lets the reader wait for.
 */
export async function guardedPass<T>(input: GuardedPassInput<T>): Promise<T> {
  const { limits, log, scopeId, state } = input;
  let hasExpired = false;
  const abort = new AbortController();
  state.current = abort;
  const expired = (): void => {
    if (hasExpired || abort.signal.aborted) {
      throw errors.unavailable('A live reader pass passed its deadline.');
    }
  };
  const running = input.kernel.read((unit) => input.work(unit, expired), {
    timeoutMs: limits.passTimeoutMs,
    signal: abort.signal,
  });
  const settledUnit = running.then(noop, noop);
  state.units.add(settledUnit);
  void settledUnit.then(() => state.units.delete(settledUnit));
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      hasExpired = true;
      log.warn('a live reader pass was abandoned', {
        scope: scopeId,
        listeners: input.listeners(),
      });
      abort.abort();
      reject(errors.unavailable('A live reader pass passed its deadline.'));
    }, limits.passTimeoutMs);
    abort.signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(errors.unavailable('The live reader was closed.'));
      },
      { once: true },
    );
  });
  try {
    return await Promise.race([running, deadline]);
  } finally {
    clearTimeout(timeout);
    if (state.current === abort) state.current = undefined;
    if (hasExpired) {
      running.then(undefined, (error: unknown) => {
        log.warn('a live reader pass failed after it was abandoned', {
          scope: scopeId,
          code: logCodeOf(error),
        });
      });
    }
  }
}
