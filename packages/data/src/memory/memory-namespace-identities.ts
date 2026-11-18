import type { NamespaceIdentities, NamespaceIdentity } from '@keelwerk/core';
import { memoryM2Collections } from './memory-m2-collections.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/** `kw_namespace_identities` in the in-memory adapter (14.7.6, S-119); only deployment-scope units have this store. */
export function memoryNamespaceIdentities(ctx: MemoryUnitContext): NamespaceIdentities {
  const collection = memoryM2Collections.namespaceIdentities;
  return {
    all: async () =>
      [...ctx.tx.read<NamespaceIdentity>(collection).values()].sort((a, b) =>
        a.namespaceId < b.namespaceId ? -1 : a.namespaceId > b.namespaceId ? 1 : 0,
      ),
    record: async (identity) => {
      ctx.writable();
      ctx.tx.write<NamespaceIdentity>(collection).set(identity.namespaceId, identity);
    },
  };
}
