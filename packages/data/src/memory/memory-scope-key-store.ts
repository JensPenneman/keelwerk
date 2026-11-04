import type { ScopeKeyStore, WrappedScopeKey } from '@keelwerk/core';
import { errors, KeelwerkError } from '@keelwerk/core';
import type { MemoryUnitContext } from './memory-unit-context.ts';

const collection = 'scopekeys';

function copy(key: WrappedScopeKey | undefined): WrappedScopeKey | undefined {
  return key === undefined ? undefined : { ...key, wrapped: key.wrapped.slice() };
}

function slot(scopeId: string, version: number): string {
  return `${scopeId}/${String(version).padStart(10, '0')}`;
}

/** The wrapped scope keys of the control root (S-55); only deployment-scope units have this store. */
export function memoryScopeKeyStore(ctx: MemoryUnitContext): ScopeKeyStore {
  const versionsOf = (scopeId: string): WrappedScopeKey[] =>
    [...ctx.tx.read<WrappedScopeKey>(collection).values()]
      .filter((key) => key.scopeId === scopeId)
      .sort((a, b) => a.version - b.version);
  return {
    current: async (scopeId) => copy(versionsOf(scopeId).findLast((key) => key.retiredAt === null)),
    byVersion: async (scopeId, version) =>
      copy(ctx.tx.read<WrappedScopeKey>(collection).get(slot(scopeId, version))),
    add: async (key) => {
      ctx.writable();
      if (ctx.tx.read<WrappedScopeKey>(collection).has(slot(key.scopeId, key.version))) {
        throw new KeelwerkError({
          kind: 'conflict',
          code: 'core.conflict',
          message: `scope ${key.scopeId} already has key version ${key.version}`,
        });
      }
      ctx.tx
        .write<WrappedScopeKey>(collection)
        .set(slot(key.scopeId, key.version), { ...key, wrapped: key.wrapped.slice() });
    },
    retire: async (scopeId, version, at) => {
      ctx.writable();
      const key = ctx.tx.read<WrappedScopeKey>(collection).get(slot(scopeId, version));
      if (key === undefined)
        throw errors.not_found(`scope ${scopeId} has no key version ${version}`);
      ctx.tx
        .write<WrappedScopeKey>(collection)
        .set(slot(scopeId, version), { ...key, retiredAt: at });
    },
    destroy: async (scopeId) => {
      ctx.writable();
      const doomed = versionsOf(scopeId);
      if (doomed.length === 0) return;
      const table = ctx.tx.write<WrappedScopeKey>(collection);
      for (const key of doomed) table.delete(slot(scopeId, key.version));
    },
  };
}
