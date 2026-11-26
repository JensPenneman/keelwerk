import type { InvocationSession } from '@keelwerk/core';
import { coreError } from '@keelwerk/core/http';
import type { LiveSocketState } from './live-socket-state.ts';

/** `answer`, or `undefined` as soon as `signal` aborts; the listener it adds is gone when it returns. */
async function unlessAborted<T>(
  answer: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T | undefined> {
  if (signal === undefined) return answer;
  const aborted = Promise.withResolvers<undefined>();
  const abort = (): void => aborted.resolve(undefined);
  if (signal.aborted) abort();
  signal.addEventListener('abort', abort, { once: true });
  try {
    return await Promise.race([answer, aborted.promise]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

/**
 * The session of a `keelwerk.live.v1` socket for a call or a subscription that starts now: the
 * socket's session check runs first, as `POST /invoke` opens a session per request, and a session
 * that no longer holds is refused `core.unavailable` (the check has closed the socket then). The one
 * way a path that starts work reads the session the socket holds. With `signal`, a wait for a check
 * that does not answer ends when it aborts (the subscription is ended, or the socket closes): the
 * answer is then `undefined` and nothing of the wait is left.
 */
export async function checkedSocketSession(state: LiveSocketState): Promise<InvocationSession>;
export async function checkedSocketSession(
  state: LiveSocketState,
  signal: AbortSignal,
): Promise<InvocationSession | undefined>;
export async function checkedSocketSession(
  state: LiveSocketState,
  signal?: AbortSignal,
): Promise<InvocationSession | undefined> {
  if (state.keeper !== undefined) {
    const held = await unlessAborted(state.keeper.check(), signal);
    if (held === undefined) return undefined;
    if (!held) throw coreError('core.unavailable', { message: 'The session is no longer valid.' });
  }
  return state.session;
}
