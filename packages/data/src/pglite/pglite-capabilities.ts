import type { AdapterCapabilities } from '@keelwerk/core';

/**
 * What PGlite does natively (section 14.3.7): the PostgreSQL dialect on PostgreSQL 18.3 in
 * process, with row-level security through the application role (S-14), one session, the
 * in-process change feed and the shared-tables placement. Decision 157 fixes the encrypted-query
 * row: equality tags only. Lock waits cannot happen on one session, so `rowLocks` only says the
 * syntax runs.
 */
export function pgliteCapabilities(): AdapterCapabilities {
  return {
    dialect: 'postgres',
    eventStore: true,
    transactions: {
      savepoints: true,
      transactionalDdl: true,
      isolation: ['read-committed', 'repeatable-read', 'serializable'],
    },
    placements: ['shared-tables'],
    naming: ['schema', 'prefix'],
    maxIdentifierLength: 63,
    unsupportedConditions: [],
    partialIndexes: 'native',
    changeFeed: 'notify',
    rowLevelSecurity: true,
    rowLocks: { skipLocked: true, noWait: true },
    search: 'tsvector',
    positionPaging: { maxOffset: 10_000 },
    jobs: 'single-writer',
    broadcast: false,
    sql: { dialect: 'postgres' },
    processes: 'single',
    encryptedQueries: { equality: true, tagSets: false, order: false, maxScan: 10_000 },
  };
}
