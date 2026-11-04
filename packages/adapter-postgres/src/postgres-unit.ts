import type { Unit } from '@keelwerk/core';
import type { SqlUnit } from '@keelwerk/data';
import { runInSpan, sqlUnit } from '@keelwerk/data';
import { postgresNotWired } from './postgres-not-wired.ts';
import type { PostgresUnitRequest } from './postgres-unit-request.ts';
import { runPostgresSession } from './run-postgres-session.ts';

/**
 * The finished `Unit` over the shared SQL unit. The event store and the job store join with their
 * work packages (WP-31, WP-36); until then touching them is `unsupported`.
 */
function toUnit(base: SqlUnit): Unit {
  return {
    namespace: base.namespace,
    scope: base.scope,
    readOnly: base.readOnly,
    rows: base.rows,
    get events(): Unit['events'] {
      throw postgresNotWired('unit.events');
    },
    receipts: base.receipts,
    get jobs(): Unit['jobs'] {
      throw postgresNotWired('unit.jobs');
    },
    usage: base.usage,
    buckets: base.buckets,
    keys: base.keys,
    serials: base.serials,
    ...(base.scopeKeys === undefined ? {} : { scopeKeys: base.scopeKeys }),
    nested: async (fn, options) => base.nested(async (inner) => fn(toUnit(inner)), options),
    afterCommit: (fn) => {
      base.afterCommit(fn);
    },
  };
}

/**
 * The `DataAdapter.unit` entry: the finished `Unit` with its stores over the session of
 * `runPostgresSession`, in a span of the environment's tracer (14.3.6).
 */
export async function runPostgresUnit<T>(
  request: PostgresUnitRequest,
  fn: (u: Unit) => Promise<T>,
): Promise<T> {
  return runInSpan(
    request.tracer,
    'keelwerk.unit',
    {
      'keelwerk.scope.level': request.scope.level,
      'keelwerk.unit.read_only': request.options?.readOnly === true,
    },
    async () =>
      runPostgresSession(request, async (session) => fn(toUnit(sqlUnit(session, request.parts)))),
  );
}
