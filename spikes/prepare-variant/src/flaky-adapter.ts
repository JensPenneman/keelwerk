import type { DataAdapter, Unit } from '@keelwerk/core';
import { KeelwerkError } from '@keelwerk/core';

/** Wraps an adapter so the first `fails` event appends fail with a version conflict, which the kernel retries. */
export function flakyAdapter(inner: DataAdapter, fails: number): DataAdapter {
  let left = fails;
  const wrap = (unit: Unit): Unit => ({
    ...unit,
    events: {
      ...unit.events,
      append: async (batch) => {
        if (left > 0) {
          left -= 1;
          throw new KeelwerkError({
            kind: 'conflict',
            code: 'core.version_mismatch',
            message: 'The stream changed since it was read.',
          });
        }
        return unit.events.append(batch);
      },
    },
  });
  return {
    ...inner,
    unit: (ns, scope, fn, options) => inner.unit(ns, scope, (unit) => fn(wrap(unit)), options),
  };
}
