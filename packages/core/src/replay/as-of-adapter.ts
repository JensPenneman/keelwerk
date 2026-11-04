import type { DataAdapter } from '../storage/data-adapter.ts';
import type { AsOfContext } from './as-of-context.ts';
import { asOfUnit } from './as-of-unit.ts';

/** The adapter whose units are the as-of views of the real ones, opened read-only: for a re-decide that opens a second unit (a backend read). */
export function asOfAdapter(adapter: DataAdapter, context: AsOfContext): DataAdapter {
  return {
    ...adapter,
    unit: (namespace, scope, fn, options) =>
      adapter.unit(namespace, scope, (unit) => fn(asOfUnit(unit, context)), {
        ...options,
        readOnly: true,
      }),
  };
}
