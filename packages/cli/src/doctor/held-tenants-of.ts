import type { Unit } from '@keelwerk/core';
import type { HeldTenantFact } from './deployment-facts.ts';
import { doctorReadBounds } from './doctor-read-bounds.ts';
import { walkPages } from './walk-pages.ts';

/**
 * The tenants that have an erasure record without a completion at their current epoch, in tenant id
 * order: the tenants a process that starts now holds until the erasure has run, each with how long
 * its oldest unfinished record has been in the ledger at `now`. A record counts as applied again
 * (`appliedAgain`) only when the ledger holds a completion of that same record at another, earlier
 * epoch (`rerun`); a tenant with such a record and an ordinary one is counted from its oldest
 * ordinary record. The epochs are the highest of each scope's marks; a unit without a ledger
 * answers none.
 */
export async function heldTenantsOf(
  unit: Unit,
  now: Temporal.Instant,
): Promise<readonly HeldTenantFact[]> {
  if (unit.ledger === undefined) return [];
  const epochs = new Map<string, number>();
  for (const mark of (await unit.marks?.bumped()) ?? []) {
    epochs.set(mark.scopeId, Math.max(epochs.get(mark.scopeId) ?? 0, mark.epoch));
  }
  const oldest = { fresh: new Map<string, number>(), again: new Map<string, number>() };
  let after = 0n;
  const { ledger } = unit;
  await walkPages(async () => {
    const { erasures } = await ledger.unfinished({
      epochs,
      after,
      limit: doctorReadBounds.pageSize,
    });
    for (const { record, rerun } of erasures) {
      const since = Temporal.Instant.from(record.recordedAt).epochMilliseconds;
      const seen = rerun ? oldest.again : oldest.fresh;
      seen.set(record.tenantId, Math.min(seen.get(record.tenantId) ?? since, since));
    }
    const last = erasures.at(-1);
    if (last === undefined || erasures.length < doctorReadBounds.pageSize) return false;
    after = last.seq;
    return true;
  });
  const tenantIds = new Set([...oldest.fresh.keys(), ...oldest.again.keys()]);
  return [...tenantIds]
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .map((tenantId) => {
      const since =
        oldest.fresh.get(tenantId) ?? oldest.again.get(tenantId) ?? now.epochMilliseconds;
      return {
        tenantId,
        unfinishedForMs: now.epochMilliseconds - since,
        appliedAgain: !oldest.fresh.has(tenantId),
      };
    });
}
