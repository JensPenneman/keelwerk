import type { MemoryGroup } from './memory-group.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/** A group's row in the namespace-wide `groups` collection; a group of default scope belongs to its job's scope. */
export interface MemoryJobGroups {
  get(scopeId: string, groupId: string, spansNamespace: boolean): MemoryGroup | undefined;
  put(scopeId: string, spansNamespace: boolean, group: MemoryGroup): void;
}

/** The groups of the queue (9.5.2): counters, never tenant data. */
export function memoryJobGroups(ctx: MemoryUnitContext): MemoryJobGroups {
  const key = (scopeId: string, groupId: string, spans: boolean): string =>
    `${spans ? '' : scopeId}\u0000${groupId}`;
  return {
    get: (scopeId, groupId, spans) =>
      ctx.tx.read<MemoryGroup>('groups').get(key(scopeId, groupId, spans)),
    put: (scopeId, spans, group) => {
      ctx.writable();
      ctx.tx.write<MemoryGroup>('groups').set(key(scopeId, group.id, spans), group);
    },
  };
}
