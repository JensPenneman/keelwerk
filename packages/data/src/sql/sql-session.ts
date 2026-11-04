import type { NamespaceRef, StorageScope } from '@keelwerk/core';
import type { Kysely } from 'kysely';
import type { SqlDb } from './sql-db.ts';

/**
 * One open transaction of one scope: what the shared SQL unit is built over (S-10). PGlite and the
 * `pg` adapter each begin the transaction, set the scope and role, and hand over this shape; `db`
 * runs every statement inside that transaction.
 */
export interface SqlSession {
  readonly namespace: NamespaceRef;
  readonly scope: StorageScope;
  readonly readOnly: boolean;
  readonly db: Kysely<SqlDb>;
  /** A savepoint: rolls back to it when `fn` throws, then rethrows. */
  nested<T>(fn: (session: SqlSession) => Promise<T>): Promise<T>;
  /** Runs after a successful commit; work registered inside a rolled-back savepoint is dropped. */
  afterCommit(fn: () => void): void;
  /**
   * Work that runs inside the transaction, in registration order, once the unit's function has
   * returned and just before `commit`: the commit tail of the event store and the lane counters
   * (15.1.4). Work registered inside a rolled-back savepoint is dropped. A failure rolls the unit back.
   */
  beforeCommit(fn: () => Promise<void>): void;
}
