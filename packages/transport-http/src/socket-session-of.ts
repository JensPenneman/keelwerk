import type { KeelwerkError, SocketSession } from '@keelwerk/core';
import { endReasonOfError } from '@keelwerk/core';
import { closeCodeOfError, coreError } from '@keelwerk/core/http';
import { keepSocketAlive } from './keep-socket-alive.ts';
import { keepSocketSession } from './keep-socket-session.ts';
import type { LiveSocketState } from './live-socket-state.ts';
import { openSocketSession } from './open-socket-session.ts';
import { takeSocketSubscription } from './take-socket-subscription.ts';
import { upgradeHttpContext } from './upgrade-http-context.ts';
import type { UpgradeRegistration } from './upgrade-registration.ts';

/** What the socket does when its session no longer holds: a retired version ends every subscription, then 1000; else the close code of the error's kind. */
function closeOnRefusal(state: LiveSocketState): (error: KeelwerkError) => Promise<void> {
  return async (error) => {
    if (endReasonOfError(error) === 'version_retired') {
      for (const entry of state.subscriptions.values()) entry.abort.abort();
      state.open.closeWith(1000, 'version_retired');
      return;
    }
    state.open.closeWith(closeCodeOfError(error.kind), error.code);
  };
}

/**
 * Whether the session a first message opened may use the registration: it belongs to the registered
 * app and passes the handler's own `refuse` for that session (a backend that turned the transport off
 * stays off for a session that moved there), the same two checks the upgrade met.
 */
function registrationRefusal(
  state: LiveSocketState,
  registered: UpgradeRegistration,
  signal: AbortSignal,
): KeelwerkError | undefined {
  if (state.session.app !== registered.app) {
    return coreError('core.not_found', { message: 'There is no such endpoint.' });
  }
  return registered.handler.refuse?.({
    ...upgradeHttpContext(state.upgrade, signal),
    session: state.session,
    carrier: state.socketCarrier,
  });
}

/**
 * The host's side of a transport's socket as `SocketSession`: the first message's credentials go
 * through `openSocketSession` (the origin rule and the slot as `keelwerk.live.v1`'s hello has them)
 * and then meet the registration's app and `refuse` again for the session they opened,
 * start the session check and the ping loop, and end the first-message wait (`opened`); each
 * subscription takes its slot through `takeSocketSubscription` and is kept in `state.subscriptions`,
 * where aborting it (socket end, version retired) gives the slot back; each call takes one of the
 * host's `maxPendingInvokes` slots on `state.pendingInvokes`.
 */
export function socketSessionOf(
  state: LiveSocketState,
  registered: UpgradeRegistration,
  opened: () => void,
): SocketSession {
  let started = false;
  let ready = false;
  const signal = AbortSignal.any([state.everything.signal, state.open.connection.signal]);
  return {
    session: () => state.session,
    carrier: () => state.socketCarrier,
    maxMessageBytes: state.upgrade.host.liveSocket.maxMessageBytes,
    async open(credentials) {
      if (started) throw new TypeError('The socket was opened already.');
      started = true;
      opened();
      const outcome = await openSocketSession(state, { type: 'hello', ...credentials });
      if (!outcome.ok) {
        state.open.closeWith(closeCodeOfError(outcome.error.kind), outcome.error.code);
        return outcome;
      }
      const refusal = registrationRefusal(state, registered, signal);
      if (refusal !== undefined) {
        state.open.closeWith(closeCodeOfError(refusal.kind), refusal.code);
        return { ok: false, error: refusal };
      }
      state.keeper = keepSocketSession(state, closeOnRefusal(state));
      keepSocketAlive(state);
      ready = true;
      return { ok: true, value: state.session };
    },
    subscription(id) {
      if (!ready) throw new TypeError('Open the socket before a subscription.');
      const give = takeSocketSubscription(state, id);
      const abort = new AbortController();
      let finish: () => void = () => undefined;
      const done = new Promise<void>((resolve) => {
        finish = resolve;
      });
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        signal.removeEventListener('abort', release);
        abort.signal.removeEventListener('abort', release);
        give();
        abort.abort();
        if (state.subscriptions.get(id)?.abort === abort) state.subscriptions.delete(id);
        finish();
      };
      state.subscriptions.set(id, { abort, done });
      signal.addEventListener('abort', release, { once: true });
      abort.signal.addEventListener('abort', release, { once: true });
      return { signal: abort.signal, release };
    },
    invocation() {
      if (!ready) throw new TypeError('Open the socket before a call.');
      if (state.pendingInvokes >= state.upgrade.host.liveSocket.maxPendingInvokes) {
        throw coreError('core.quota_exceeded', {
          message: 'Too many calls are running on this socket.',
        });
      }
      state.pendingInvokes += 1;
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          state.pendingInvokes -= 1;
        },
      };
    },
    check: () => state.keeper?.check() ?? Promise.resolve(true),
    signal,
  };
}
