import type { ScheduleStore, StoredSchedule } from '@keelwerk/core';
import { consumerForbidden } from '../sql/consumer-forbidden.ts';
import { scopeForbidden } from '../sql/scope-forbidden.ts';
import { floorInstant } from './floor-instant.ts';
import { memoryM2Collections } from './memory-m2-collections.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

interface ScheduleRow {
  readonly lastTick: Temporal.Instant | null;
  readonly nextTick: Temporal.Instant;
  readonly updatedAt: Temporal.Instant;
}

const prefix = memoryM2Collections.schedules('');

function byTick(a: StoredSchedule, b: StoredSchedule): number {
  return (
    Temporal.Instant.compare(a.nextTick, b.nextTick) ||
    (a.scopeId < b.scopeId ? -1 : a.scopeId > b.scopeId ? 1 : 0) ||
    (a.scheduleId < b.scheduleId ? -1 : a.scheduleId > b.scheduleId ? 1 : 0)
  );
}

/**
 * `kw_schedules` over `schedules/<scopeId>` (S-118): the last and the next tick of a schedule per
 * scope, instants floored to milliseconds. `upsert` belongs to a scoped unit and its own scope;
 * `due` in a namespace unit reads every scope, in a scoped unit its own; `claimTick` is allowed in a
 * scoped unit for its own scope and in a namespace unit for any scope (stale rows, deferrals); `remove`
 * follows the same rule.
 */
export function memoryScheduleStore(ctx: MemoryUnitContext): ScheduleStore {
  const inNamespace = (): boolean => ctx.scope.level === 'namespace';
  return {
    upsert: async (scheduleId, nextTick) => {
      if (inNamespace()) {
        throw consumerForbidden('a schedule row is inserted in a scoped unit', ctx.scope);
      }
      ctx.writable();
      const table = ctx.tx.write<ScheduleRow>(memoryM2Collections.schedules(ctx.scopeId()));
      const wanted = floorInstant(nextTick);
      const stored = table.get(scheduleId);
      if (stored !== undefined) {
        if (Temporal.Instant.compare(wanted, stored.nextTick) < 0) {
          table.set(scheduleId, { ...stored, nextTick: wanted });
        }
        return;
      }
      const at = floorInstant(ctx.clock.now());
      table.set(scheduleId, { lastTick: null, nextTick: wanted, updatedAt: at });
    },
    due: async (now, limit, after) => {
      const scopeIds = inNamespace()
        ? ctx.tx.names(prefix).map((name) => name.slice(prefix.length))
        : [ctx.scopeId()];
      const at = floorInstant(now);
      const found: StoredSchedule[] = [];
      for (const scopeId of scopeIds) {
        for (const [scheduleId, row] of ctx.tx.read<ScheduleRow>(
          memoryM2Collections.schedules(scopeId),
        )) {
          if (Temporal.Instant.compare(row.nextTick, at) > 0) continue;
          const entry: StoredSchedule = {
            scheduleId,
            scopeId,
            lastTick: row.lastTick,
            nextTick: row.nextTick,
          };
          if (after !== undefined && byTick(entry, { ...after, lastTick: null }) <= 0) continue;
          found.push(entry);
        }
      }
      return found.toSorted(byTick).slice(0, Math.max(0, limit));
    },
    claimTick: async (scheduleId, scopeId, expected, next) => {
      if (!inNamespace() && scopeId !== ctx.scopeId()) {
        throw scopeForbidden('a unit claims the ticks of its own scope only', {
          unit: ctx.scope.level,
        });
      }
      ctx.writable();
      const current = ctx.tx
        .read<ScheduleRow>(memoryM2Collections.schedules(scopeId))
        .get(scheduleId);
      const at = floorInstant(expected);
      if (current === undefined || Temporal.Instant.compare(current.nextTick, at) !== 0) {
        return false;
      }
      ctx.tx.write<ScheduleRow>(memoryM2Collections.schedules(scopeId)).set(scheduleId, {
        lastTick: at,
        nextTick: floorInstant(next),
        updatedAt: floorInstant(ctx.clock.now()),
      });
      return true;
    },
    remove: async (scheduleId, scopeId) => {
      if (!inNamespace() && scopeId !== ctx.scopeId()) {
        throw scopeForbidden('a unit removes the rows of its own scope only', {
          unit: ctx.scope.level,
        });
      }
      ctx.writable();
      const collection = memoryM2Collections.schedules(scopeId);
      if (!ctx.tx.read<ScheduleRow>(collection).has(scheduleId)) return false;
      ctx.tx.write<ScheduleRow>(collection).delete(scheduleId);
      return true;
    },
  };
}
