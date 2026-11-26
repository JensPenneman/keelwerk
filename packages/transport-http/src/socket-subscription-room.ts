import { coreError } from '@keelwerk/core/http';
import type { LiveSocketState } from './live-socket-state.ts';

/** Room for one more subscription on the socket: throws `core.malformed_request` for an id that is open already and `core.quota_exceeded` past `maxSubscriptionsPerSocket`. */
export function socketSubscriptionRoom(state: LiveSocketState, id: string): void {
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
}
