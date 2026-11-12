import type { DataAdapter } from './data-adapter.ts';

/** Holds the work of one unit: runs it, or fails it when its owner gave up (a stop deadline). */
export type UnitGuard = <T>(work: () => Promise<T>) => Promise<T>;

/**
 * An adapter whose every unit runs its callback through `guard`, inside the unit. A guard that
 * rejects while the callback is still working ends the unit: it rolls back, and the adapter
 * refuses the statements the abandoned callback still sends, so work given up at a deadline writes
 * nothing. Everything but `unit` is the adapter's own.
 */
export function guardUnits(adapter: DataAdapter, guard: UnitGuard): DataAdapter {
  return {
    placementId: adapter.placementId,
    connect: () => adapter.connect(),
    close: (deadlineMs) => adapter.close(deadlineMs),
    health: () => adapter.health(),
    unit: (namespace, scope, fn, options) =>
      adapter.unit(namespace, scope, (unit) => guard(() => fn(unit)), options),
    schema: adapter.schema,
    feed: adapter.feed,
    ...(adapter.broadcast === undefined ? {} : { broadcast: adapter.broadcast }),
    identity: () => adapter.identity(),
  };
}
