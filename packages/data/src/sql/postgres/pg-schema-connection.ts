import { mapSqlError } from '../map-sql-error.ts';
import { namespaceLock } from './namespace-lock.ts';
import type { SchemaConnection } from './schema-connection.ts';

/** A connected client of the `pg` driver, as far as the schema operations use it. */
export interface PgClientLike {
  query(
    sql: string,
    parameters?: unknown[],
  ): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
  end(): Promise<void>;
}

/**
 * The schema connection of a PostgreSQL server: each transaction runs on a client of its own as
 * the owner (`connect` opens one, to the placement or to the `url` of an introspection), and the
 * planner's lock is `pg_advisory_xact_lock` held by a transaction on a further client for as long
 * as the work inside it runs (section 14.6.3). `apply` takes a different key, so work inside the
 * lock may apply files.
 */
export function pgSchemaConnection(
  connect: (url?: string) => Promise<PgClientLike>,
): SchemaConnection {
  const inTransaction = async <T>(
    client: PgClientLike,
    work: (client: PgClientLike) => Promise<T>,
  ): Promise<T> => {
    await client.query('begin');
    try {
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw mapSqlError(error);
    }
  };
  const tails = new Map<string, Promise<unknown>>();
  return {
    transaction: async (fn, url) => {
      const client = await connect(url);
      try {
        return await inTransaction(client, async () =>
          fn({
            query: async (sql, parameters) => client.query(sql, parameters && [...parameters]),
          }),
        );
      } finally {
        await client.end();
      }
    },
    // Callers of this process queue in call order; the advisory lock then orders them against other processes.
    exclusive: async (root, fn) => {
      const run = async () => {
        const client = await connect();
        try {
          return await inTransaction(client, async () => {
            const lock = namespaceLock(root, 'migrate');
            await client.query(lock.sql, [...lock.parameters]);
            return fn();
          });
        } finally {
          await client.end();
        }
      };
      const before = tails.get(root) ?? Promise.resolve();
      const result = before.then(run, run);
      tails.set(
        root,
        result.catch(() => undefined),
      );
      return result;
    },
  };
}
