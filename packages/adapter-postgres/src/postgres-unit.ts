import type { Unit } from '@keelwerk/core';
import type { SqlUnit } from '@keelwerk/data';
import { runInSpan, sqlUnit } from '@keelwerk/data';
import type { PostgresUnitRequest } from './postgres-unit-request.ts';
import { runPostgresSession } from './run-postgres-session.ts';

/**
 * The finished `Unit` over the shared SQL unit.
 */
function toUnit(base: SqlUnit): Unit {
  return {
    namespace: base.namespace,
    scope: base.scope,
    readOnly: base.readOnly,
    rows: base.rows,
    events: base.events,
    receipts: base.receipts,
    jobs: base.jobs,
    consumers: base.consumers,
    usage: base.usage,
    buckets: base.buckets,
    keys: base.keys,
    serials: base.serials,
    streams: base.streams,
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
