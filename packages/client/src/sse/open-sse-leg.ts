import { clientFailure } from '../client-failure.ts';
import { errorOfEnvelope } from '../error-of-envelope.ts';
import { isRecord } from '../is-record.ts';
import type { LiveLeg } from '../live-leg.ts';
import { liveUnavailable } from '../live-unavailable.ts';
import { readJson } from '../read-json.ts';
import type { RemoteClientState } from '../remote-client-state.ts';
import { requestHeaders } from '../request-headers.ts';
import { liveLegEventsOf } from './live-leg-events-of.ts';

/**
 * The server-sent events leg: `POST {origin}/_keelwerk/v1/subscribe` with `{ action, input?, after? }`
 * through the client's `fetch`. A request that cannot be sent is `core.unavailable`. An answer that is
 * not 200 is the server's error; a 404 `core.not_found` is `core.live_unavailable`, because the client
 * found the action on its surface, so only the endpoint (the live module) is missing.
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
      if (signal.aborted) throw cause;
      throw clientFailure('core.unavailable', 'The server could not be reached.', { cause });
    }
    if (response.status !== 200 || response.body === null) {
      const answer = await readJson(response);
      const code = isRecord(answer) && isRecord(answer.error) ? answer.error.code : undefined;
      if (response.status === 404 && code === 'core.not_found')
        throw liveUnavailable('Subscribing');
      throw errorOfEnvelope(answer, response.status, await state.surfaces.get());
    }
    return liveLegEventsOf(response.body);
  };
}
