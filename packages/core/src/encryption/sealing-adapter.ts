import type { DataAdapter } from '../storage/data-adapter.ts';
import type { SealingOptions } from './sealing-options.ts';
import { sealingUnit } from './sealing-unit.ts';

/**
 * An adapter whose units are sealing units: the kernel's reads and writes of personal fields go
 * through sealing and the planner, and the adapter underneath stores ciphertext and tags only
 * (14.7.9.6). The adapter's own object stays what it is; this one is for the kernel to use.
 */
export function sealingAdapter(adapter: DataAdapter, options: SealingOptions): DataAdapter {
  return {
    ...adapter,
    unit: (namespace, scope, fn, unitOptions) =>
      adapter.unit(namespace, scope, (unit) => fn(sealingUnit(unit, options)), unitOptions),
  };
}
