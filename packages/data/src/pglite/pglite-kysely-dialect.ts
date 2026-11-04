import type { PGlite } from '@electric-sql/pglite';
import {
  CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  PGliteAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult,
} from 'kysely';

/** The one connection PGlite has: every statement runs on the same session. */
function connectionOf(database: PGlite): DatabaseConnection {
  return {
    async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
      const result = await database.query<R>(query.sql, [...query.parameters]);
      return {
        rows: result.rows,
        ...(result.affectedRows === undefined
          ? {}
          : { numAffectedRows: BigInt(result.affectedRows) }),
      };
    },
    // biome-ignore lint/correctness/useYield: PGlite has no cursors; a stream is a refusal
    async *streamQuery<R>(): AsyncGenerator<QueryResult<R>, void, undefined> {
      throw new TypeError('PGlite does not stream query results');
    },
  };
}

const savepointName = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

async function savepointStatement(
  connection: DatabaseConnection,
  verb: string,
  name: string,
): Promise<void> {
  if (!savepointName.test(name)) throw new TypeError(`${name} is not a savepoint name`);
  await connection.executeQuery(CompiledQuery.raw(`${verb} "${name}"`));
}

/** Who owns the transaction around the dialect's statements. */
export interface PgliteKyselyDialectOptions {
  /**
   * `own` (default): Kysely's `transaction()` begins and commits on the session, for code that
   * uses the dialect outside a unit. `refuse`: a unit owns the transaction (and its role and
   * scope settings), so `transaction()` throws; nested work goes through `Unit.nested`.
   */
  readonly transactions?: 'own' | 'refuse';
}

/**
 * Kysely's PostgreSQL dialect over an open PGlite database (section 14.3.7), as an adapter over
 * Kysely's own PGlite adapter and a driver whose single connection is PGlite's session. Kysely's
 * stock PGlite driver is not used: it wraps `pglite.transaction()` around a plain `begin` and
 * closes the instance in `destroy`, and the adapter owns both. Savepoints are plain statements on
 * the session.
 */
export function pgliteKyselyDialect(
  database: PGlite,
  options: PgliteKyselyDialectOptions = {},
): Dialect {
  const connection = connectionOf(database);
  const refuse = options.transactions === 'refuse';
  const guard = (): void => {
    if (refuse) throw new Error('the unit owns the transaction; use nested');
  };
  const driver: Driver = {
    async init(): Promise<void> {
      await database.waitReady;
    },
    async acquireConnection(): Promise<DatabaseConnection> {
      return connection;
    },
    async beginTransaction(): Promise<void> {
      guard();
      await database.query('begin');
    },
    async commitTransaction(): Promise<void> {
      guard();
      await database.query('commit');
    },
    async rollbackTransaction(): Promise<void> {
      guard();
      await database.query('rollback');
    },
    async savepoint(conn: DatabaseConnection, name: string): Promise<void> {
      await savepointStatement(conn, 'savepoint', name);
    },
    async rollbackToSavepoint(conn: DatabaseConnection, name: string): Promise<void> {
      await savepointStatement(conn, 'rollback to savepoint', name);
    },
    async releaseSavepoint(conn: DatabaseConnection, name: string): Promise<void> {
      await savepointStatement(conn, 'release savepoint', name);
    },
    async releaseConnection(): Promise<void> {},
    // The adapter owns the database and closes it.
    async destroy(): Promise<void> {},
  };
  return {
    createAdapter: () => new PGliteAdapter(),
    createDriver: () => driver,
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  };
}
