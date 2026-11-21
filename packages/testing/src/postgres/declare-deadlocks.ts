import { declaredDeadlocks } from './declared-deadlocks.ts';

/**
 * A test that provokes deadlocks on purpose says how many PostgreSQL will end (`count`, at least
 * one) before the file ends; `guardClientConnections` then fails the file unless the cluster's
 * deadlock counter moved by exactly what the file declared. A deadlock that PostgreSQL ends and a
 * unit survives by a retry cannot pass unseen in a file that declares none.
 */
export function declareDeadlocks(count: number): void {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`declareDeadlocks takes a whole number of at least 1, not ${count}`);
  }
  declaredDeadlocks.count += count;
}
