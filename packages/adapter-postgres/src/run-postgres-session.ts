import type { SqlDb } from '@keelwerk/data';
import { beginUnitStatements, fencedDatabase, unitFence } from '@keelwerk/data';
import type { Kysely } from 'kysely';
import { CompiledQuery } from 'kysely';
import { isConnectionFailure } from './is-connection-failure.ts';
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
 * sends them after the commit. A unit whose connection turns out lost at `begin` or a scope setting,
 * before `fn` ran, begins again on another connection, at most `poolMax` more times; a connection
 * lost after `fn` began fails the unit with `core.unavailable` and is never begun again.
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
  const beforeCommit: (() => Promise<void>)[] = [];
  const attempt = (): Promise<{ readonly value: T } | { readonly lost: unknown }> =>
    request.db
      .connection()
      .execute(async (db) => {
        let savepoints = 0;
        // The unit's own statements (begin, settings, commit, rollback) use `db`; the stores and the
        // callback use `fenced`, which refuses everything from the moment the callback has settled, so
        // work that outlived the unit (a consumer raced against a deadline) cannot reach the connection
        // after it went back to the pool.
        const fence = unitFence();
        const fenced = fencedDatabase(
          await db.getExecutor().provideConnection(async (connection) => connection),
          fence,
        );
        const sessionOf = (): PostgresUnitSession => ({
          namespace: request.namespace,
          scope: request.scope,
          readOnly,
          db: fenced,
          check: fence.check,
          afterCommit: (callback) => {
            callbacks.push(callback);
          },
          beforeCommit: (work) => {
            beforeCommit.push(work);
          },
          nested: async (inner) => {
            fence.check();
            savepoints += 1;
            const name = `kw_sp_${savepoints}`;
            const mark = callbacks.length;
            const beforeMark = beforeCommit.length;
            await run(db, `savepoint ${name}`);
            try {
              const value = await inner(sessionOf());
              fence.check();
              await run(db, `release savepoint ${name}`);
              return value;
            } catch (error) {
              // A unit that has ended no longer owns the connection: nothing more is sent to it, and what
              // the unit registered after this savepoint was abandoned stays registered.
              if (fence.open()) {
                callbacks.length = mark;
                beforeCommit.length = beforeMark;
                await run(db, `rollback to savepoint ${name}`).catch(() => undefined);
              }
              throw mapPostgresError(error);
            }
          },
        });
        let opened = false;
        try {
          await run(db, begin.begin);
          for (const statement of begin.settings) {
            await run(db, statement.sql, statement.parameters);
          }
          opened = true;
          let value: T;
          try {
            value = await fn(sessionOf());
          } finally {
            fence.end();
          }
          signal?.throwIfAborted();
          // A statement error swallowed outside a savepoint leaves the transaction aborted, and
          // PostgreSQL answers `commit` with `rollback` and no error; the probe fails with 25P02 then.
          // It runs before the commit tail, so the tail's counter and lane locks are not held for it.
          await run(db, 'select 1');
          // The commit tail and any other work of the unit's end, in the transaction and in order.
          for (const work of beforeCommit.splice(0)) await fence.closing(work);
          await run(db, 'commit');
          return { value };
        } catch (error) {
          await run(db, 'rollback').catch(() => undefined);
          // Nothing of `fn` ran on a connection that was lost before the unit opened.
          if (!opened && isConnectionFailure(error)) return { lost: error };
          throw mapPostgresError(error);
        } finally {
          // Committed or rolled back: the connection goes back to the pool, so not even work that the
          // commit tail started and did not await may send a statement to it.
          fence.finish();
        }
      })
      // Acquiring a connection fails outside the unit's own mapping: the server is unreachable or full.
      .catch((error: unknown) => {
        throw mapPostgresError(error);
      });
  let outcome = await attempt();
  for (let repeats = 0; 'lost' in outcome; repeats += 1) {
    if (repeats === request.poolMax) throw mapPostgresError(outcome.lost);
    signal?.throwIfAborted();
    outcome = await attempt();
  }
  for (const callback of callbacks) {
    try {
      callback();
    } catch (error) {
      request.log.error('an afterCommit callback failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return outcome.value;
}
