// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { ScheduleStore, StoredSchedule } from '@keelwerk/core';
import { consumerForbidden } from './consumer-forbidden.ts';
import { decodeInstant } from './decode-instant.ts';
import { encodeInstant } from './encode-instant.ts';
import { claimTickStatement } from './postgres/claim-tick-statement.ts';
import { dueSchedulesStatement } from './postgres/due-schedules-statement.ts';
import { removeScheduleStatement } from './postgres/remove-schedule-statement.ts';
import { upsertScheduleStatement } from './postgres/upsert-schedule-statement.ts';
import { runSql } from './run-sql.ts';
import { scopeForbidden } from './scope-forbidden.ts';
import { sqlGuard } from './sql-guard.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/**
 * `kw_schedules` (S-118) as raw statements with the scope id explicit: a namespace-scope unit has no
 * scope for the scoping plugin, and the row-level security of the table (`scoped` and
 * `maintenance`) is the second line. A scoped unit inserts, claims and removes its own scope's rows and reads
 * only those; a namespace unit reads, claims and removes every scope's rows and inserts none. Instants are floored
 * to milliseconds.
 */
export function sqlScheduleStore(ctx: SqlUnitContext): ScheduleStore {
  const inNamespace = (): boolean => ctx.scope.level === 'namespace';
  return {
    upsert: async (scheduleId, nextTick) => {
      if (inNamespace()) {
        throw consumerForbidden('a schedule row is inserted in a scoped unit', ctx.scope);
      }
      ctx.writable();
      await sqlGuard(async () =>
        runSql(
          ctx.db,
          upsertScheduleStatement(
            ctx.namespace.root,
            ctx.scopeId(),
            scheduleId,
            encodeInstant(nextTick),
            encodeInstant(ctx.clock.now()),
          ),
        ),
      );
    },
    due: async (now, limit, after) => {
      const rows = await sqlGuard(async () =>
        runSql(
          ctx.db,
          dueSchedulesStatement(
            ctx.namespace.root,
            encodeInstant(now),
            Math.max(0, limit),
            inNamespace() ? null : ctx.scopeId(),
            after === undefined
              ? null
              : {
                  nextTick: encodeInstant(after.nextTick),
                  scopeId: after.scopeId,
                  scheduleId: after.scheduleId,
                },
          ),
        ),
      );
      return rows.map(
        (row): StoredSchedule => ({
          scheduleId: String(row.schedule_id),
          scopeId: String(row.scope_id),
          lastTick: row.last_tick === null ? null : decodeInstant(row.last_tick),
          nextTick: decodeInstant(row.next_tick),
        }),
      );
    },
    claimTick: async (scheduleId, scopeId, expected, next) => {
      if (!inNamespace() && scopeId !== ctx.scopeId()) {
        throw scopeForbidden('a unit claims the ticks of its own scope only', {
          unit: ctx.scope.level,
        });
      }
      ctx.writable();
      const rows = await sqlGuard(async () =>
        runSql(
          ctx.db,
          claimTickStatement(
            ctx.namespace.root,
            scopeId,
            scheduleId,
            encodeInstant(expected),
            encodeInstant(next),
            encodeInstant(ctx.clock.now()),
          ),
        ),
      );
      return rows.length > 0;
    },
    remove: async (scheduleId, scopeId) => {
      if (!inNamespace() && scopeId !== ctx.scopeId()) {
        throw scopeForbidden('a unit removes the rows of its own scope only', {
          unit: ctx.scope.level,
        });
      }
      ctx.writable();
      const rows = await sqlGuard(async () =>
        runSql(ctx.db, removeScheduleStatement(ctx.namespace.root, scopeId, scheduleId)),
      );
      return rows.length > 0;
    },
  };
}
