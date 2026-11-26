import {
  type ApiSurface,
  deprecationsOf,
  type InvocationSession,
  renderTypeId,
  utcDayOf,
} from '@keelwerk/core';
import { closeCodeOfError, coreError } from '@keelwerk/core/http';
import type { LiveSocketState } from './live-socket-state.ts';
import { sendLiveMessage } from './send-live-message.ts';
import { servedSurfaceOf } from './served-surface-of.ts';
import { socketWireError } from './socket-wire-error.ts';

/** The protocol version the `welcome` message announces (15.4.7). */
const protocolVersion = 1;

/** The principal as the welcome names it: a user's subject as a TypeID of its entity, a service's or operator's id, else none. */
function principalOf(
  session: InvocationSession,
  surface: ApiSurface,
): { readonly kind: string; readonly id: string | null } {
  const { principal } = session;
  if (principal.kind === 'service' || principal.kind === 'operator') {
    return { kind: principal.kind, id: principal.id };
  }
  if (principal.kind === 'user' && principal.subjectRef !== null) {
    const entity = surface.entities.find((candidate) => candidate.ref === principal.subjectRef);
    if (entity !== undefined) {
      try {
        return { kind: 'user', id: renderTypeId(entity.prefix, principal.subject) };
      } catch {
        // A subject that is not a UUID has no TypeID form.
      }
    }
  }
  return { kind: principal.kind, id: null };
}

/** The `welcome` and the deprecation notices to a socket whose first message opened its session; false (and the close) when its version has no surface. */
export async function sendWelcome(state: LiveSocketState): Promise<boolean> {
  const surface = servedSurfaceOf({ ...state.upgrade, session: state.session });
  if (surface === undefined) {
    const error = coreError('core.not_found', { message: 'There is no such app.' });
    state.open.closeWith(closeCodeOfError(error.kind), error.code, [
      JSON.stringify({ type: 'error', error: socketWireError(state, error) }),
    ]);
    return false;
  }
  const { session } = state;
  await sendLiveMessage(state, {
    type: 'welcome',
    principal: principalOf(session, surface),
    heartbeatMs: state.upgrade.host.liveSocket.heartbeatMs,
    apiVersion: session.apiVersion,
    surfaceHash: surface.hash,
    protocol: protocolVersion,
  });
  for (const notice of deprecationsOf(session, undefined, utcDayOf(state.clock.now()))) {
    await sendLiveMessage(state, { type: 'notice', notice });
  }
  return true;
}
