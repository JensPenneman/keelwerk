import type { PGlite } from '@electric-sql/pglite';
import type { NamespaceRef, StorageScope } from '@keelwerk/core';
import { Kysely } from 'kysely';
import type { SqlDb } from '../sql/sql-db.ts';
import type { SqlUnit, SqlUnitParts } from '../sql/sql-unit.ts';
import { sqlUnit } from '../sql/sql-unit.ts';
import { pgliteKyselyDialect } from './pglite-kysely-dialect.ts';

/**
 * A session on PGlite: the transaction is open, the role and the scope settings are in force, and
 * the Kysely handle runs inside it. The shared SQL unit is built over it (S-10).
 */
export interface PgliteUnitBase {
  readonly namespace: NamespaceRef;
  readonly scope: StorageScope;
  readonly readOnly: boolean;
  /** Kysely over the unit's transaction; every statement runs as the application role. */
  readonly db: Kysely<SqlDb>;
  /** A savepoint: rolls back to it when `fn` throws, then rethrows. */
  nested<T>(fn: (u: PgliteUnitBase) => Promise<T>): Promise<T>;
  /** Runs after a successful commit; work registered inside a rolled-back savepoint is dropped. */
  afterCommit(fn: () => void): void;
}

/**
 * The unit type `PgliteAdapter.unit` hands to its callback: the shared SQL unit with the stores
 * below the event log (WP-22). WP-31 and WP-36 add the event store and the job store.
 */
export type PgliteUnit = SqlUnit;

/** A unit and the callbacks to run once it has committed. */
export interface OpenedPgliteUnit {
  readonly unit: PgliteUnit;
  /** Takes the callbacks registered so far, for the adapter to run after `commit`. */
  takeAfterCommit(): readonly (() => void)[];
}

/**
 * Wraps the transaction the adapter has already begun on `database`. Savepoint names are local to
 * the unit, so nested units never collide.
 */
export function pgliteUnit(
  database: PGlite,
  namespace: NamespaceRef,
  scope: StorageScope,
  readOnly: boolean,
  parts: SqlUnitParts,
): OpenedPgliteUnit {
  const callbacks: (() => void)[] = [];
  let savepoints = 0;
  const db = new Kysely<SqlDb>({
    dialect: pgliteKyselyDialect(database, { transactions: 'refuse' }),
  });
  const session: PgliteUnitBase = {
    namespace,
    scope,
    readOnly,
    db,
    async nested<T>(fn: (u: PgliteUnitBase) => Promise<T>): Promise<T> {
      savepoints += 1;
      const name = `kw_sp_${savepoints}`;
      const mark = callbacks.length;
      await database.query(`savepoint ${name}`);
      try {
        const result = await fn(session);
        await database.query(`release savepoint ${name}`);
        return result;
      } catch (error) {
        callbacks.length = mark;
        await database.query(`rollback to savepoint ${name}`);
        await database.query(`release savepoint ${name}`);
        throw error;
      }
    },
    afterCommit(fn: () => void): void {
      callbacks.push(fn);
    },
  };
  return { unit: sqlUnit(session, parts), takeAfterCommit: () => callbacks.splice(0) };
}
