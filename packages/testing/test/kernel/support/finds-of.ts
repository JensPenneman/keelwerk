import type { DataAdapter, Unit } from '@keelwerk/core';

/** Counts the `find` calls of the given kind on an entity, as the units of the adapter run them. */
export function findsOf(inner: DataAdapter): {
  readonly adapter: DataAdapter;
  count(entity: string, locked?: boolean): number;
  /** The as-of folds of an entity a re-decide takes: one per read it consumes. */
  asOfReads(entity: string): number;
} {
  const asOf: string[] = [];
  const seen: { entity: string; positioned: boolean; locked: boolean }[] = [];
  const wrap = (unit: Unit): Unit => ({
    ...unit,
    events: {
      ...unit.events,
      readAll: async (after, options) => {
        for (const entity of options?.selector?.streamTypes ?? []) asOf.push(entity);
        return unit.events.readAll(after, options);
      },
    },
    rows: {
      ...unit.rows,
      ...(unit.rows.lock === undefined
        ? {}
        : {
            lock: async (descriptor, query, options) => {
              seen.push({ entity: descriptor.ref, positioned: false, locked: true });
              return (unit.rows.lock as NonNullable<typeof unit.rows.lock>)(
                descriptor,
                query,
                options,
              );
            },
          }),
      find: async (descriptor, query) => {
        seen.push({
          entity: descriptor.ref,
          positioned: query.positioned === true,
          locked: query.forUpdate === true,
        });
        return unit.rows.find(descriptor, query);
      },
    },
  });
  const adapter = new Proxy(inner, {
    get(target, property) {
      if (property === 'unit') {
        return (...args: Parameters<DataAdapter['unit']>) =>
          target.unit(args[0], args[1], (unit) => args[2](wrap(unit)), args[3]);
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return {
    adapter,
    asOfReads: (entity) => asOf.filter((ref) => ref === entity).length,
    count: (entity, locked = false) =>
      seen.filter(
        (find) => find.entity === entity && find.locked === locked && (locked || find.positioned),
      ).length,
  };
}
