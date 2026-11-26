import { type KeelwerkError, liveTimersOf, unknownClientAddress } from '@keelwerk/core';
import { asKeelwerkError, coreError } from '@keelwerk/core/http';
import type { EndpointCall } from './endpoint-call.ts';
import { errorResponse } from './error-response.ts';
import type { LiveSocketState } from './live-socket-state.ts';
import type { OpenLiveSocket } from './open-live-socket.ts';
import type { PendingUpgrade } from './pending-upgrade.ts';
import { takeStreamSlot } from './take-stream-slot.ts';
import { websocketConnection } from './websocket-connection.ts';

/**
 * The part of a socket's upgrade that every WebSocket protocol of the host shares, after the session,
 * the origin and the ticket checks: the app has a websocket carrier (else `core.not_found`); the socket
 * takes one stream slot of the principal, the tenant and the process and one of the tenant's
 * `core.liveConnections` across the deployment (429 before the handshake is accepted), or, when its
 * session is anonymous, a place among the sockets that have not said who they are (when the process's
 * count of them is full, the oldest is ended by `evicted` with `core.quota_exceeded`); the
 * handshake is accepted with `protocol`; the socket's connection is made and kept in `host.sockets`
 * for `stop`. A refused handshake gives the slot back. Answers the state of the socket's life, or
 * the refusal.
 */
export async function acceptLiveSocket(
  call: EndpointCall,
  upgrade: PendingUpgrade,
  protocol: string,
  evicted: (state: LiveSocketState, error: KeelwerkError) => void,
): Promise<LiveSocketState | Response> {
  const { host, state, session, carrier } = call;
  const live = host.deps.liveCarrier?.(session.app, 'websocket');
  if (live === undefined) {
    return errorResponse(
      host,
      state,
      coreError('core.not_found', { message: 'There is no such endpoint.' }),
    );
  }
  let release: () => void;
  let socketState: LiveSocketState | undefined;
  const first = { seen: false };
  try {
    const address = carrier.connection?.remote.address ?? unknownClientAddress;
    // An anonymous upgrade may be a client that brings its credentials in its first message: until that
    // message it counts against its address only, and takes its real slot there (`openSocketSession`).
    release =
      session.principal.kind === 'anonymous'
        ? host.limits.takePending(session, address, () => {
            // A socket whose handshake is not done, or that has sent its first message, is not ended.
            if (socketState === undefined || first.seen) return false;
            evicted(
              socketState,
              coreError('core.quota_exceeded', { message: 'Too many streams are open.' }),
            );
            return true;
          })
        : await takeStreamSlot(host, session, address);
  } catch (failure) {
    return errorResponse(host, state, asKeelwerkError(failure));
  }
  const clock = host.deps.clock ?? { now: () => Temporal.Now.instant() };
  const timers = host.deps.timers ?? liveTimersOf(clock);
  const bounds = host.liveSocket;
  let open: OpenLiveSocket | undefined;
  let accepted = false;
  try {
    accepted = await upgrade.accept(protocol, (socket) => {
      open = websocketConnection(socket, {
        maxBufferedBytes: host.live.maxBufferedBytes,
        stallMs: host.live.stallMs,
        pongTimeoutMs: bounds.pongTimeoutMs,
        maxMessageBytes: bounds.maxMessageBytes,
        maxMessagesPerWindow: bounds.maxMessagesPerWindow,
        messageWindowMs: bounds.messageWindowMs,
        late: () => socketState?.keeper?.late() ?? false,
        clock,
        timers,
      });
      host.sockets.add(open);
    });
  } catch (failure) {
    release();
    throw failure;
  }
  if (!accepted || open === undefined) {
    release();
    return errorResponse(
      host,
      state,
      coreError('core.malformed_request', { message: 'The WebSocket handshake was refused.' }),
    );
  }
  const log = host.deps.log.child({ connectionId: carrier.connection?.id ?? state.requestId });
  socketState = {
    upgrade: call,
    open,
    carrier: live,
    session,
    socketCarrier: carrier,
    release,
    first,
    subscriptions: new Map(),
    noticedActions: new Set(),
    pendingInvokes: 0,
    pendingInvokeBytes: 0,
    everything: new AbortController(),
    clock,
    timers,
    deadline: clock.now().add({ milliseconds: host.live.maxDurationMs }),
    log,
  };
  return socketState;
}
