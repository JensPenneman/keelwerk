import type { AdapterCapabilities } from '@keelwerk/core';
import type { FallbackRow } from './fallback-row.ts';

/**
 * The rows of the table in 14.3.3 for every capability `capabilities` lacks, in the table's order:
 * the kernel path that runs in its place and the cost. Nothing here refuses; `doctor` lists the
 * rows per placement and `connect` logs them. A capability that is present adds no row.
 */
export function fallbackReport(capabilities: AdapterCapabilities): readonly FallbackRow[] {
  const rows: FallbackRow[] = [];
  const lacks = (present: boolean, row: FallbackRow): void => {
    if (!present) rows.push(row);
  };
  lacks(capabilities.search !== false, {
    capability: 'search',
    path: 'the keyed token index of 14.7.9.9, also for plaintext search indexes, in the ordinary tables of the adapter',
    cost: 'index rows and writes per indexed field; word matching without the ranking of the database',
  });
  lacks(capabilities.rowLocks !== false, {
    capability: 'rowLocks',
    path: 'expected versions on the rows a unit would lock, plus a counter row per cross-row invariant, so that a conflicting unit repeats (7.9.4)',
    cost: 'repeated units under contention',
  });
  lacks(capabilities.positionPaging !== false, {
    capability: 'positionPaging',
    path: 'a bounded scan in key order, up to the maxScan of the adapter (14.7.9.5)',
    cost: 'reads that grow with the position; past maxScan, core.scan_limit',
  });
  lacks(capabilities.changeFeed !== 'poll', {
    capability: 'changeFeed',
    path: 'polling the heads, every second by default (14.3.7)',
    cost: 'up to one polling interval of extra delay',
  });
  lacks(capabilities.broadcast, {
    capability: 'broadcast',
    path: 'polling the heads, every second by default (14.3.7)',
    cost: 'up to one polling interval of extra delay',
  });
  lacks(capabilities.encryptedQueries.order !== false, {
    capability: 'encryptedQueries.order',
    path: 'a bounded scan that unseals, filters and sorts in memory (14.7.9.5)',
    cost: 'reads up to maxScan; past it, core.scan_limit',
  });
  lacks(capabilities.encryptedQueries.tagSets === 'array', {
    capability: 'encryptedQueries.tagSets',
    path:
      capabilities.encryptedQueries.tagSets === 'table'
        ? 'index tables per entity (14.7.9.6)'
        : 'a prefix, contains or token condition on a personal field is evaluated in memory after unsealing, as a bounded scan (14.7.9.10)',
    cost:
      capabilities.encryptedQueries.tagSets === 'table'
        ? 'one more table and join per query'
        : 'reads up to maxScan; past it, core.scan_limit',
  });
  lacks(capabilities.partialIndexes === 'native', {
    capability: 'partialIndexes',
    path: 'a unique index over a generated column that is NULL outside the condition',
    cost: 'one generated column per partial index',
  });
  lacks(capabilities.transactions.transactionalDdl, {
    capability: 'transactions.transactionalDdl',
    path: 'migrations that record each applied step and resume at the failed one (14.6.3)',
    cost: 'a failed file stops part-way and resumes',
  });
  lacks(capabilities.rowLevelSecurity, {
    capability: 'rowLevelSecurity',
    path: 'the scope predicate alone, with the scoping plugin and the adversarial isolation suite (14.10)',
    cost: 'no database-side backstop, which doctor states',
  });
  lacks(capabilities.jobs === 'skip-locked', {
    capability: 'jobs',
    path: 'single-writer takes (14.3.9)',
    cost: 'one taker per namespace at a time',
  });
  lacks(capabilities.transactions.isolation.includes('serializable'), {
    capability: 'transactions.isolation',
    path: 'an action that declares isolation serializable runs its units one at a time per scope behind a lock row (14.3.6)',
    cost: 'no concurrency for that action within a scope',
  });
  lacks(capabilities.unsupportedConditions.length === 0, {
    capability: 'unsupportedConditions',
    path: `the kernel evaluates ${capabilities.unsupportedConditions.map((entry) => entry.op).join(', ')} in memory over the rows the rest of the condition selects, as a bounded scan (14.3.4)`,
    cost: 'reads up to maxScan',
  });
  return rows;
}
