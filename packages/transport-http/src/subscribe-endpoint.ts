import {
  type Carrier,
  deprecationsOf,
  liveTimersOf,
  type StateToken,
  unknownClientAddress,
  utcDayOf,
} from '@keelwerk/core';
import { asKeelwerkError, coreError, decodeActionInput, encodeFrames } from '@keelwerk/core/http';
import type { EndpointCall } from './endpoint-call.ts';
import { errorResponse } from './error-response.ts';
import { parseSubscribeRequest } from './parse-subscribe-request.ts';
import { servedSurfaceOf } from './served-surface-of.ts';
import { sseConnection } from './sse-connection.ts';
import { wireErrorOf } from './wire-error-of.ts';

/** The protocol version the `welcome` event announces (15.4.6). */
const protocolVersion = 1;

/**
 * `GET` or `POST /_keelwerk/v1/subscribe` (16.8.2, 15.4.6): one subscription on one server-sent event
 * response. In order: the app has a live carrier; the request is parsed (tokens are hostile input);
 * the action is a subscription of the request's API version; its input, and the filter in it, is
 * decoded like any input; the open streams of the principal, the tenant and the process are within
 * their bounds; the invoker subscribes (it translates each item once for this version); the frames are
 * wire encoded; the carrier serves them on a connection the host owns. The stream ends `going_away` at
 * stop. A failure of the setup after the subscription started is an `error` event, not a status.
 */
export async function subscribeEndpoint(call: EndpointCall): Promise<Response> {
  const { host, state, session, carrier, request } = call;
  const live = host.deps.liveCarrier?.(session.app, 'sse');
  if (live === undefined) {
    return errorResponse(
      host,
      state,
      coreError('core.not_found', { message: 'There is no such endpoint.' }),
    );
  }
  const asked = parseSubscribeRequest(request, call.bytes);
  const surface = servedSurfaceOf(call);
  const action = surface?.actions.find((candidate) => candidate.ref === asked.action);
  if (surface === undefined || action === undefined) {
    return errorResponse(
      host,
      state,
      coreError('core.not_found', { message: 'There is no such subscription.' }),
    );
  }
  state.action = action.ref;
  if (action.kind !== 'subscription') {
    return errorResponse(
      host,
      state,
      coreError('core.unsupported', { message: 'This action is not a subscription.' }),
    );
  }
  const input = decodeActionInput(surface, action, asked.input);
  const release = host.limits.take(
    session,
    carrier.connection?.remote.address ?? unknownClientAddress,
  );
  const abort = new AbortController();
  const clock = host.deps.clock ?? { now: () => Temporal.Now.instant() };
  const timers = host.deps.timers ?? liveTimersOf(clock);
  // The ticket is a credential: the redeem is its only use, so nothing the stream keeps holds it afterwards.
  const { ticket: _redeemed, ...redeemed }: Carrier = carrier;
  state.carrier = redeemed;
  const socket = call.incoming?.socket;
  try {
    const frames = encodeFrames(
      host.deps.invoker.subscribe<unknown, unknown>(
        {
          action: action.ref,
          input,
          carrier: redeemed,
          session,
          requestId: state.requestId,
          ...(state.traceparent !== undefined && { traceparent: state.traceparent }),
          signal: abort.signal,
        },
        asked.after === undefined ? undefined : { after: asked.after as StateToken },
      ),
      action,
    );
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
    request.signal.addEventListener('abort', () => abort.abort(), { once: true });
    const log = host.deps.log.child({ requestId: state.requestId });
    void live
      .serve(frames, stream.connection, {
        heartbeatMs: host.live.heartbeatMs,
        maxBufferedItems: 1000,
        maxBufferedBytes: host.live.maxBufferedBytes,
        maxDurationMs: host.live.maxDurationMs,
        clock,
        timers,
        notices: deprecationsOf(session, action, utcDayOf(clock.now())),
        welcome: {
          apiVersion: session.apiVersion,
          surfaceHash: surface.hash,
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
        release();
      });
    return stream.response;
  } catch (failure) {
    release();
    throw failure;
  }
}
