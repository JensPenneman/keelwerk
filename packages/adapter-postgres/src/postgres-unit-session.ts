import type { NamespaceRef, StorageScope } from '@keelwerk/core';
import type { SqlDb } from '@keelwerk/data';
import type { Kysely } from 'kysely';

/**
 * One open transaction of one scope: what the stores of a unit are built over. `db` is bound to the
 * unit's connection, so every statement runs inside the transaction.
 */
export interface PostgresUnitSession {
  readonly namespace: NamespaceRef;
  readonly scope: StorageScope;
  readonly readOnly: boolean;
  readonly db: Kysely<SqlDb>;
  /** Throws `internal` once the unit's function has settled, except for the unit's own end work. */
  check(): void;
  /** A savepoint: rolls back to it when `fn` throws, then rethrows the mapped error. */
  nested<T>(fn: (session: PostgresUnitSession) => Promise<T>): Promise<T>;
  /** Runs after a successful commit; work registered inside a rolled-back savepoint is dropped. */
  afterCommit(fn: () => void): void;
  /** Runs inside the transaction just before `commit`; work registered inside a rolled-back savepoint is dropped. */
  beforeCommit(fn: () => Promise<void>): void;
}
