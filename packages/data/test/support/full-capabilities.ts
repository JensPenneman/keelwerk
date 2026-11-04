import type { AdapterCapabilities } from '@keelwerk/core';

/** An adapter with every acceleration. */
export const fullCapabilities: AdapterCapabilities = {
  dialect: 'postgres',
  eventStore: true,
  transactions: {
    savepoints: true,
    transactionalDdl: true,
    isolation: ['read-committed', 'repeatable-read', 'serializable'],
  },
  placements: ['shared-tables'],
  naming: ['prefix', 'schema'],
  maxIdentifierLength: 63,
  unsupportedConditions: [],
  partialIndexes: 'native',
  changeFeed: 'notify',
  rowLevelSecurity: true,
  rowLocks: { skipLocked: true, noWait: true },
  search: 'tsvector',
  positionPaging: { maxOffset: 10_000 },
  jobs: 'skip-locked',
  broadcast: true,
  sql: { dialect: 'postgres' },
  processes: 'network',
  encryptedQueries: { equality: true, tagSets: 'array', order: 'ore', maxScan: 10_000 },
};
