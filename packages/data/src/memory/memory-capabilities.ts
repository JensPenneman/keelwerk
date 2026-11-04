import type { AdapterCapabilities } from '@keelwerk/core';

/** What the in-memory adapter does natively (14.3.3, 14.3.7); every absence has a kernel path. */
export function memoryCapabilities(maxScan: number): AdapterCapabilities {
  return {
    dialect: 'memory',
    eventStore: true,
    transactions: {
      savepoints: true,
      transactionalDdl: true,
      // Units run one at a time per namespace, which is serializable by construction.
      isolation: ['read-committed', 'repeatable-read', 'serializable'],
    },
    placements: ['shared-tables'],
    naming: [],
    maxIdentifierLength: Number.MAX_SAFE_INTEGER,
    unsupportedConditions: [],
    partialIndexes: 'native',
    changeFeed: 'notify',
    rowLevelSecurity: false,
    rowLocks: false,
    search: 'naive',
    positionPaging: { maxOffset: 10_000 },
    jobs: 'single-writer',
    broadcast: false,
    sql: false,
    processes: 'single',
    // Equality tags only (S-37); a prefix condition on a personal field takes the kernel's bounded scan.
    encryptedQueries: { equality: true, tagSets: false, order: false, maxScan },
  };
}
