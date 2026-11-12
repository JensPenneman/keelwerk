import type { WebSocketHandler } from '@keelwerk/core';
import type { UpgradeEntry } from './upgrade-entry.ts';
import type { UpgradeRegistration } from './upgrade-registration.ts';

const reserved = '/_keelwerk';

/**
 * `TransportHost.upgrade` (16.3.3, D7): records the endpoint of one app. A protocol no path-less
 * entry of the table serves, a path under `/_keelwerk` and a repeated path and protocol of one app
 * fail at once with a `TypeError`, so a transport that could never be reached fails at mount.
 */
export function registerUpgrade(
  upgrades: Map<string, UpgradeRegistration[]>,
  entries: readonly UpgradeEntry[],
  spec: {
    readonly app: string;
    readonly transport: string;
    readonly path: string;
    readonly protocols: readonly string[];
  },
  handler: WebSocketHandler,
): void {
  if (
    !spec.path.startsWith('/') ||
    spec.path === reserved ||
    spec.path.startsWith(`${reserved}/`)
  ) {
    throw new TypeError(`upgrade: the path '${spec.path}' is not open to a transport.`);
  }
  if (spec.protocols.length === 0) {
    throw new TypeError('upgrade: name at least one subprotocol.');
  }
  for (const protocol of spec.protocols) {
    if (!entries.some((entry) => entry.protocol === protocol && entry.path === undefined)) {
      throw new TypeError(
        `upgrade: the host serves no subprotocol '${protocol}' on a path of a transport.`,
      );
    }
  }
  const registered = upgrades.get(spec.app) ?? [];
  for (const known of registered) {
    if (known.path === spec.path && known.protocols.some((p) => spec.protocols.includes(p))) {
      throw new TypeError(`upgrade: '${spec.path}' is registered for this subprotocol already.`);
    }
  }
  upgrades.set(spec.app, [...registered, { ...spec, handler }]);
}
