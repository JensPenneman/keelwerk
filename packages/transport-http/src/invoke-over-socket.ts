import type { InvokeRequest, InvokeResponse, LiveServerMessage } from '@keelwerk/core';
import { asKeelwerkError, coreError, signalOf } from '@keelwerk/core/http';
import { invokeOne } from './invoke-one.ts';
import type { LiveSocketState } from './live-socket-state.ts';
import { requestId } from './request-id.ts';
import type { RequestState } from './request-state.ts';
import { servedSurfaceOf } from './served-surface-of.ts';
import { wireErrorOf } from './wire-error-of.ts';

/**
 * One `invoke` of a socket (15.4.7), through the invoker as `POST /invoke` goes: the decoded input
 * with the version surface, the command id rules, the receipt of an asynchronous command, `toWire`
 * for the answer. Every action is checked first (as POST /invoke opens a session per request), so a socket never answers more than an HTTP request would; a check that fails answers unrun. An action with
 * an `http.cookie` hint is refused `core.unsupported` (D5): a socket answer sets no cookie, and a
 * session token must not reach page script instead. A command is not aborted by the socket closing
 * (`signalOf`). An internal error is logged by its code and answered in its public form. Answers
 * the text of the `result` message.
 */
export async function invokeOverSocket(
  state: LiveSocketState,
  id: string,
  request: InvokeRequest,
): Promise<string> {
  const { upgrade: call } = state;
  const { host } = call;
  const fresh: RequestState = {
    requestId: requestId(),
    ...(state.traceparent !== undefined && { traceparent: state.traceparent }),
    route: call.state.route,
    transport: 'http',
    setCookies: [],
  };
  const answer = (response: InvokeResponse): string => {
    const message: LiveServerMessage = { type: 'result', id, response };
    return JSON.stringify(message);
  };
  const refused = (failure: unknown): string => {
    const error = asKeelwerkError(failure);
    if (error.kind === 'internal') state.log.error('invoke failed', { code: error.code });
    return answer(wireErrorOf(host, { ...fresh, session: state.session }, error));
  };
  try {
    const actionOf = (session: LiveSocketState['session']) =>
      servedSurfaceOf({ ...call, session })?.actions.find(
        (candidate) => candidate.ref === request.action,
      );
    // POST /invoke opens a session for every request, so a revoked one is refused at once: every action
    // on the socket's session is checked the same way.
    if (state.keeper !== undefined && !(await state.keeper.check())) {
      return refused(coreError('core.unavailable', { message: 'The session is no longer valid.' }));
    }
    const session = state.session;
    fresh.session = session;
    const action = actionOf(session);
    if (action?.hints.http?.cookie !== undefined) {
      return refused(
        coreError('core.unsupported', {
          message: 'This action sets a cookie and is not available over a socket.',
        }),
      );
    }
    const signal =
      action === undefined
        ? state.open.connection.signal
        : signalOf(action, state.open.connection.signal);
    const result = await invokeOne(
      { ...call, state: fresh, session, carrier: state.socketCarrier },
      request,
      false,
      signal,
    );
    return result.ok ? answer(result.body) : refused(result.error);
  } catch (failure) {
    return refused(failure);
  }
}
