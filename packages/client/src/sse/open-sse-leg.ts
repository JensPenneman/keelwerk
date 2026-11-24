import { ClientError } from '../client-error.ts';
import { clientFailure } from '../client-failure.ts';
import { errorOfEnvelope } from '../error-of-envelope.ts';
import { isRecord } from '../is-record.ts';
import type { LiveLeg } from '../live-leg.ts';
import type { LiveLegEvent } from '../live-leg-event.ts';
import { liveUnavailable } from '../live-unavailable.ts';
import { outageStatuses } from '../outage-statuses.ts';
import { readJson } from '../read-json.ts';
import type { RemoteClientState } from '../remote-client-state.ts';
import { requestHeaders } from '../request-headers.ts';
import { liveLegEventsOf } from './live-leg-events-of.ts';

/**
 * A failure of the connection as `core.unavailable`, the original as its cause; the caller's own abort
 * and a client error (the leg's own `core.internal` for a malformed event) stay what they are.
 */
function unreachable(cause: unknown, signal: AbortSignal, message: string): unknown {
  return signal.aborted || cause instanceof ClientError
    ? cause
    : clientFailure('core.unavailable', message, { cause });
}

/** The events of a body whose reading fails: the failure is the one `unreachable` makes of it. */
function guarded(
  events: AsyncIterable<LiveLegEvent>,
  signal: AbortSignal,
): AsyncIterable<LiveLegEvent> {
  const iterator = events[Symbol.asyncIterator]();
  return {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        iterator
          .next()
          .catch((cause: unknown) =>
            Promise.reject(unreachable(cause, signal, 'The connection to the server broke.')),
          ),
      return: () =>
        iterator.return?.(undefined) ?? Promise.resolve({ done: true, value: undefined }),
    }),
  };
}

/**
 * The server-sent events leg: `POST {origin}/_keelwerk/v1/subscribe` with `{ action, input?, after? }`
 * through the client's `fetch`. A request that cannot be sent is `core.unavailable`. An answer that is
 * not 200 is the server's error; a 404 `core.not_found` is `core.live_unavailable`, because the client
 * found the action on its surface, so only the endpoint (the live module) is missing. A 408, 502, 503
 * or 504 without an error envelope (a proxy in front of a server that restarts) is `core.unavailable`,
 * so the subscription resumes; a 200 that is not an event stream (a gate's login page after a redirect)
 * is `core.internal`, final: it would end without a frame and be reopened for ever. A body that fails
 * while it is read is `core.unavailable` as well, so `subscribe` never throws a raw failure.
 */
export function openSseLeg(state: RemoteClientState): LiveLeg {
  return async (request, signal) => {
    const headers = requestHeaders(state, true);
    headers.set('accept', 'text/event-stream');
    let response: Response;
    try {
      response = await state.send(`${state.origin}/_keelwerk/v1/subscribe`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: request.action,
          ...(request.input !== undefined && { input: request.input }),
          ...(request.after !== undefined && { after: request.after }),
        }),
        signal,
      });
    } catch (cause) {
      throw unreachable(cause, signal, 'The server could not be reached.');
    }
    if (response.status !== 200 || response.body === null) {
      const answer = await readJson(response);
      const code = isRecord(answer) && isRecord(answer.error) ? answer.error.code : undefined;
      if (outageStatuses.has(response.status) && typeof code !== 'string') {
        throw clientFailure('core.unavailable', `The server answered ${response.status}.`);
      }
      if (response.status === 404 && code === 'core.not_found')
        throw liveUnavailable('Subscribing');
      throw errorOfEnvelope(answer, response.status, await state.surfaces.get());
    }
    if (
      !(response.headers.get('content-type') ?? '').toLowerCase().startsWith('text/event-stream')
    ) {
      await response.body.cancel().catch(() => undefined);
      throw clientFailure(
        'core.internal',
        'The server answered 200 with something that is not an event stream.',
      );
    }
    return guarded(liveLegEventsOf(response.body), signal);
  };
}
