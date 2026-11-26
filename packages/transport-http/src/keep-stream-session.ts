import type { Clock, InvocationSession, KeelwerkError, LiveTimers, Outcome } from '@keelwerk/core';
import { asKeelwerkError, coreError } from '@keelwerk/core/http';
import { answerMs } from './answer-ms.ts';
import { holdsSameCredentials } from './holds-same-credentials.ts';
import { nextSessionCheckAt } from './next-session-check-at.ts';

async function revalidated(session: InvocationSession): Promise<Outcome<InvocationSession>> {
  try {
    return await session.revalidate();
  } catch (failure) {
    return { ok: false, error: asKeelwerkError(failure) };
  }
}

/** No check starts sooner than this after the previous check started. */
const floorMs = 1000;

const earlier = (a: Temporal.Instant, b: Temporal.Instant): Temporal.Instant =>
  Temporal.Instant.compare(a, b) <= 0 ? a : b;

const later = (a: Temporal.Instant, b: Temporal.Instant): Temporal.Instant =>
  Temporal.Instant.compare(a, b) >= 0 ? a : b;

const expiredError = (): KeelwerkError =>
  coreError('core.unauthenticated', { message: 'The session expired.' });

/**
 * The session check of one HTTP stream (16.3.4, the rule of `keepSocketSession`): at
 * `nextSessionCheckAt` it runs `session.revalidate()` on the host's timers. `end` is called at most
 * once, and the loop stops, when the check answers an error, when it throws (`asKeelwerkError`), when
 * the renewal holds other credentials than the session checked (`core.unauthenticated`), when a check
 * does not answer within `revalidateMs` (`core.unavailable`), or at `expiresAt`
 * (`core.unauthenticated`, 'The session expired.'). The check at the expiry starts one second before
 * `expiresAt` (never sooner than one second after the previous check started) and races the expiry;
 * nothing continues the stream past `expiresAt` except a renewal answered before it with a strictly
 * later `expiresAt` (or none). A session already expired when the function is called ends at once.
 * The first wait is registered before the function returns; aborting `signal` ends every wait and
 * returns the loop at once, also from a check that never answers. It returns the `expiresAt` of the
 * session the stream holds now (the latest renewal accepted), so a caller can refuse a chunk that
 * comes after it before the timer of the expiry has run.
 */
export function keepStreamSession(input: {
  readonly session: InvocationSession;
  readonly revalidateMs: number;
  readonly clock: Clock;
  readonly timers: LiveTimers;
  readonly signal: AbortSignal;
  readonly end: (error: KeelwerkError) => void;
}): { readonly expiresAt: () => Temporal.Instant | undefined } {
  const { clock, timers, signal } = input;
  let held = input.session;
  const isPast = (instant: Temporal.Instant | undefined): boolean =>
    instant !== undefined && Temporal.Instant.compare(instant, clock.now()) <= 0;
  // The check races its own ends: the expiry, the bound of one interval and the abort of the stream.
  // Whichever comes first answers; a wait the abort cut short answers too, and the loop then returns.
  const checked = async (
    session: InvocationSession,
    startedAt: Temporal.Instant,
  ): Promise<Outcome<InvocationSession>> => {
    const waiting = new AbortController();
    const stop = AbortSignal.any([signal, waiting.signal]);
    const { expiresAt } = session;
    const bound = startedAt.add({ milliseconds: Math.max(input.revalidateMs, floorMs) });
    const wait = (
      at: Temporal.Instant,
      error: KeelwerkError,
    ): Promise<Outcome<InvocationSession>> =>
      timers.sleepUntil(at, stop).then(() => ({ ok: false as const, error }));
    try {
      return await Promise.race([
        revalidated(session),
        ...(expiresAt === undefined ? [] : [wait(expiresAt, expiredError())]),
        ...(expiresAt === undefined || Temporal.Instant.compare(bound, expiresAt) < 0
          ? [
              wait(
                bound,
                coreError('core.unavailable', { message: 'The session check did not answer.' }),
              ),
            ]
          : []),
      ]);
    } finally {
      waiting.abort();
    }
  };
  void (async () => {
    let session = held;
    // The caller resolved the session just before, which is as good as a check.
    let previous = clock.now();
    while (!signal.aborted) {
      const { expiresAt } = session;
      const now = clock.now();
      if (isPast(expiresAt)) {
        input.end(expiredError());
        return;
      }
      let at = nextSessionCheckAt(now, input.revalidateMs, undefined);
      if (expiresAt !== undefined) {
        at = earlier(at, later(now, expiresAt.subtract({ milliseconds: answerMs })));
      }
      at = later(
        at,
        earlier(previous.add({ milliseconds: floorMs }), now.add({ milliseconds: floorMs })),
      );
      if (expiresAt !== undefined && Temporal.Instant.compare(at, expiresAt) >= 0) {
        // The floor reaches the expiry: no check can answer before it.
        if (await timers.sleepUntil(expiresAt, signal)) input.end(expiredError());
        return;
      }
      if (!(await timers.sleepUntil(at, signal))) return;
      if (isPast(expiresAt)) {
        input.end(expiredError());
        return;
      }
      previous = clock.now();
      const outcome = await checked(session, previous);
      if (signal.aborted) return;
      // An answer seen at or after the expiry never continues the stream, even when the timer of the
      // expiry has not fired yet.
      if (isPast(expiresAt)) {
        input.end(expiredError());
        return;
      }
      if (!outcome.ok) {
        input.end(outcome.error);
        return;
      }
      if (!holdsSameCredentials(session, outcome.value)) {
        input.end(
          coreError('core.unauthenticated', {
            message: 'The session no longer holds the credentials the stream opened with.',
          }),
        );
        return;
      }
      session = outcome.value;
      held = session;
    }
  })();
  return { expiresAt: () => held.expiresAt };
}
