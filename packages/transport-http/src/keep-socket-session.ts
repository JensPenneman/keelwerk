import type { InvocationSession, KeelwerkError, Outcome } from '@keelwerk/core';
import { asKeelwerkError, coreError } from '@keelwerk/core/http';
import { answerMs } from './answer-ms.ts';
import { closeAfterRefusal } from './close-after-refusal.ts';
import { holdsSameCredentials } from './holds-same-credentials.ts';
import type { LiveSocketState } from './live-socket-state.ts';
import { nextSessionCheckAt } from './next-session-check-at.ts';

async function revalidated(session: InvocationSession): Promise<Outcome<InvocationSession>> {
  try {
    return await session.revalidate();
  } catch (failure) {
    return { ok: false, error: asKeelwerkError(failure) };
  }
}

/**
 * The socket's own session check (16.3.4, D4): `state.session.revalidate()` every `revalidateMs`, from
 * `answerMs` before `expiresAt` (as a stream's does, so a renewal is answered in time) and when asked.
 * A session that holds, under the credentials the socket opened with, replaces the socket's; one that does not (an error, or other credentials) goes to `refuse` (by default an `error`
 * without an id, then the close with the close code of its kind). At most one check runs; one asked
 * meanwhile runs after it. A session whose next check would fall at or after its `expiresAt` ends at the
 * expiry, by `refuse` with the expiry error. `late()` is true, and ends the socket the same way, when the
 * session's `expiresAt` has passed before a check has ended it. A check that has not answered by the
 * expiry does not hold the socket open, and an answer seen at or after it is dropped. The timer loop hangs on
 * `state.everything`, so it ends with the socket.
 */
export function keepSocketSession(
  state: LiveSocketState,
  refuse?: (error: KeelwerkError) => Promise<void>,
): { check(): Promise<boolean>; late(): boolean } {
  let ending = false;
  let current: Promise<boolean> | undefined;
  // The one ending of the socket's session: a check that refuses and a message that came after the expiry end it alike.
  const end = (error: KeelwerkError): Promise<void> => {
    ending = true;
    return (refuse ?? closeAfterRefusal(state))(error);
  };
  const expired = (): Promise<void> =>
    end(coreError('core.unauthenticated', { message: 'The session expired.' }));
  // The one decision that the socket has expired: the clock against the expiry of the session it holds
  // now, never a value read earlier. Whatever fires (a wait, a race, a late answer, a send) asks it.
  const expireIfLapsed = (): boolean => {
    const { expiresAt } = state.session;
    if (expiresAt === undefined || Temporal.Instant.compare(expiresAt, state.clock.now()) > 0) {
      return false;
    }
    if (!ending) void expired();
    return true;
  };
  // The one place the socket's session is replaced: it wakes every wait of the keeper, so that none
  // outlives the session it was computed from.
  let woken = new AbortController();
  const hold = (session: InvocationSession): void => {
    const was = woken;
    state.session = session;
    woken = new AbortController();
    was.abort();
  };
  let queued: Promise<boolean> | undefined;
  const run = async (): Promise<boolean> => {
    // After the ending the keeper asks nothing and ends nothing again.
    if (ending) return false;
    const outcome = await revalidated(state.session);
    if (ending || state.everything.signal.aborted) return false;
    // An answer seen at or after the expiry of the session the socket holds never continues it.
    if (expireIfLapsed()) return false;
    if (outcome.ok && holdsSameCredentials(state.session, outcome.value)) {
      hold(outcome.value);
      return true;
    }
    // A renewal under other credentials (a logged-out cookie reopens as anonymous) is no renewal: the socket ends with them.
    await end(
      outcome.ok
        ? coreError('core.unauthenticated', {
            message: 'The session no longer holds the credentials the socket opened with.',
          })
        : outcome.error,
    );
    return false;
  };
  const check = (): Promise<boolean> => {
    if (current === undefined) {
      const started: Promise<boolean> = run().finally(() => {
        if (current === started) current = undefined;
      });
      current = started;
      return started;
    }
    queued ??= current.then(() => {
      queued = undefined;
      return check();
    });
    return queued;
  };
  const late = (): boolean => !ending && expireIfLapsed();
  const { signal } = state.everything;
  // Ends the socket at the expiry of the session it holds, whatever a check is doing; a replacement moves the wait.
  const watch = async (over: AbortSignal): Promise<boolean> => {
    while (!over.aborted) {
      const turn = AbortSignal.any([over, woken.signal]);
      const { expiresAt } = state.session;
      if (expiresAt === undefined) {
        if (!turn.aborted) {
          await new Promise<void>((resolve) =>
            turn.addEventListener('abort', () => resolve(), { once: true }),
          );
        }
      } else if ((await state.timers.sleepUntil(expiresAt, turn)) && expireIfLapsed()) {
        return false;
      }
    }
    return false;
  };
  const checked = async (): Promise<boolean> => {
    const stop = new AbortController();
    try {
      return await Promise.race([check(), watch(AbortSignal.any([signal, stop.signal]))]);
    } finally {
      stop.abort();
    }
  };
  void (async () => {
    while (!signal.aborted) {
      // Taken before the session is read: a replacement after this wakes the waits below.
      const turn = AbortSignal.any([signal, woken.signal]);
      const { expiresAt } = state.session;
      const at = nextSessionCheckAt(
        state.clock.now(),
        state.upgrade.host.liveSocket.revalidateMs,
        expiresAt?.subtract({ milliseconds: answerMs }),
      );
      // No check can answer before the expiry (the floor reaches it): wait for the expiry, and go round again if the session was replaced.
      if (expiresAt !== undefined && Temporal.Instant.compare(at, expiresAt) >= 0) {
        if ((await state.timers.sleepUntil(expiresAt, turn)) && expireIfLapsed()) return;
        continue;
      }
      if (!(await state.timers.sleepUntil(at, turn))) continue;
      if (!(await checked())) return;
    }
  })();
  return { check, late };
}
