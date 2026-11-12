import { liveTimersOf, unknownClientAddress } from '@keelwerk/core';
import { asKeelwerkError, coreError } from '@keelwerk/core/http';
import { errorResponse } from './error-response.ts';
import type { LiveSocketState } from './live-socket-state.ts';
import type { OpenLiveSocket } from './open-live-socket.ts';
import { serveLiveSocket } from './serve-live-socket.ts';
import type { UpgradeEntry } from './upgrade-entry.ts';
import { websocketConnection } from './websocket-connection.ts';

/**
 * The `keelwerk.live.v1` entry of the upgrade table: after the session, the origin check and the
 * ticket check. The app has a websocket carrier (else `core.not_found`); the socket takes one stream
 * slot of the principal, the tenant and the process (429 before the handshake is accepted); the
 * handshake is accepted; the socket's connection is made and kept in `host.sockets` for `stop`; the
 * socket's life runs. A refused handshake gives the slot back. A cookie or `Authorization` of the
 * upgrade, or the token of the hello, are the credentials; a stream ticket is not one.
 */
export const liveSocketEndpoint: UpgradeEntry['serve'] = async (call, upgrade) => {
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
  try {
    release = host.limits.take(session, carrier.connection?.remote.address ?? unknownClientAddress);
  } catch (failure) {
    return errorResponse(host, state, asKeelwerkError(failure));
  }
  const clock = host.deps.clock ?? { now: () => Temporal.Now.instant() };
  const timers = host.deps.timers ?? liveTimersOf(clock);
  const bounds = host.liveSocket;
  let open: OpenLiveSocket | undefined;
  let accepted = false;
  try {
    accepted = await upgrade.accept('keelwerk.live.v1', (socket) => {
      open = websocketConnection(socket, {
        maxBufferedBytes: host.live.maxBufferedBytes,
        stallMs: host.live.stallMs,
        pongTimeoutMs: bounds.pongTimeoutMs,
        maxMessageBytes: bounds.maxMessageBytes,
        maxMessagesPerWindow: bounds.maxMessagesPerWindow,
        messageWindowMs: bounds.messageWindowMs,
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
  const socket = open;
  const log = host.deps.log.child({ connectionId: carrier.connection?.id ?? state.requestId });
  const socketState: LiveSocketState = {
    upgrade: call,
    open: socket,
    carrier: live,
    session,
    socketCarrier: carrier,
    release,
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
  void serveLiveSocket(socketState)
    .catch((failure: unknown) => {
      log.error('a live socket failed', { code: asKeelwerkError(failure).code });
    })
    .finally(() => {
      host.sockets.delete(socket);
    });
  return null;
};
