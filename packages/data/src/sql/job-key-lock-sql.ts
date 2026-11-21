/**
 * The hash the advisory lock of a FIFO key is taken on, as an SQL expression over the namespace
 * root, a lane id and a key, each given as an SQL expression (a bound parameter or a column). The
 * one place that writes the lock's text: an enqueue that appends under the key, every statement that
 * ends the key's head or removes its jobs, and the take's try for a dying head's key all lock the
 * same hash (job-store-fifo-key.postgres.test.ts proves that they agree).
 */
export const jobKeyLockSql = (root: string, laneId: string, key: string): string =>
  `hashtextextended(${root}::text || ':' || ${laneId}::text || ':' || ${key}::text, 0)`;
