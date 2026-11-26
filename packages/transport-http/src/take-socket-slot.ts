import { type InvocationSession, unknownClientAddress } from '@keelwerk/core';
import type { LiveSocketState } from './live-socket-state.ts';

/**
 * The host's slot for a subscription of `session`: throws `core.quota_exceeded` past a bound of the
 * tenant, the process or the anonymous client address; answers the release of the slot.
 */
export function takeSocketSlot(state: LiveSocketState, session: InvocationSession): () => void {
  return state.upgrade.host.limits.takeSubscription(
    session,
    state.upgrade.carrier.connection?.remote.address ?? unknownClientAddress,
  );
}
