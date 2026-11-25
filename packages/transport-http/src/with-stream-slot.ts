import { liveTimersOf, unknownClientAddress } from '@keelwerk/core';
import { asKeelwerkError } from '@keelwerk/core/http';
import type { EndpointCall } from './endpoint-call.ts';
import { errorResponse } from './error-response.ts';
import { isEventStreamResponse } from './is-event-stream-response.ts';
import { keepStreamSession } from './keep-stream-session.ts';
import { servedByHost } from './served-by-host.ts';
import { takeStreamSlot } from './take-stream-slot.ts';

/**
 * Runs `respond` holding one stream slot of the caller (`takeStreamSlot`, the bounds of 15.4.10): past
 * a bound the answer is `429` (`core.quota_exceeded` or `core.concurrency_limited`) and `respond` is
 * not called. A session that has expired already never gets here: opening it is refused (`401`).
 * `respond` gets the signal the route stops on: it aborts when the client leaves and when the host
 * ends the stream. A response with a body is ended by the host, cleanly for the client (the body
 * closes after what was already enqueued; it never errors), at the first of: `host.live.maxDurationMs`
 * after the response arrived (reason `max_duration`); the end of the session, which is a session check
 * (`keepStreamSession` every `host.liveSocket.revalidateMs` and at `expiresAt`) that fails (reason: the
 * error's code); and, for an event stream only (`content-type` media type `text/event-stream`), the
 * host's stop (reason `going_away`, also a stop that began while `respond` ran).
 * An event stream ends at the end of its session and the first chunk after the expiry of the session it
 * holds is dropped, however late the timer of the expiry runs. Any other counted body (a JSON-lines
 * batch, a GraphQL answer; it may carry a command that has committed) is finishing ordinary work: at
 * stop it drains until the deadline, where the listener closes the connection, and after the end of its
 * session it may go on for one revalidation interval and is cut when that has passed. Ending aborts the
 * signal, cancels the route's body without awaiting it, and logs one `info` line 'stream ended by the
 * host' with `reason`. The slot is released once: when the body ends, errors or is cancelled, when the
 * request aborts, when `respond` throws, when the host ends the stream, or at once for a response
 * without a body; every wait and the `host.streams` entry go with it. A response of `serveSseStream`
 * ends itself with its own frame, so here it only holds the slot.
 */
export async function withStreamSlot(
  call: EndpointCall,
  respond: (signal: AbortSignal) => Promise<Response>,
): Promise<Response> {
  const { host, state, session, carrier, request } = call;
  const clock = host.deps.clock ?? { now: () => Temporal.Now.instant() };
  let give: () => void;
  try {
    give = await takeStreamSlot(
      host,
      session,
      carrier.connection?.remote.address ?? unknownClientAddress,
    );
  } catch (failure) {
    return errorResponse(host, state, asKeelwerkError(failure));
  }
  const ending = new AbortController();
  const signal = AbortSignal.any([request.signal, ending.signal]);
  const timers = host.deps.timers ?? liveTimersOf(clock);
  const log = host.deps.log.child({ requestId: state.requestId });
  // Only an event stream ends at the host's stop; the entry of any other counted body is a no-op.
  let eventStream = false;
  const entry = {
    goAway: async (): Promise<void> => {
      if (eventStream) end('going_away');
    },
  };
  let released = false;
  let finished = false;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let held: ReturnType<typeof keepStreamSession> | undefined;
  const release = (): void => {
    if (released) return;
    released = true;
    request.signal.removeEventListener('abort', onRequestAbort);
    ending.abort();
    host.streams.delete(entry);
    give();
  };
  // The one end of a stream the host chose: the body closes after what was enqueued, the route's
  // signal aborts, the route's body is cancelled, the slot is free.
  const end = (reason: string): void => {
    if (finished) return;
    finished = true;
    try {
      controller?.close();
    } catch {
      // The client already cancelled the body.
    }
    release();
    void reader?.cancel(reason).catch(() => undefined);
    log.info('stream ended by the host', { reason });
  };
  const onRequestAbort = (): void => {
    finished = true;
    release();
  };
  request.signal.addEventListener('abort', onRequestAbort, { once: true });
  let response: Response;
  try {
    response = await respond(signal);
  } catch (failure) {
    finished = true;
    release();
    throw failure;
  }
  if (response.body === null) {
    finished = true;
    release();
    return response;
  }
  if (request.signal.aborted) {
    finished = true;
    release();
    void response.body.cancel().catch(() => undefined);
    return response;
  }
  const inner = response.body.getReader();
  reader = inner;
  const body = new ReadableStream<Uint8Array>({
    start(opened) {
      controller = opened;
    },
    async pull(opened) {
      try {
        const chunk = await inner.read();
        if (finished) return;
        if (chunk.done) {
          finished = true;
          release();
          opened.close();
          return;
        }
        // Nothing passes after the expiry, however late the timer of the expiry runs.
        const expiresAt = held?.expiresAt();
        if (
          eventStream &&
          expiresAt !== undefined &&
          Temporal.Instant.compare(expiresAt, clock.now()) <= 0
        ) {
          end('core.unauthenticated');
          return;
        }
        opened.enqueue(chunk.value);
      } catch (failure) {
        if (finished) return;
        finished = true;
        release();
        opened.error(failure);
      }
    },
    async cancel(reason) {
      finished = true;
      release();
      await inner.cancel(reason);
    },
  });
  const reply = (): Response =>
    new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  // A stream the host served itself (`serveSseStream`) ends itself, with its own frame.
  if (servedByHost.has(response)) return reply();
  eventStream = isEventStreamResponse(response);
  host.streams.add(entry);
  // A stop that began while `respond` ran has already taken its list of streams.
  if (host.lifecycle.stopping && eventStream) end('going_away');
  held = keepStreamSession({
    session,
    revalidateMs: host.liveSocket.revalidateMs,
    clock,
    timers,
    signal: ending.signal,
    end: (error) => {
      if (eventStream) return end(error.code);
      // The end of the session stops live delivery, not an answer to work admitted while it held: any
      // other body may finish for one revalidation interval and is cut when that has passed.
      const cutAt = clock.now().add({ milliseconds: host.liveSocket.revalidateMs });
      void timers.sleepUntil(cutAt, ending.signal).then((reached) => {
        if (reached) end(error.code);
      });
    },
  });
  void timers
    .sleepUntil(clock.now().add({ milliseconds: host.live.maxDurationMs }), ending.signal)
    .then((reached) => {
      if (reached) end('max_duration');
    });
  return reply();
}
