import type { Unit } from '@keelwerk/core';
import { doctorReadBounds } from './doctor-read-bounds.ts';
import { walkPages } from './walk-pages.ts';

/**
 * The tenants that have an erasure record without a completion at their current epoch, in tenant id
 * order: the tenants a process that starts now holds until the erasure has run. The epochs are the
 * highest of each scope's marks; a unit without a ledger answers none.
 */
export async function heldTenantsOf(unit: Unit): Promise<readonly string[]> {
  if (unit.ledger === undefined) return [];
  const epochs = new Map<string, number>();
  for (const mark of (await unit.marks?.bumped()) ?? []) {
    epochs.set(mark.scopeId, Math.max(epochs.get(mark.scopeId) ?? 0, mark.epoch));
  }
  const tenants = new Set<string>();
  let after = 0n;
  const { ledger } = unit;
  await walkPages(async () => {
    const { erasures } = await ledger.unfinished({
      epochs,
      after,
      limit: doctorReadBounds.pageSize,
    });
    for (const entry of erasures) tenants.add(entry.record.tenantId);
    const last = erasures.at(-1);
    if (last === undefined || erasures.length < doctorReadBounds.pageSize) return false;
    after = last.seq;
    return true;
  });
  return [...tenants].sort();
}
