import type { Clock, InvocationSession, KeelwerkError, LiveTimers, Outcome } from '@keelwerk/core';
import { asKeelwerkError, coreError } from '@keelwerk/core/http';
import { nextSessionCheckAt } from './next-session-check-at.ts';

async function revalidated(session: InvocationSession): Promise<Outcome<InvocationSession>> {
  try {
    return await session.revalidate();
  } catch (failure) {
    return { ok: false, error: asKeelwerkError(failure) };
  }
}

/** How long a renewal at the expiry may take to answer before the stream ends. */
const answerMs = 1000;

const expiredError = (): KeelwerkError =>
  coreError('core.unauthenticated', { message: 'The session expired.' });

/**
 * The session check of one HTTP stream (16.3.4, the rule of `keepSocketSession`): at
 * `nextSessionCheckAt` it runs `session.revalidate()` on the host's timers; a session that holds
 * replaces the one checked next. `end` is called at most once, and the loop stops, when the check
 * answers an error, when it throws (`asKeelwerkError`), or when the renewed session's `expiresAt` is
 * not after the clock's now (`core.unauthenticated`, message 'The session expired.'); a session already expired when the
 * function is called ends at once, and a check still unanswered one second after `expiresAt` (or after its start, when that is later) ends the stream. The first wait is
 * registered before the function returns; aborting `signal` ends every wait.
 */
export function keepStreamSession(input: {
  readonly session: InvocationSession;
  readonly revalidateMs: number;
  readonly clock: Clock;
  readonly timers: LiveTimers;
  readonly signal: AbortSignal;
  readonly end: (error: KeelwerkError) => void;
}): void {
  const { clock, timers, signal } = input;
  // The check of a session with an expiry never outlives that expiry: a resolver that does not answer
  // cannot keep an expired stream open.
  const isExpired = (session: InvocationSession): boolean =>
    session.expiresAt !== undefined &&
    Temporal.Instant.compare(session.expiresAt, clock.now()) <= 0;
  const checked = async (session: InvocationSession): Promise<Outcome<InvocationSession>> => {
    const { expiresAt } = session;
    if (expiresAt === undefined) return await revalidated(session);
    const waiting = new AbortController();
    // The check starts at or after the expiry, so the instant is already past: the renewal gets a
    // bounded time to answer from the later of the two, never an instant that has already gone by.
    const now = clock.now();
    const deadline = (Temporal.Instant.compare(expiresAt, now) > 0 ? expiresAt : now).add({
      milliseconds: answerMs,
    });
    try {
      return await Promise.race([
        revalidated(session),
        timers
          .sleepUntil(deadline, AbortSignal.any([signal, waiting.signal]))
          .then((reached) =>
            reached
              ? { ok: false as const, error: expiredError() }
              : new Promise<Outcome<InvocationSession>>(() => undefined),
          ),
      ]);
    } finally {
      waiting.abort();
    }
  };
  void (async () => {
    let session = input.session;
    while (!signal.aborted) {
      if (isExpired(session)) {
        input.end(expiredError());
        return;
      }
      const at = nextSessionCheckAt(clock.now(), input.revalidateMs, session.expiresAt);
      if (!(await timers.sleepUntil(at, signal))) return;
      const outcome = await checked(session);
      if (signal.aborted) return;
      if (!outcome.ok) {
        input.end(outcome.error);
        return;
      }
      session = outcome.value;
      if (isExpired(session)) {
        input.end(expiredError());
        return;
      }
    }
  })();
}
