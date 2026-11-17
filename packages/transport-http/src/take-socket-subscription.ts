import { unknownClientAddress } from '@keelwerk/core';
import { coreError } from '@keelwerk/core/http';
import type { LiveSocketState } from './live-socket-state.ts';

/**
 * One subscription slot of a socket: throws `core.malformed_request` for an id that is open already and
 * `core.quota_exceeded` past `maxSubscriptionsPerSocket` or a bound of the tenant, the process or the
 * anonymous client address; answers the release of the slot.
 */
export function takeSocketSubscription(state: LiveSocketState, id: string): () => void {
  if (state.subscriptions.has(id)) {
    throw coreError('core.malformed_request', {
      issues: [{ path: ['id'], message: 'This id is open on this socket.' }],
    });
  }
  if (state.subscriptions.size >= state.upgrade.host.liveSocket.maxSubscriptionsPerSocket) {
    throw coreError('core.quota_exceeded', {
      message: 'Too many subscriptions are open on this socket.',
    });
  }
  return state.upgrade.host.limits.takeSubscription(
    state.session,
    state.upgrade.carrier.connection?.remote.address ?? unknownClientAddress,
  );
}
