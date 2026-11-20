import type { ControlLease, ControlLeaseStore } from '@keelwerk/core';
import { checkLeaseParts } from '../sql/check-lease-parts.ts';
import { floorInstant } from './floor-instant.ts';
import { memoryM2Collections } from './memory-m2-collections.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

function keyOf(kind: string, key: string, holder: string): string {
  return `${kind}\u0000${key}\u0000${holder}`;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `kw_leases` in the in-memory adapter (S-120); deployment-scope units only. Writing units of a namespace run one at a time, which serialises holds. */
export function memoryControlLeases(ctx: MemoryUnitContext): ControlLeaseStore {
  const collection = memoryM2Collections.leases;
  const now = (): Temporal.Instant => floorInstant(ctx.clock.now());
  const rows = (): readonly ControlLease[] => [...ctx.tx.read<ControlLease>(collection).values()];
  const totalOf = (kind: string, key: string): number => {
    const at = now();
    let total = 0;
    for (const row of rows()) {
      if (row.kind === kind && row.key === key && Temporal.Instant.compare(row.expiresAt, at) > 0) {
        total += row.units;
      }
    }
    return total;
  };
  return {
    hold: async (lease, ttlMs) => {
      checkLeaseParts({ ...lease, ttlMs });
      ctx.writable();
      ctx.tx.write<ControlLease>(collection).set(keyOf(lease.kind, lease.key, lease.holder), {
        kind: lease.kind,
        scopeId: lease.scopeId,
        key: lease.key,
        holder: lease.holder,
        units: lease.units,
        expiresAt: now().add({ milliseconds: ttlMs }),
      });
      return { total: totalOf(lease.kind, lease.key) };
    },
    release: async (kind, key, holder) => {
      checkLeaseParts({ kind, key, holder });
      ctx.writable();
      ctx.tx.write<ControlLease>(collection).delete(keyOf(kind, key, holder));
    },
    total: async (kind, key) => {
      checkLeaseParts({ kind, key });
      return totalOf(kind, key);
    },
    expire: async (kind, limit) => {
      checkLeaseParts({ kind, limit });
      ctx.writable();
      const at = now();
      const picked = rows()
        .filter((row) => row.kind === kind && Temporal.Instant.compare(row.expiresAt, at) <= 0)
        .sort(
          (a, b) =>
            Temporal.Instant.compare(a.expiresAt, b.expiresAt) ||
            compare(a.key, b.key) ||
            compare(a.holder, b.holder),
        )
        .slice(0, limit);
      const table = ctx.tx.write<ControlLease>(collection);
      for (const row of picked) table.delete(keyOf(row.kind, row.key, row.holder));
      const answered = new Map<string, { scopeId: string | null; key: string }>();
      for (const row of picked) {
        if (totalOf(kind, row.key) > 0) continue;
        answered.set(`${row.scopeId ?? ''}\u0000${row.key}`, {
          scopeId: row.scopeId,
          key: row.key,
        });
      }
      return [...answered.values()];
    },
  };
}
