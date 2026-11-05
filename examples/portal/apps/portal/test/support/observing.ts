import type { DataAdapterFactory, Unit } from '@keelwerk/core';

/** Records, for every unit and nested unit the kernel receives, whether the row store carries `lock`. */
export function observing(inner: DataAdapterFactory, seen: boolean[]): DataAdapterFactory {
  const observe = (unit: Unit): Unit => {
    seen.push(unit.rows.lock !== undefined);
    return {
      ...unit,
      nested: (fn, options) => unit.nested((child) => fn(observe(child)), options),
    };
  };
  return {
    ...inner,
    create: (placement, env) => {
      const adapter = inner.create(placement, env);
      return {
        ...adapter,
        unit: (ns, scope, fn, options) =>
          adapter.unit(ns, scope, (unit) => fn(observe(unit)), options),
      };
    },
  };
}
