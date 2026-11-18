import type { ScopeMark, ScopeMarks } from '@keelwerk/core';
import { memoryM2Collections } from './memory-m2-collections.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

function keyOf(scopeId: string, namespaceId: string): string {
  return `${scopeId}\u0000${namespaceId}`;
}

/** The greater of two positions; `Math.max` takes numbers, and a position is a bigint. */
function greater(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The greater value of each member of two serial maps. */
function mergedSerials(
  stored: ScopeMark['serials'],
  given: ScopeMark['serials'],
): Record<string, bigint> {
  const merged: Record<string, bigint> = { ...stored };
  for (const [name, value] of Object.entries(given)) {
    const held = merged[name];
    if (held === undefined || value > held) merged[name] = value;
  }
  return merged;
}

/** `kw_scope_marks` in the in-memory adapter (14.7.6, S-119); only deployment-scope units have this store. */
export function memoryScopeMarks(ctx: MemoryUnitContext): ScopeMarks {
  const collection = memoryM2Collections.scopeMarks;
  const rows = (): readonly ScopeMark[] => [...ctx.tx.read<ScopeMark>(collection).values()];
  return {
    list: async (namespaceId, page) =>
      rows()
        .filter(
          (mark) =>
            mark.namespaceId === namespaceId &&
            (page.after === undefined || compare(mark.scopeId, page.after) > 0),
        )
        .sort((a, b) => compare(a.scopeId, b.scopeId))
        .slice(0, page.limit),
    bumped: async () =>
      rows()
        .filter((mark) => mark.epoch > 0)
        .sort((a, b) => compare(a.namespaceId, b.namespaceId) || compare(a.scopeId, b.scopeId)),
    raise: async (marks) => {
      ctx.writable();
      const table = ctx.tx.write<ScopeMark>(collection);
      for (const mark of marks) {
        const key = keyOf(mark.scopeId, mark.namespaceId);
        const held = table.get(key);
        table.set(
          key,
          held === undefined
            ? mark
            : {
                ...held,
                position: greater(mark.position, held.position),
                serials: mergedSerials(held.serials, mark.serials),
                updatedAt: mark.updatedAt,
              },
        );
      }
    },
    bump: async (mark, from) => {
      ctx.writable();
      const table = ctx.tx.write<ScopeMark>(collection);
      const key = keyOf(mark.scopeId, mark.namespaceId);
      const held = table.get(key);
      const stored = held?.epoch ?? 0;
      if (stored !== from) return stored;
      table.set(
        key,
        held === undefined
          ? mark
          : {
              ...held,
              epoch: mark.epoch,
              position: greater(mark.position, held.position),
              serials: mergedSerials(held.serials, mark.serials),
              updatedAt: mark.updatedAt,
            },
      );
      return mark.epoch;
    },
  };
}
