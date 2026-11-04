import type { StorageScope } from '@keelwerk/core';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { ScopingPlugin } from '../../src/sql/scoping-plugin.ts';
import type { SqlDb } from '../../src/sql/sql-db.ts';
import { scopedTables } from './scoped-tables.ts';

/** A Kysely instance that compiles PostgreSQL SQL without a connection. */
export function dummyDb(scope?: StorageScope): Kysely<SqlDb> {
  const db = new Kysely<SqlDb>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (instance) => new PostgresIntrospector(instance),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return scope === undefined
    ? db
    : db.withPlugin(new ScopingPlugin({ scope, scoped: scopedTables }));
}
