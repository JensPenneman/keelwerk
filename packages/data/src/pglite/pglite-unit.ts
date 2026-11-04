import type { PGlite } from '@electric-sql/pglite';
import type { NamespaceRef, StorageScope } from '@keelwerk/core';
import { Kysely } from 'kysely';
import type { SqlDb } from '../sql/sql-db.ts';
import { pgliteKyselyDialect } from './pglite-kysely-dialect.ts';

/**
 * A unit on PGlite before the stores: the transaction is open, the role and the scope settings are
 * in force, and the Kysely handle runs inside it. WP-22, WP-31 and WP-36 add the stores
 * (`rows`, `events`, `jobs` and the rest of `Unit`) over `db`.
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
 * The unit type `PgliteAdapter.unit` hands to its callback. It is the base today; the package that
 * adds the stores (WP-22) redefines it here, so `pglite-adapter.ts` stays as it is.
 */
export type PgliteUnit = PgliteUnitBase;

/** A unit and the callbacks to run once it has committed. */
export interface OpenedPgliteUnit {
  readonly unit: PgliteUnitBase;
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
): OpenedPgliteUnit {
  const callbacks: (() => void)[] = [];
  let savepoints = 0;
  const db = new Kysely<SqlDb>({
    dialect: pgliteKyselyDialect(database, { transactions: 'refuse' }),
  });
  const unit: PgliteUnitBase = {
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
        const result = await fn(unit);
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
  return { unit, takeAfterCommit: () => callbacks.splice(0) };
}
