import { asKeelwerkError } from '@keelwerk/core/http';
import type { LiveSocketState } from './live-socket-state.ts';
import { socketSessionOf } from './socket-session-of.ts';
import { upgradeHttpContext } from './upgrade-http-context.ts';
import type { UpgradeRegistration } from './upgrade-registration.ts';
import { webSocketOf } from './web-socket-of.ts';

/**
 * The life of a transport's socket (16.3.3): the first message must come within `helloTimeoutMs`
 * (else the socket closes with the protocol's own code and reason); at the deadline every subscription
 * is aborted and the socket closes 1000 `max_duration`; the handler's `open` gets the web socket, the
 * upgrade's context and the host's `SocketSession` (whose `open` meets the registration's app and
 * `refuse` again for the session it opens). However it ends, every subscription is aborted
 * and awaited, the slot and every wait are released, and one line records the protocol, the
 * subscriptions started and the close code. A throw of the handler closes the socket 1011.
 */
export async function serveRegisteredSocket(
  state: LiveSocketState,
  registered: UpgradeRegistration,
  protocol: string,
  firstMessage: { readonly code: number; readonly reason: string },
): Promise<void> {
  const { open, timers, clock } = state;
  const { host, request } = state.upgrade;
  const firstMessageSeen = new AbortController();
  const totals = { subscriptions: 0 };
  try {
    void timers
      .sleepUntil(
        clock.now().add({ milliseconds: host.liveSocket.helloTimeoutMs }),
        firstMessageSeen.signal,
      )
      .then((reached) => {
        if (reached) open.closeWith(firstMessage.code, firstMessage.reason);
      });
    void timers.sleepUntil(state.deadline, state.everything.signal).then((reached) => {
      if (!reached) return;
      for (const entry of state.subscriptions.values()) entry.abort.abort();
      open.closeWith(1000, 'max_duration');
    });
    const session = socketSessionOf(state, registered, () => {
      state.first.seen = true;
      firstMessageSeen.abort();
    });
    registered.handler.open(
      webSocketOf(open, protocol, request.url),
      upgradeHttpContext(state.upgrade, open.connection.signal),
      {
        ...session,
        subscription(id) {
          const slot = session.subscription(id);
          totals.subscriptions += 1;
          return slot;
        },
      },
    );
    await open.closed;
  } catch (failure) {
    state.log.error('socket failed', { code: asKeelwerkError(failure).code });
    open.closeWith(1011, 'internal_error');
  } finally {
    firstMessageSeen.abort();
    for (const entry of state.subscriptions.values()) entry.abort.abort();
    await Promise.all([...state.subscriptions.values()].map((entry) => entry.done));
    state.release();
    state.everything.abort();
    await open.closed;
    state.log.info('socket closed', {
      protocol,
      subscriptions: totals.subscriptions,
      code: open.closeCode() ?? 1006,
    });
  }
}
