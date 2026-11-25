import {
  type CarrierConnection,
  deprecationsOf,
  endReasonOfError,
  type KeelwerkError,
  type LiveCarrier,
  type LiveFrame,
  liveTimersOf,
  type SurfaceAction,
  utcDayOf,
} from '@keelwerk/core';
import { asKeelwerkError, coreError } from '@keelwerk/core/http';
import type { EndpointCall } from './endpoint-call.ts';
import { keepStreamSession } from './keep-stream-session.ts';
import { servedByHost } from './served-by-host.ts';
import { sseConnection } from './sse-connection.ts';
import { wireErrorOf } from './wire-error-of.ts';

/** The protocol version the `welcome` event announces (15.4.6). */
const protocolVersion = 1;

/**
 * Serves `frames` on one server-sent event response of the host (15.4.6): sets the action of the
 * request's span, builds the connection on the host's clock and timers, adds it to the host's open
 * streams (so it ends `going_away` at stop, also a stop that began meanwhile), aborts `options.abort` when the request aborts, ends the stream when its session no longer holds
 * (`keepStreamSession`) and drops a write at or after the session's expiry, runs the
 * carrier with the welcome, the action's deprecation notices and the host's wire errors, and in the
 * end finishes the response, removes the stream and calls `options.settled`. It never throws once it
 * returned the response; a carrier failure is logged.
 */
export function serveSseStream(
  call: EndpointCall,
  frames: AsyncIterable<LiveFrame<unknown>>,
  options: {
    readonly live: LiveCarrier;
    readonly action: SurfaceAction;
    readonly surfaceHash: string;
    /** Aborted when the connection closes; absent: a fresh one. */
    readonly abort?: AbortController;
    /** Called once after the carrier returned. */
    readonly settled?: () => void;
  },
): Response {
  const { host, state, session, request } = call;
  const { live, action } = options;
  const abort = options.abort ?? new AbortController();
  state.action = action.ref;
  const clock = host.deps.clock ?? { now: () => Temporal.Now.instant() };
  const timers = host.deps.timers ?? liveTimersOf(clock);
  const socket = call.incoming?.socket;
  const lastEventId = request.headers.get('last-event-id');
  const stream = sseConnection({
    lastEventId: lastEventId === '' ? null : lastEventId,
    maxBufferedBytes: host.live.maxBufferedBytes,
    stallMs: host.live.stallMs,
    clock,
    timers,
    abort,
    ...(socket !== undefined && { destroy: () => socket.destroy() }),
  });
  host.streams.add(stream);
  // A stop that began during the setup has already taken its list of streams.
  if (host.lifecycle.stopping) void stream.goAway();
  request.signal.addEventListener('abort', () => abort.abort(), { once: true });
  const log = host.deps.log.child({ requestId: state.requestId });
  const endBy = (error: KeelwerkError): void => {
    log.info('stream ended by the host', { reason: error.code });
    // A retired version ends the stream as a finished one, as it does on a socket (15.4.6).
    const ended =
      endReasonOfError(error) === 'version_retired'
        ? stream.connection.end('version_retired')
        : stream.connection.fail(wireErrorOf(host, state, error).error);
    void ended.then(() => abort.abort());
  };
  const kept = keepStreamSession({
    session,
    revalidateMs: host.liveSocket.revalidateMs,
    clock,
    timers,
    signal: abort.signal,
    end: endBy,
  });
  // Nothing passes after the expiry, however late the timer of the expiry runs: a write at or after it
  // ends the stream there and is dropped.
  const connection: CarrierConnection = {
    ...stream.connection,
    write: (chunk) => {
      const expiresAt = kept.expiresAt();
      if (expiresAt === undefined || Temporal.Instant.compare(expiresAt, clock.now()) > 0) {
        return stream.connection.write(chunk);
      }
      endBy(coreError('core.unauthenticated', { message: 'The session expired.' }));
      // The stream is finished now: the write is refused as any write on a finished connection is.
      return stream.connection.write(chunk);
    },
  };
  void live
    .serve(frames, connection, {
      heartbeatMs: host.live.heartbeatMs,
      maxBufferedItems: 1000,
      maxBufferedBytes: host.live.maxBufferedBytes,
      maxDurationMs: host.live.maxDurationMs,
      clock,
      timers,
      notices: deprecationsOf(session, action, utcDayOf(clock.now())),
      welcome: {
        apiVersion: session.apiVersion,
        surfaceHash: options.surfaceHash,
        protocol: protocolVersion,
      },
      wireError: (error) => {
        const failure = asKeelwerkError(error);
        if (failure.kind === 'internal') log.error('stream failed', { code: failure.code });
        return wireErrorOf(host, state, failure).error;
      },
    })
    .catch((failure: unknown) => {
      log.error('a stream carrier failed', { code: asKeelwerkError(failure).code });
    })
    .finally(() => {
      // A carrier that returned without ending the stream (a reset, a failure) leaves no hanging response.
      stream.finish();
      host.streams.delete(stream);
      options.settled?.();
    });
  servedByHost.add(stream.response);
  return stream.response;
}
