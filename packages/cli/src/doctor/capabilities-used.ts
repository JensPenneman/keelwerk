import type { Registry } from '@keelwerk/core';

/**
 * The adapter capabilities the selected apps lean on, named as the fallback report names them.
 * Row locks, position paging, the change feed and broadcast are always in use.
 */
export function capabilitiesUsed(registries: readonly Registry[]): ReadonlySet<string> {
  const used = new Set([
    'rowLocks',
    'positionPaging',
    'changeFeed',
    'broadcast',
    'jobs',
    'rowLevelSecurity',
    'transactions.transactionalDdl',
    'transactions.isolation',
    'unsupportedConditions',
  ]);
  for (const registry of registries) {
    for (const entry of registry.entities.values()) {
      const { descriptor } = entry;
      if (descriptor.searchIndexes.length > 0) used.add('search');
      if (descriptor.indexes.some((index) => index.where !== null)) used.add('partialIndexes');
      for (const field of Object.values(descriptor.fields)) {
        if (field.personal === false) continue;
        if (field.personal.queries.includes('order')) used.add('encryptedQueries.order');
        if (field.personal.queries.some((query) => query !== 'eq' && query !== 'order')) {
          used.add('encryptedQueries.tagSets');
        }
      }
    }
  }
  return used;
}
