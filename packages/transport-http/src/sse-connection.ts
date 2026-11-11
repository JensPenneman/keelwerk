import type { CarrierEndReason, WireError } from '@keelwerk/core';
import { sseEventOf } from '@keelwerk/core';
import { coreError } from '@keelwerk/core/http';
import type { OpenSseStream } from './open-sse-stream.ts';
import type { SseConnectionOptions } from './sse-connection-options.ts';

const encoder = new TextEncoder();

function gone(): Error {
  return coreError('core.unavailable', { message: 'The stream is closed.', retryable: false });
}

/**
 * The connection of one server-sent event response: a pull `ReadableStream` over a byte queue.
 * `write` resolves while the queue holds at most `maxBufferedBytes`; a write left above that for
 * `stallMs` closes the connection (the body errors and the socket is destroyed) and aborts its
 * subscription, so a client that does not read holds neither memory, the reader nor the socket. After `close`, `end` or `fail`, `write` rejects `unavailable`. `end`
 * and `fail` write their frame once, whatever the queue holds, and close; a body that is not read to
 * its end within `stallMs` of closing is destroyed the same way. Closing aborts the subscription, so
 * a stream the carrier ended (a maximum duration, an error) never leaves its subscription to the
 * hub. A cancelled body (the client went away) aborts it too. Every wait is on the host's clock.
 */
export function sseConnection(options: SseConnectionOptions): OpenSseStream {
  const queue: Uint8Array[] = [];
  let queued = 0;
  /** No more writes are taken: the stream closes once the queue is drained. */
  let finished = false;
  /** The connection is dead: nothing more is sent. */
  let dead = false;
  let wake: (() => void) | undefined;
  const waiting = new Set<{
    readonly resolve: () => void;
    readonly reject: (error: Error) => void;
    readonly cancel: AbortController;
  }>();
  /** Aborted when the body has closed, so the wait for the client to read the rest ends. */
  let draining: AbortController | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;

  const release = (): void => {
    if (queued > options.maxBufferedBytes) return;
    for (const waiter of [...waiting]) {
      waiting.delete(waiter);
      waiter.cancel.abort();
      waiter.resolve();
    }
  };
  const kill = (stalled = false): void => {
    if (dead) return;
    dead = true;
    finished = true;
    queue.length = 0;
    queued = 0;
    draining?.abort();
    for (const waiter of [...waiting]) {
      waiting.delete(waiter);
      waiter.cancel.abort();
      waiter.reject(gone());
    }
    options.abort.abort();
    wake?.();
    if (stalled) {
      // The body may be waiting for the socket to drain, so no pull will ever see the dead flag.
      try {
        controller?.error(gone());
      } catch {
        // The body is closed already.
      }
      options.destroy?.();
    }
  };
  const push = (text: string): void => {
    const bytes = encoder.encode(text);
    queue.push(bytes);
    queued += bytes.byteLength;
    wake?.();
  };

  const body = new ReadableStream<Uint8Array>(
    {
      start: (opened) => {
        controller = opened;
      },
      pull: async (pulling) => {
        for (;;) {
          const chunk = queue.shift();
          if (chunk !== undefined) {
            queued -= chunk.byteLength;
            pulling.enqueue(chunk);
            release();
            return;
          }
          if (finished) {
            draining?.abort();
            pulling.close();
            return;
          }
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      },
      cancel: () => {
        kill();
      },
    },
    { highWaterMark: 0 },
  );

  const stallsAt = (): Temporal.Instant =>
    options.clock.now().add({ milliseconds: options.stallMs });
  const write = (chunk: string): Promise<void> => {
    if (finished) return Promise.reject(gone());
    push(chunk);
    if (queued <= options.maxBufferedBytes) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const waiter = { resolve, reject, cancel: new AbortController() };
      waiting.add(waiter);
      void options.timers.sleepUntil(stallsAt(), waiter.cancel.signal).then((reached) => {
        if (reached && waiting.has(waiter)) kill(true);
      });
    });
  };
  /** No more writes; the body closes once the queue is drained, and a client that never drains it is cut off after `stallMs`. */
  const finish = (): void => {
    if (!finished) {
      finished = true;
      wake?.();
    }
    options.abort.abort();
    if (dead || draining !== undefined) return;
    const waitFor = new AbortController();
    draining = waitFor;
    void options.timers.sleepUntil(stallsAt(), waitFor.signal).then((reached) => {
      if (reached) kill(true);
    });
  };
  const close = (text: string): Promise<void> => {
    if (finished) return Promise.resolve();
    push(text);
    finish();
    return Promise.resolve();
  };
  const end = (reason: CarrierEndReason): Promise<void> => close(sseEventOf('end', { reason }));
  const fail = (error: WireError): Promise<void> => close(sseEventOf('error', error));

  return {
    connection: {
      kind: 'sse',
      write,
      lastEventId: options.lastEventId,
      signal: options.abort.signal,
      end,
      fail,
    },
    response: new Response(body, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        'x-accel-buffering': 'no',
      },
    }),
    goAway: async () => {
      await end('going_away');
      options.abort.abort();
    },
    finish,
  };
}
