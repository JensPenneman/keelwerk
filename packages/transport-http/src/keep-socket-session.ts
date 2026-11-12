import type { InvocationSession, Outcome } from '@keelwerk/core';
import { endReasonOfError } from '@keelwerk/core';
import { asKeelwerkError, closeCodeOfError } from '@keelwerk/core/http';
import type { LiveSocketState } from './live-socket-state.ts';
import { sendLiveMessage } from './send-live-message.ts';
import { socketWireError } from './socket-wire-error.ts';

/** A check never comes sooner than this after the last one, so a session whose expiry is past cannot spin. */
const floorMs = 1000;

async function revalidated(session: InvocationSession): Promise<Outcome<InvocationSession>> {
  try {
    return await session.revalidate();
  } catch (failure) {
    return { ok: false, error: asKeelwerkError(failure) };
  }
}

/**
 * The socket's own session check (16.3.4, D4): `state.session.revalidate()` every `revalidateMs`, at
 * `expiresAt` and when asked. A session that holds replaces the socket's; one that does not sends an
 * `error` without an id and closes the socket with the close code of its kind. At most one check runs;
 * one asked meanwhile runs after it. The timer loop hangs on `state.everything`, so it ends with the socket.
 */
export function keepSocketSession(state: LiveSocketState): { check(): Promise<boolean> } {
  let current: Promise<boolean> | undefined;
  let queued: Promise<boolean> | undefined;
  const run = async (): Promise<boolean> => {
    const outcome = await revalidated(state.session);
    if (state.everything.signal.aborted) return false;
    if (outcome.ok) {
      state.session = outcome.value;
      return true;
    }
    const { error } = outcome;
    if (endReasonOfError(error) === 'version_retired') {
      // The floor passed the socket's version: every subscription ends as a finished one, then the socket closes (15.4.6).
      for (const [id, entry] of state.subscriptions) {
        await sendLiveMessage(state, { type: 'end', id, reason: 'version_retired' });
        entry.abort.abort();
      }
      state.open.closeWith(1000, 'version_retired');
      return false;
    }
    await sendLiveMessage(state, { type: 'error', error: socketWireError(state, error) });
    state.open.closeWith(closeCodeOfError(error.kind), error.code);
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
  void (async () => {
    const { signal } = state.everything;
    while (!signal.aborted) {
      const now = state.clock.now();
      const periodic = now.add({ milliseconds: state.upgrade.host.liveSocket.revalidateMs });
      const { expiresAt } = state.session;
      const wanted =
        expiresAt !== undefined && Temporal.Instant.compare(expiresAt, periodic) < 0
          ? expiresAt
          : periodic;
      const floor = now.add({ milliseconds: floorMs });
      const at = Temporal.Instant.compare(wanted, floor) < 0 ? floor : wanted;
      if (!(await state.timers.sleepUntil(at, signal))) return;
      if (!(await check())) return;
    }
  })();
  return { check };
}
