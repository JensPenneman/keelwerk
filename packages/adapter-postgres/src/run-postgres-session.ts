import type { SqlDb } from '@keelwerk/data';
import { beginUnitStatements } from '@keelwerk/data';
import type { Kysely } from 'kysely';
import { CompiledQuery } from 'kysely';
import { mapPostgresError } from './map-postgres-error.ts';
import type { PostgresUnitRequest } from './postgres-unit-request.ts';
import type { PostgresUnitSession } from './postgres-unit-session.ts';

async function run(
  db: Kysely<SqlDb>,
  text: string,
  parameters: readonly unknown[] = [],
): Promise<void> {
  await db.executeQuery(CompiledQuery.raw(text, [...parameters]));
}

/**
 * Runs `fn` in one transaction of one scope on one connection (sections 14.3.6, 14.3.7): commands
 * at `READ COMMITTED`, queries at `REPEATABLE READ READ ONLY`, the scope settings and the local
 * `statement_timeout` set first, then `commit`, or `rollback` when `fn` or the commit fails. A
 * serialization failure or a deadlock surfaces as `RetryableUnitError`, a unique violation as
 * `conflict`. The unit never leaves its scope, and nothing in it sends a wake-up: the notifier
 * sends them after the commit.
 */
export async function runPostgresSession<T>(
  request: PostgresUnitRequest,
  fn: (session: PostgresUnitSession) => Promise<T>,
): Promise<T> {
  const readOnly = request.options?.readOnly === true;
  const signal = request.options?.signal;
  signal?.throwIfAborted();
  const begin = beginUnitStatements({
    scope: request.scope,
    readOnly,
    deploymentId: request.deploymentId,
    ...(request.options?.isolation === undefined ? {} : { isolation: request.options.isolation }),
    ...(request.options?.timeoutMs === undefined ? {} : { timeoutMs: request.options.timeoutMs }),
  });
  const callbacks: (() => void)[] = [];
  const committed = await request.db.connection().execute(async (db) => {
    let savepoints = 0;
    const sessionOf = (): PostgresUnitSession => ({
      namespace: request.namespace,
      scope: request.scope,
      readOnly,
      db,
      afterCommit: (callback) => {
        callbacks.push(callback);
      },
      nested: async (inner) => {
        savepoints += 1;
        const name = `kw_sp_${savepoints}`;
        const mark = callbacks.length;
        await run(db, `savepoint ${name}`);
        try {
          const value = await inner(sessionOf());
          await run(db, `release savepoint ${name}`);
          return value;
        } catch (error) {
          callbacks.length = mark;
          await run(db, `rollback to savepoint ${name}`).catch(() => undefined);
          throw mapPostgresError(error);
        }
      },
    });
    try {
      await run(db, begin.begin);
      for (const statement of begin.settings) {
        await run(db, statement.sql, statement.parameters);
      }
      const value = await fn(sessionOf());
      signal?.throwIfAborted();
      // A statement error swallowed outside a savepoint leaves the transaction aborted, and
      // PostgreSQL answers `commit` with `rollback` and no error; the probe fails with 25P02 then.
      await run(db, 'select 1');
      await run(db, 'commit');
      return { value };
    } catch (error) {
      await run(db, 'rollback').catch(() => undefined);
      throw mapPostgresError(error);
    }
  });
  for (const callback of callbacks) {
    try {
      callback();
    } catch (error) {
      request.log.error('an afterCommit callback failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return committed.value;
}
