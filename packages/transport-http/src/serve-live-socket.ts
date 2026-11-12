import {
  type ApiSurface,
  deprecationsOf,
  type InvocationSession,
  type LiveClientMessage,
  renderTypeId,
  utcDayOf,
} from '@keelwerk/core';
import { asKeelwerkError, closeCodeOfError, coreError } from '@keelwerk/core/http';
import { invokeOverSocket } from './invoke-over-socket.ts';
import { keepSocketSession } from './keep-socket-session.ts';
import type { LiveSocketState } from './live-socket-state.ts';
import { openSocketSession } from './open-socket-session.ts';
import { parseLiveClientMessage } from './parse-live-client-message.ts';
import { sendLiveMessage } from './send-live-message.ts';
import { servedSurfaceOf } from './served-surface-of.ts';
import { socketWireError } from './socket-wire-error.ts';
import { startSocketSubscription } from './start-socket-subscription.ts';
import { traceContext } from './trace-context.ts';

/** The protocol version the `welcome` message announces (15.4.7). */
const protocolVersion = 1;

/** The principal as the welcome names it: a user's subject as a TypeID of its entity, a service's or operator's id, else none. */
function principalOf(
  session: InvocationSession,
  surface: ApiSurface,
): { readonly kind: string; readonly id: string | null } {
  const { principal } = session;
  if (principal.kind === 'service' || principal.kind === 'operator') {
    return { kind: principal.kind, id: principal.id };
  }
  if (principal.kind === 'user' && principal.subjectRef !== null) {
    const entity = surface.entities.find((candidate) => candidate.ref === principal.subjectRef);
    if (entity !== undefined) {
      try {
        return { kind: 'user', id: renderTypeId(entity.prefix, principal.subject) };
      } catch {
        // A subject that is not a UUID has no TypeID form.
      }
    }
  }
  return { kind: principal.kind, id: null };
}

/** Starts the ping loop: a ping every `heartbeatMs`, and a socket that does not answer within the pong bound is terminated. */
function keepAlive(state: LiveSocketState): void {
  const { signal } = state.everything;
  const every = state.upgrade.host.liveSocket.heartbeatMs;
  void (async () => {
    while (await state.timers.sleepUntil(state.clock.now().add({ milliseconds: every }), signal)) {
      if (!(await state.open.connection.ping())) {
        state.open.terminate();
        return;
      }
    }
  })();
}

/** After the deadline every subscription has ended `max_duration` (their carriers share it), and the socket closes. */
function closeAtDeadline(state: LiveSocketState): void {
  void state.timers.sleepUntil(state.deadline, state.everything.signal).then(async (reached) => {
    if (!reached) return;
    await Promise.all([...state.subscriptions.values()].map((entry) => entry.done));
    state.open.closeWith(1000, 'max_duration');
  });
}

/** The queued invokes of a socket may hold this many `maxMessageBytes` of text, however few they are. */
const invokeBytesFactor = 4;

/**
 * Invokes of one socket run one after the other in arrival order (15.4.8). More than `maxPendingInvokes`
 * waiting, or more than four times `maxMessageBytes` of queued text, are answered unrun: what a socket
 * holds for its queue is bounded in bytes as well as in count (`bytes` is the size of the message's text).
 */
function queueInvoke(
  state: LiveSocketState,
  queue: { tail: Promise<void> },
  message: Extract<LiveClientMessage, { type: 'invoke' }>,
  bytes: number,
): void {
  const { id } = message;
  const { liveSocket } = state.upgrade.host;
  if (
    state.pendingInvokes >= liveSocket.maxPendingInvokes ||
    state.pendingInvokeBytes + bytes > invokeBytesFactor * liveSocket.maxMessageBytes
  ) {
    const error = coreError('core.quota_exceeded', {
      message: 'Too many invokes are waiting on this socket.',
    });
    void sendLiveMessage(state, {
      type: 'result',
      id,
      response: { ok: false, error: socketWireError(state, error) },
    });
    return;
  }
  state.pendingInvokes += 1;
  state.pendingInvokeBytes += bytes;
  queue.tail = queue.tail
    .then(async () => {
      // A socket that ended, or a session it closed for, runs nothing more; the client retries with the same command id.
      if (state.everything.signal.aborted || state.open.connection.signal.aborted) return;
      const text = await invokeOverSocket(state, id, message.request);
      await state.open.connection.send(text);
    })
    .catch(() => undefined)
    .finally(() => {
      state.pendingInvokes -= 1;
      state.pendingInvokeBytes -= bytes;
    });
}

async function welcome(state: LiveSocketState): Promise<boolean> {
  const surface = servedSurfaceOf({ ...state.upgrade, session: state.session });
  if (surface === undefined) {
    const error = coreError('core.not_found', { message: 'There is no such app.' });
    await sendLiveMessage(state, { type: 'error', error: socketWireError(state, error) });
    state.open.closeWith(closeCodeOfError(error.kind), error.code);
    return false;
  }
  const { session } = state;
  await sendLiveMessage(state, {
    type: 'welcome',
    principal: principalOf(session, surface),
    heartbeatMs: state.upgrade.host.liveSocket.heartbeatMs,
    apiVersion: session.apiVersion,
    surfaceHash: surface.hash,
    protocol: protocolVersion,
  });
  for (const notice of deprecationsOf(session, undefined, utcDayOf(state.clock.now()))) {
    await sendLiveMessage(state, { type: 'notice', notice });
  }
  return true;
}

async function messages(state: LiveSocketState, totals: { subscriptions: number }): Promise<void> {
  const { open } = state;
  const queue = { tail: Promise.resolve() };
  const helloAbort = new AbortController();
  void state.timers
    .sleepUntil(
      state.clock.now().add({ milliseconds: state.upgrade.host.liveSocket.helloTimeoutMs }),
      helloAbort.signal,
    )
    .then((reached) => {
      if (reached) open.closeWith(4000, 'hello_timeout');
    });
  let helloSeen = false;
  try {
    for await (const text of open.connection.receive()) {
      const message = parseLiveClientMessage(text);
      if (message === null || (!helloSeen && message.type !== 'hello')) {
        open.closeWith(4000, 'protocol_error');
        return;
      }
      if (message.type === 'refused') {
        const wire = socketWireError(state, message.error);
        await sendLiveMessage(
          state,
          message.answer === 'result' && message.id !== undefined
            ? { type: 'result', id: message.id, response: { ok: false, error: wire } }
            : { type: 'error', ...(message.id !== undefined && { id: message.id }), error: wire },
        );
        continue;
      }
      switch (message.type) {
        case 'hello': {
          if (helloSeen) {
            open.closeWith(4000, 'protocol_error');
            return;
          }
          helloSeen = true;
          helloAbort.abort();
          const opened = await openSocketSession(state, message);
          if (!opened.ok) {
            await sendLiveMessage(state, {
              type: 'error',
              error: socketWireError(state, opened.error),
            });
            open.closeWith(closeCodeOfError(opened.error.kind), opened.error.code);
            return;
          }
          const traceparent = traceContext(message.traceparent ?? null);
          if (traceparent !== undefined) state.traceparent = traceparent;
          if (!(await welcome(state))) return;
          state.keeper = keepSocketSession(state);
          keepAlive(state);
          break;
        }
        case 'subscribe':
          totals.subscriptions += 1;
          startSocketSubscription(state, message);
          break;
        case 'unsubscribe':
          state.subscriptions.get(message.id)?.abort.abort();
          break;
        case 'invoke':
          queueInvoke(state, queue, message, Buffer.byteLength(text));
          break;
        case 'ping':
          await sendLiveMessage(state, { type: 'pong' });
          break;
      }
    }
  } finally {
    helloAbort.abort();
  }
}

/**
 * The life of one `keelwerk.live.v1` socket (15.4.7): a hello within `helloTimeoutMs`; the welcome
 * (the principal's id, the API version, the surface hash, protocol 1) and a deprecation notice; then
 * subscribe, unsubscribe (the subscription ends `end complete`), invoke, ping answered with pong, a
 * second hello closes 4000; a ping every `heartbeatMs` and a socket without a pong is terminated; at
 * the deadline every subscription ends `max_duration` and the socket closes 1000. However it ends,
 * every subscription is aborted and awaited, the slot is released, every wait is released, and one
 * line records the connection id, the subscriptions started and the close code. An unexpected throw
 * closes the socket 1011 and logs its code only.
 */
export async function serveLiveSocket(state: LiveSocketState): Promise<void> {
  const totals = { subscriptions: 0 };
  try {
    closeAtDeadline(state);
    await messages(state, totals);
  } catch (failure) {
    state.log.error('live socket failed', { code: asKeelwerkError(failure).code });
    state.open.closeWith(1011, 'internal_error');
  } finally {
    for (const entry of state.subscriptions.values()) entry.abort.abort();
    await Promise.all([...state.subscriptions.values()].map((entry) => entry.done));
    state.release();
    state.everything.abort();
    await state.open.closed;
    state.log.info('live socket closed', {
      subscriptions: totals.subscriptions,
      code: state.open.closeCode() ?? 1006,
    });
  }
}
