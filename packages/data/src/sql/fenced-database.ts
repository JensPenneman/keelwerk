import type { DatabaseConnection, Dialect, Driver } from 'kysely';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import type { SqlDb } from './sql-db.ts';
import type { UnitFence } from './unit-fence.ts';

/**
 * Kysely over one connection a unit already holds, with every statement passing the unit's fence.
 * The unit owns the transaction, its role and its scope settings, so Kysely's own `transaction()` is
 * refused; nested work goes through `Unit.nested`. Destroying it releases nothing.
 */
export function fencedDatabase(connection: DatabaseConnection, fence: UnitFence): Kysely<SqlDb> {
  const fenced = fence.connection(connection);
  const refuse = async (): Promise<never> => {
    throw new Error('the unit owns the transaction; use nested');
  };
  const driver: Driver = {
    init: async () => undefined,
    acquireConnection: async () => fenced,
    beginTransaction: refuse,
    commitTransaction: refuse,
    rollbackTransaction: refuse,
    releaseConnection: async () => undefined,
    destroy: async () => undefined,
  };
  const dialect: Dialect = {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => driver,
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  };
  return new Kysely<SqlDb>({ dialect });
}
