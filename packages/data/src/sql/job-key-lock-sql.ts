/**
 * The hash of `jobKeyLockText` as an SQL expression over the namespace root, a lane id and a key,
 * each given as an SQL expression, for the statement that tries the locks of many keys at once. It
 * must write the same text as `jobKeyLockText`: a take that ends a dying head while an append holds
 * the key only leaves the head when the two agree (job-store-fifo-key.postgres.test.ts).
 */
export const jobKeyLockSql = (root: string, laneId: string, key: string): string =>
  `hashtextextended(${root}::text || ':' || ${laneId}::text || ':' || ${key}, 0)`;
