import { liveSocketEndpoint } from './live-socket-endpoint.ts';
import type { UpgradeEntry } from './upgrade-entry.ts';

/**
 * The WebSocket subprotocols the host serves, sorted by protocol; the transports that speak one
 * append their entry. `keelwerk.live.v1` is the host's own endpoint.
 */
export const upgradeTable: readonly UpgradeEntry[] = [
  { protocol: 'keelwerk.live.v1', path: '/_keelwerk/v1/live', serve: liveSocketEndpoint },
];
