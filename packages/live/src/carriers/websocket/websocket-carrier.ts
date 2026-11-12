import type {
  CarrierConnection,
  CarrierOptions,
  Clock,
  LiveCarrier,
  LiveFrame,
  LiveServerMessage,
  WireError,
} from '@keelwerk/core';
import { errors, liveTimersOf, toWire } from '@keelwerk/core';
import { asKeelwerkError } from '@keelwerk/core/http';
import { websocketMessageOf } from './websocket-message-of.ts';

type Socket = Extract<CarrierConnection, { readonly kind: 'websocket' }>;

const systemClock: Clock = { now: () => Temporal.Now.instant() };

type Step =
  | { readonly kind: 'next'; readonly result: IteratorResult<LiveFrame<unknown>> }
  | { readonly kind: 'failed'; readonly error: unknown }
  | { readonly kind: 'deadline' }
  | { readonly kind: 'aborted' };

function stateOf(frame: LiveFrame<unknown>): string | undefined {
  if ('control' in frame) {
    return frame.control === 'head' || frame.control === 'reset' ? frame.state : undefined;
  }
  return frame.state;
}

function errorOf(error: unknown, options: CarrierOptions): WireError {
  return (
    options.wireError?.(error) ?? { ...toWire(asKeelwerkError(error), 'public'), requestId: '' }
  );
}

function text(message: LiveServerMessage): string {
  return JSON.stringify(message);
}

async function serveSocket(
  stream: AsyncIterable<LiveFrame<unknown>>,
  connection: Socket,
  id: string,
  options: CarrierOptions,
): Promise<void> {
  const clock: Clock = options.clock ?? systemClock;
  const timers = options.timers ?? liveTimersOf(clock);
  const iterator = stream[Symbol.asyncIterator]();
  const everything = new AbortController();
  const gone = new Promise<Step>((resolve) => {
    if (connection.signal.aborted) resolve({ kind: 'aborted' });
    else
      connection.signal.addEventListener('abort', () => resolve({ kind: 'aborted' }), {
        signal: everything.signal,
      });
  });
  const deadline = timers
    .sleepUntil(clock.now().add({ milliseconds: options.maxDurationMs }), everything.signal)
    .then((reached): Step => ({ kind: reached ? 'deadline' : 'aborted' }));
  let lastToken: string | undefined;
  try {
    for (;;) {
      const pending: Promise<Step> = iterator.next().then(
        (result): Step => ({ kind: 'next', result }),
        (error: unknown): Step => ({ kind: 'failed', error }),
      );
      const step = await Promise.race([pending, deadline, gone]);
      if (step.kind === 'aborted') return;
      if (step.kind === 'deadline') {
        await connection.send(text({ type: 'end', id, reason: 'max_duration' }));
        return;
      }
      if (step.kind === 'failed') {
        await connection.send(text({ type: 'error', id, error: errorOf(step.error, options) }));
        return;
      }
      if (step.result.done === true) {
        await connection.send(text({ type: 'end', id, reason: 'complete' }));
        return;
      }
      const frame = step.result.value;
      let message: string;
      try {
        message = websocketMessageOf(id, frame);
      } catch (error) {
        // A frame that cannot be built is the stream's last: an error message of the closed projection.
        await connection.send(text({ type: 'error', id, error: errorOf(error, options) }));
        return;
      }
      if (new TextEncoder().encode(message).byteLength > options.maxBufferedBytes) {
        // One item the connection could never queue: the client catches up from the last token it holds.
        await connection.send(
          text(
            lastToken === undefined
              ? { type: 'reset', id, reason: 'overflow' }
              : { type: 'reset', id, reason: 'overflow', state: lastToken },
          ),
        );
        return;
      }
      await connection.send(message);
      // A reset is the last message of its subscription: the client catches up or asks again.
      if ('control' in frame && frame.control === 'reset') return;
      const state = stateOf(frame);
      if (state !== undefined) lastToken = state;
    }
  } catch {
    // The connection refused a send: the client is gone, a stalled socket was cut, or the host is stopping.
  } finally {
    everything.abort();
    await iterator.return?.().catch(() => undefined);
  }
}

/**
 * The WebSocket carrier of `keelwerk.live.v1` (15.4.7, 15.4.11): it frames one subscription onto a
 * socket the host shares among its subscriptions, every message under the subscription's id
 * (`CarrierOptions.subscriptionId`). Each frame is one awaited `send`, so a socket that does not read
 * stalls this loop and never the hub. A `reset` is the last message and no `end` follows it; a
 * finished stream ends `complete`, a failed one sends `error` under its id, an item above
 * `maxBufferedBytes` ends with `reset` `overflow` and the last token held, and the deadline on the
 * options' clock ends it `max_duration`. A carrier sends no `welcome` or ping and never closes the
 * socket: the connection-level duties belong to the host, and the carrier owns nothing of the hub.
 *
 * Trap for the host that wraps the stream: when the carrier ends, it awaits `iterator.return()` while
 * its own `next()` may still be pending (a source waiting for the next change). An async generator
 * queues `return()` behind that `next()`, so it settles only when the source yields or ends, and the
 * carrier's promise stays pending with it. The stream the host hands over must therefore abort its
 * source first, in its own `return()`, before it calls the source's `return()`; the host's
 * subscription does (`startSocketSubscription`), and every transport that builds on this carrier must.
 */
export const websocketCarrier: LiveCarrier = {
  name: 'websocket',
  serve: (stream, connection, options) => {
    if (connection.kind !== 'websocket' || options.subscriptionId === undefined) {
      return Promise.reject(
        errors.internal(
          'The websocket carrier serves websocket connections and needs a subscription id.',
        ),
      );
    }
    return serveSocket(stream, connection, options.subscriptionId, options);
  },
};
