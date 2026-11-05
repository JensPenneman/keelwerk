import type { PGlite } from '@electric-sql/pglite';
import { errors } from '@keelwerk/core';
import { mapSqlError } from '../sql/map-sql-error.ts';
import type { SchemaConnection } from '../sql/postgres/schema-connection.ts';

/**
 * The schema connection of a PGlite adapter: transactions run as the owner through `asOwner`
 * (S-14), and the migration lock is an in-process queue per root, because PGlite has one session
 * and a database lock held across `asOwner` calls would block the applies it protects.
 */
export function pgliteSchemaConnection(
  asOwner: <T>(fn: (database: PGlite) => Promise<T>) => Promise<T>,
): SchemaConnection {
  const tails = new Map<string, Promise<unknown>>();
  return {
    transaction: async (fn, url) => {
      if (url !== undefined) throw errors.unsupported('PGlite cannot introspect a database by url');
      return asOwner(async (database) => {
        await database.query('begin');
        try {
          const result = await fn({
            query: async (sql, parameters) => database.query(sql, parameters && [...parameters]),
          });
          await database.query('commit');
          return result;
        } catch (error) {
          await database.query('rollback');
          throw mapSqlError(error);
        }
      });
    },
    exclusive: async (root, fn) => {
      const before = tails.get(root) ?? Promise.resolve();
      const result = before.then(fn, fn);
      tails.set(
        root,
        result.catch(() => undefined),
      );
      return result;
    },
  };
}
