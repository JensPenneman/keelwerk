import { liveTimersOf, unknownClientAddress } from '@keelwerk/core';
import { asKeelwerkError } from '@keelwerk/core/http';
import type { EndpointCall } from './endpoint-call.ts';
import { errorResponse } from './error-response.ts';
import { keepStreamSession } from './keep-stream-session.ts';

/**
 * Runs `respond` holding one stream slot of the caller (`host.limits.take`, 15.4.10): past a bound
 * the answer is `429 core.quota_exceeded` and `respond` is not called. `respond` gets the signal the
 * route stops on: it aborts when the client leaves and when the host ends the stream. A response with
 * a body is ended by the host, cleanly for the client (the body closes after what was already
 * enqueued; it never errors), at the first of: `host.live.maxDurationMs` after the response arrived
 * (reason `max_duration`); the host's stop (`host.streams`, reason `going_away`); a session check
 * (`keepStreamSession` every `host.liveSocket.revalidateMs` and at `expiresAt`) that fails (reason: the
 * error's code). Ending aborts the signal, cancels the route's body without awaiting it, and logs one
 * `info` line 'stream ended by the host' with `reason`. The slot is released once: when the body
 * ends, errors or is cancelled, when the request aborts, when `respond` throws, when the host ends the
 * stream, or at once for a response without a body; every wait and the `host.streams` entry go with it.
 */
export async function withStreamSlot(
  call: EndpointCall,
  respond: (signal: AbortSignal) => Promise<Response>,
): Promise<Response> {
  const { host, state, session, carrier, request } = call;
  let give: () => void;
  try {
    give = host.limits.take(session, carrier.connection?.remote.address ?? unknownClientAddress);
  } catch (failure) {
    return errorResponse(host, state, asKeelwerkError(failure));
  }
  const ending = new AbortController();
  const signal = AbortSignal.any([request.signal, ending.signal]);
  const clock = host.deps.clock ?? { now: () => Temporal.Now.instant() };
  const timers = host.deps.timers ?? liveTimersOf(clock);
  const log = host.deps.log.child({ requestId: state.requestId });
  const entry = {
    goAway: async (): Promise<void> => {
      end('going_away');
    },
  };
  let released = false;
  let finished = false;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
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
        } else {
          opened.enqueue(chunk.value);
        }
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
  host.streams.add(entry);
  // A stop that began while `respond` ran has already taken its list of streams.
  if (host.lifecycle.stopping) end('going_away');
  keepStreamSession({
    session,
    revalidateMs: host.liveSocket.revalidateMs,
    clock,
    timers,
    signal: ending.signal,
    end: (error) => end(error.code),
  });
  void timers
    .sleepUntil(clock.now().add({ milliseconds: host.live.maxDurationMs }), ending.signal)
    .then((reached) => {
      if (reached) end('max_duration');
    });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
