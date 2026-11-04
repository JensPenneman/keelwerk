import type { AdapterCapabilities } from '@keelwerk/core';

/** The bound of a scan the store has no index for (S-37). */
const maxScan = 10_000;

/**
 * What the PostgreSQL adapter declares (14.3.3, 14.3.7): native savepoints, transactional DDL and
 * partial indexes, row locks with `SKIP LOCKED` and `NOWAIT`, forced row-level security and the
 * notify change feed with polling recovery. Native search is not declared: the kernel's path serves it.
 * M1 places every tenant in shared tables of one database.
 */
export function postgresCapabilities(): AdapterCapabilities {
  return {
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
    search: false,
    positionPaging: { maxOffset: 10_000 },
    jobs: 'skip-locked',
    broadcast: false,
    sql: false,
    processes: 'network',
    encryptedQueries: { equality: true, tagSets: false, order: false, maxScan },
  };
}
