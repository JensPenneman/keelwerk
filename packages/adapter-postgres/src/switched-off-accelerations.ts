import type { MaskableCapability } from '@keelwerk/data';
import type { AccelerationOptions } from './acceleration-options.ts';

/** The capabilities `accelerations` switches off: `rowLocks` for `rowLocks: false`, `changeFeed` for `notify: false`. */
export function switchedOffAccelerations(
  options: AccelerationOptions,
): readonly MaskableCapability[] {
  const off: MaskableCapability[] = [];
  if (options.accelerations?.rowLocks === false) off.push('rowLocks');
  if (options.accelerations?.notify === false) off.push('changeFeed');
  return off;
}
