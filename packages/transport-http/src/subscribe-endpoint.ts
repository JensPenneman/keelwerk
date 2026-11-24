import { type Carrier, type StateToken, unknownClientAddress } from '@keelwerk/core';
import { asKeelwerkError, coreError, decodeActionInput, encodeFrames } from '@keelwerk/core/http';
import type { EndpointCall } from './endpoint-call.ts';
import { errorResponse } from './error-response.ts';
import { parseSubscribeRequest } from './parse-subscribe-request.ts';
import { serveSseStream } from './serve-sse-stream.ts';
import { servedSurfaceOf } from './served-surface-of.ts';
import { takeStreamSlot } from './take-stream-slot.ts';

/**
 * `GET` or `POST /_keelwerk/v1/subscribe` (16.8.2, 15.4.6): one subscription on one server-sent event
 * response. In order: the app has a live carrier; the request is parsed (tokens are hostile input);
 * the action is a subscription of the request's API version; its input, and the filter in it, is
 * decoded like any input; the open streams of the principal, the tenant and the process are within
 * their bounds, and the tenant's `core.liveConnections` across the deployment holds one more
 * (`takeStreamSlot`); the invoker subscribes (it translates each item once for this version); the
 * frames are wire encoded; the carrier serves them on a connection the host owns. The stream ends
 * `going_away` at stop. A failure of the setup after the subscription started is an `error` event,
 * not a status.
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
  let release: () => void;
  try {
    release = await takeStreamSlot(
      host,
      session,
      carrier.connection?.remote.address ?? unknownClientAddress,
    );
  } catch (failure) {
    return errorResponse(host, state, asKeelwerkError(failure));
  }
  const abort = new AbortController();
  // The ticket is a credential: the redeem is its only use, so nothing the stream keeps holds it afterwards.
  const { ticket: _redeemed, ...redeemed }: Carrier = carrier;
  state.carrier = redeemed;
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
    return serveSseStream(call, frames, {
      live,
      action,
      surfaceHash: surface.hash,
      abort,
      settled: release,
    });
  } catch (failure) {
    release();
    throw failure;
  }
}
