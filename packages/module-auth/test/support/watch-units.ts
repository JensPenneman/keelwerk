import type { Unit } from '@keelwerk/core';
import type { BootedBoth } from './boot-both.ts';

/** Wraps a unit so that every method of its stores is recorded by name, in call order. */
function recordedUnit(unit: Unit, log: string[]): Unit {
  const wrap = (target: object, path: string): object =>
    new Proxy(target, {
      get(inner, property, receiver) {
        const value: unknown = Reflect.get(inner, property, receiver);
        if (typeof property !== 'string') return value;
        if (typeof value === 'function') {
          return (...args: unknown[]) => {
            log.push(`${path}.${property}`);
            return value.apply(inner, args);
          };
        }
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          return wrap(value, `${path}.${property}`);
        }
        return value;
      },
    });
  return wrap(unit, 'unit') as Unit;
}

/** The store calls of every unit the runtime opens from now on, one list per unit, in order. */
export function watchUnits(both: Pick<BootedBoth, 'runtime'>): { units: string[][] } {
  const watch: { units: string[][] } = { units: [] };
  const target = both.runtime.adapter as { unit: typeof both.runtime.adapter.unit };
  const inner = target.unit.bind(both.runtime.adapter);
  target.unit = (namespace, scope, fn, options) => {
    const log: string[] = [];
    watch.units.push(log);
    return inner(namespace, scope, (unit) => fn(recordedUnit(unit, log)), options);
  };
  return watch;
}
