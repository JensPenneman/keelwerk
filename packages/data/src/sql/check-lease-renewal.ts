import { errors } from '@keelwerk/core';
import { checkLeaseParts } from './check-lease-parts.ts';

const maxRenewed = 1_000;

/**
 * What `renew` names: the holder and time-to-live as for any call, and the listed leases, at most
 * 1,000 pairs of kind and key, each once, with units from 0 (0 deletes the lease).
 */
export function checkLeaseRenewal(
  holder: string,
  leases: readonly {
    readonly kind: string;
    readonly key: string;
    readonly scopeId: string | null;
    readonly units: number;
  }[],
  ttlMs: number,
): void {
  checkLeaseParts({ holder, ttlMs });
  if (leases.length > maxRenewed) {
    throw errors.validation(
      `a lease renewal lists at most ${maxRenewed.toLocaleString('en-US')} leases`,
    );
  }
  const listed = new Set<string>();
  for (const lease of leases) {
    checkLeaseParts({
      kind: lease.kind,
      key: lease.key,
      scopeId: lease.scopeId,
    });
    // 0 deletes the lease.
    if (lease.units !== 0) checkLeaseParts({ units: lease.units });
    const pair = `${lease.kind}\u0000${lease.key}`;
    if (listed.has(pair)) throw errors.validation('a lease renewal lists each kind and key once');
    listed.add(pair);
  }
}
