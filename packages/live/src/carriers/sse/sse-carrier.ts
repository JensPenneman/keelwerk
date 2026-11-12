import type {
  CarrierConnection,
  CarrierEndReason,
  CarrierOptions,
  Clock,
  LiveCarrier,
  LiveFrame,
  LiveTimers,
  WireError,
} from '@keelwerk/core';
import { endReasonOfError, errors, liveTimersOf, sseEventOf, toWire } from '@keelwerk/core';
import { asKeelwerkError } from '@keelwerk/core/http';
import { sseFrameOf } from './sse-frame-of.ts';

type Sse = Extract<CarrierConnection, { readonly kind: 'sse' }>;

/** The delay an `EventSource` waits before it reconnects (15.4.6). */
const retryMs = 3000;

const systemClock: Clock = { now: () => Temporal.Now.instant() };

type Step<T> =
  | { readonly kind: 'next'; readonly result: IteratorResult<T> }
  | { readonly kind: 'failed'; readonly error: unknown }
  | { readonly kind: 'idle' }
  | { readonly kind: 'deadline' }
  | { readonly kind: 'aborted' };

function stateOf(frame: LiveFrame<unknown>): string | null | undefined {
  if ('control' in frame) {
    if (frame.control === 'head') return frame.state;
    return frame.control === 'reset' ? (frame.state ?? null) : undefined;
  }
  return frame.state;
}

function errorFrame(error: unknown, options: CarrierOptions): WireError {
  return (
    options.wireError?.(error) ?? { ...toWire(asKeelwerkError(error), 'public'), requestId: '' }
  );
}

/** A wait as a step: it is the step when the clock reached the instant, and `aborted` when it was cancelled. */
function waitStep(
  timers: LiveTimers,
  at: Temporal.Instant,
  signal: AbortSignal,
  kind: 'idle' | 'deadline',
): Promise<Step<never>> {
  return timers
    .sleepUntil(at, signal)
    .then((reached): Step<never> => ({ kind: reached ? kind : 'aborted' }));
}

async function serveSse(
  stream: AsyncIterable<LiveFrame<unknown>>,
  connection: Sse,
  options: CarrierOptions,
): Promise<void> {
  const clock: Clock = options.clock ?? systemClock;
  const timers = options.timers ?? liveTimersOf(clock);
  const iterator = stream[Symbol.asyncIterator]();
  const everything = new AbortController();
  const gone = new Promise<Step<never>>((resolve) => {
    if (connection.signal.aborted) resolve({ kind: 'aborted' });
    else
      connection.signal.addEventListener('abort', () => resolve({ kind: 'aborted' }), {
        signal: everything.signal,
      });
  });
  const deadline = waitStep(
    timers,
    clock.now().add({ milliseconds: options.maxDurationMs }),
    everything.signal,
    'deadline',
  );
  let lastToken: string | null = null;
  let pending: Promise<Step<LiveFrame<unknown>>> | undefined;
  const closeWith = async (end: () => Promise<void>): Promise<void> => {
    await end().catch(() => undefined);
  };
  try {
    await connection.write(
      `retry: ${retryMs}\n\n${options.welcome === undefined ? '' : sseEventOf('welcome', options.welcome)}${(options.notices ?? []).map((notice) => sseEventOf('notice', notice)).join('')}`,
    );
    for (;;) {
      pending ??= iterator.next().then(
        (result): Step<LiveFrame<unknown>> => ({ kind: 'next', result }),
        (error: unknown): Step<LiveFrame<unknown>> => ({ kind: 'failed', error }),
      );
      const quiet = new AbortController();
      const idle = waitStep(
        timers,
        clock.now().add({ milliseconds: options.heartbeatMs }),
        quiet.signal,
        'idle',
      );
      const step: Step<LiveFrame<unknown>> = await Promise.race([pending, idle, deadline, gone]);
      quiet.abort();
      if (step.kind === 'aborted') return;
      if (step.kind === 'deadline') {
        await closeWith(() => connection.end('max_duration' satisfies CarrierEndReason));
        return;
      }
      if (step.kind === 'idle') {
        await connection.write(': ping\n\n');
        continue;
      }
      pending = undefined;
      if (step.kind === 'failed') {
        // A stream the floor passed ends as a finished one with its reason, never as an error (15.4.6).
        const reason = endReasonOfError(step.error);
        await closeWith(() =>
          reason === undefined
            ? connection.fail(errorFrame(step.error, options))
            : connection.end(reason),
        );
        return;
      }
      if (step.result.done === true) {
        await closeWith(() => connection.end('complete'));
        return;
      }
      const frame = step.result.value;
      let text: string;
      try {
        text = sseFrameOf(frame);
      } catch (error) {
        // A frame that cannot be built is the stream's last: an error frame of the closed projection.
        await closeWith(() => connection.fail(errorFrame(error, options)));
        return;
      }
      if (new TextEncoder().encode(text).byteLength > options.maxBufferedBytes) {
        // One item the connection could never queue: the client catches up from the last token it holds.
        await connection.write(
          lastToken === null
            ? sseEventOf('reset', { reason: 'overflow' })
            : sseEventOf('reset', { reason: 'overflow', state: lastToken }, lastToken),
        );
        return;
      }
      await connection.write(text);
      // A reset is the last frame of its stream: the client catches up or asks again, it is not told the stream finished.
      if ('control' in frame && frame.control === 'reset') return;
      const state = stateOf(frame);
      if (state !== undefined) lastToken = state;
    }
  } catch {
    // The connection refused a write: the client is gone, a stalled connection was closed, or the host is stopping.
  } finally {
    everything.abort();
    await iterator.return?.().catch(() => undefined);
  }
}

/**
 * The server-sent events carrier (15.4.6, 15.4.11): `retry` and `welcome` open the stream, each frame
 * is one event (see `sseFrameOf`), a `: ping` comment follows `heartbeatMs` of silence, the stream
 * ends `max_duration` after `maxDurationMs`, an error ends it with an `error` event and a finished
 * stream with `end` `complete`; every wait is on the options' clock and timers. A `reset` is the last
 * frame of its stream and no `end` follows it: the client catches up from its state (`overflow`) or
 * asks again (`resync`, `expired`), and the host closes the response once the carrier returns. A write resolves when the connection can take more, so a client that
 * does not read stalls this loop and never the reader; an aborted connection, or a write the
 * connection refuses, returns the stream. An item larger than the connection's queue ends the stream
 * with `reset` `overflow` and the last token the client holds, when it holds one. The carrier owns nothing of the hub.
 */
export const sseCarrier: LiveCarrier = {
  name: 'sse',
  serve: (stream, connection, options) => {
    if (connection.kind !== 'sse') {
      return Promise.reject(
        errors.internal('The sse carrier serves server-sent event connections only.'),
      );
    }
    return serveSse(stream, connection, options);
  },
};
