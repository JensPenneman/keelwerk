import {
  type LiveClientMessage,
  type LiveFrame,
  type StateToken,
  unknownClientAddress,
} from '@keelwerk/core';
import { asKeelwerkError, coreError, decodeActionInput, encodeFrames } from '@keelwerk/core/http';
import type { LiveSocketState } from './live-socket-state.ts';
import { sendLiveMessage } from './send-live-message.ts';
import { servedSurfaceOf } from './served-surface-of.ts';
import { socketWireError } from './socket-wire-error.ts';

async function run(
  state: LiveSocketState,
  message: Extract<LiveClientMessage, { type: 'subscribe' }>,
  abort: AbortController,
): Promise<void> {
  const { id } = message;
  const { upgrade: call } = state;
  const { host } = call;
  try {
    const surface = servedSurfaceOf({ ...call, session: state.session });
    const action = surface?.actions.find((candidate) => candidate.ref === message.action);
    if (surface === undefined || action === undefined) {
      throw coreError('core.not_found', { message: 'There is no such subscription.' });
    }
    if (action.kind !== 'subscription') {
      throw coreError('core.unsupported', { message: 'This action is not a subscription.' });
    }
    const input = decodeActionInput(surface, action, message.input);
    const remaining = state.deadline.epochMilliseconds - state.clock.now().epochMilliseconds;
    const encoded = encodeFrames(
      host.deps.invoker.subscribe<unknown, unknown>(
        {
          action: action.ref,
          input,
          carrier: state.socketCarrier,
          session: state.session,
          requestId: call.state.requestId,
          ...(state.traceparent !== undefined && { traceparent: state.traceparent }),
          signal: abort.signal,
        },
        message.after === undefined ? undefined : { after: message.after as StateToken },
      ),
      action,
    );
    // However the carrier ends the stream (a deadline, an error, a refused send), the subscription is
    // aborted first, so the hub's iterator is free to return.
    const frames: AsyncIterable<LiveFrame<unknown>> = {
      [Symbol.asyncIterator]: () => {
        const iterator = encoded[Symbol.asyncIterator]();
        return {
          next: () => iterator.next(),
          return: async () => {
            abort.abort();
            return (await iterator.return?.(undefined)) ?? { done: true, value: undefined };
          },
        };
      },
    };
    await state.carrier.serve(frames, state.open.connection, {
      heartbeatMs: host.liveSocket.heartbeatMs,
      maxBufferedItems: 1000,
      maxBufferedBytes: host.live.maxBufferedBytes,
      maxDurationMs: Math.max(0, remaining),
      clock: state.clock,
      timers: state.timers,
      subscriptionId: id,
      wireError: (error) => {
        const failure = asKeelwerkError(error);
        if (failure.kind === 'internal') state.log.error('stream failed', { code: failure.code });
        if (failure.kind === 'unauthenticated') void state.keeper?.check();
        return socketWireError(state, failure);
      },
    });
  } catch (failure) {
    const error = asKeelwerkError(failure);
    if (error.kind === 'internal') state.log.error('stream failed', { code: error.code });
    if (error.kind === 'unauthenticated') void state.keeper?.check();
    await sendLiveMessage(state, { type: 'error', id, error: socketWireError(state, error) });
  }
}

/**
 * One `subscribe` message (15.4.7): over `maxSubscriptionsPerSocket`, or an id that is open already,
 * is an error under the id (`core.quota_exceeded`, `core.malformed_request`). Then as the subscribe
 * endpoint does: the surface of the session's version, a subscription of it (`core.not_found`,
 * `core.unsupported`), the input decoded like any input, the invoker subscribes with the session the
 * hello opened (it translates each item once for this version), the frames are wire encoded, and the
 * websocket carrier serves them under the id. A failure of kind unauthenticated asks the socket's
 * session check to run now. When the carrier returns the entry is deleted and the subscription aborted.
 */
export function startSocketSubscription(
  state: LiveSocketState,
  message: Extract<LiveClientMessage, { type: 'subscribe' }>,
): void {
  const { id } = message;
  const refused = state.subscriptions.has(id)
    ? coreError('core.malformed_request', {
        issues: [{ path: ['id'], message: 'This id is open on this socket.' }],
      })
    : state.subscriptions.size >= state.upgrade.host.liveSocket.maxSubscriptionsPerSocket
      ? coreError('core.quota_exceeded', {
          message: 'Too many subscriptions are open on this socket.',
        })
      : null;
  if (refused !== null) {
    void sendLiveMessage(state, { type: 'error', id, error: socketWireError(state, refused) });
    return;
  }
  let release: () => void;
  try {
    release = state.upgrade.host.limits.takeSubscription(
      state.session,
      state.upgrade.carrier.connection?.remote.address ?? unknownClientAddress,
    );
  } catch (failure) {
    void sendLiveMessage(state, {
      type: 'error',
      id,
      error: socketWireError(state, asKeelwerkError(failure)),
    });
    return;
  }
  const abort = new AbortController();
  const done = run(state, message, abort).finally(() => {
    release();
    abort.abort();
    if (state.subscriptions.get(id)?.abort === abort) state.subscriptions.delete(id);
  });
  state.subscriptions.set(id, { abort, done });
}
