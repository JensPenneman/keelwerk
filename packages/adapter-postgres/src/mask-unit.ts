import type { Unit } from '@keelwerk/core';
import type { MaskableCapability } from '@keelwerk/data';

/**
 * The unit as an adapter without the named accelerations hands it out: with `rowLocks` switched
 * off the row store has no `lock` member, so the kernel takes its fallback path (14.3.3). Nested
 * units are masked the same way. Capabilities the unit does not carry as members pass unchanged.
 */
export function maskUnit(unit: Unit, masked: readonly MaskableCapability[]): Unit {
  if (!masked.includes('rowLocks')) return unit;
  const { lock: _lock, ...rows } = unit.rows;
  return {
    ...unit,
    rows,
    nested: async (fn, options) =>
      unit.nested(async (inner) => fn(maskUnit(inner, masked)), options),
  };
}
