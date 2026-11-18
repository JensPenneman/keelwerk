import type { CounterStore, ScopeCounters } from '@keelwerk/core';
import { canonicalizeJson } from '@keelwerk/core';
import type { MemoryCounter } from './memory-counter.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

const scopePrefixes = ['pos/', 'serials/'] as const;

/**
 * The counters of every scope in the in-memory namespace (14.7.6): the scope counters of `pos/<scope>`
 * and the serial counters of `serials/<scope>`. A serial key is `<entity>\0<field>\0<partition>`; its
 * mark name is `canonicalizeJson([entity, field, <partition key>])`, which `raise` reads back with
 * `JSON.parse`. `stream:` counters are left out (S-119).
 */
export function memoryCounterStore(ctx: MemoryUnitContext): CounterStore {
  return {
    list: async (page) => {
      const scopeIds = new Set<string>();
      for (const prefix of scopePrefixes) {
        for (const name of ctx.tx.names(prefix)) scopeIds.add(name.slice(prefix.length));
      }
      const wanted = page.scopeIds === undefined ? undefined : new Set(page.scopeIds);
      const listed = [...scopeIds]
        .filter(
          (scopeId) =>
            (page.after === undefined || scopeId > page.after) &&
            (wanted === undefined || wanted.has(scopeId)),
        )
        .sort()
        .slice(0, page.limit);
      return listed.map((scopeId): ScopeCounters => {
        const counter = ctx.tx.read<MemoryCounter>(`pos/${scopeId}`).get('counter');
        const serials: Record<string, bigint> = {};
        for (const [key, next] of ctx.tx.read<bigint>(`serials/${scopeId}`)) {
          const [entity, field, ...rest] = key.split('\u0000');
          if (entity === undefined || field === undefined || entity.startsWith('stream:')) continue;
          serials[canonicalizeJson([entity, field, rest.join('\u0000')])] = next - 1n;
        }
        return {
          scopeId,
          position: counter === undefined ? 0n : counter.next - 1n,
          epoch: counter?.epoch ?? 1,
          serials,
        };
      });
    },
    raise: async (counters) => {
      ctx.writable();
      const { scopeId } = counters;
      const positions = ctx.tx.write<MemoryCounter>(`pos/${scopeId}`);
      const held = positions.get('counter');
      positions.set('counter', {
        next:
          held !== undefined && held.next > counters.position + 1n
            ? held.next
            : counters.position + 1n,
        epoch: Math.max(held?.epoch ?? 0, counters.epoch),
      });
      const names = Object.entries(counters.serials);
      if (names.length === 0) return;
      const table = ctx.tx.write<bigint>(`serials/${scopeId}`);
      for (const [name, value] of names) {
        const [entity, field, partition] = JSON.parse(name) as [string, string, string];
        const key = [entity, field, partition].join('\u0000');
        const next = value + 1n;
        const current = table.get(key);
        if (current === undefined || next > current) table.set(key, next);
      }
    },
  };
}
