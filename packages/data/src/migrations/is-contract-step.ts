import type { ColumnSpec, MigrationStep } from '@keelwerk/core';

/** Whether `to` holds every value `from` holds: same type, no new constraint, nullable stays nullable. */
function widens(from: ColumnSpec, to: ColumnSpec): boolean {
  if (from.kind !== to.kind) return false;
  if (!to.nullable && from.nullable) return false;
  const before = from.constraints;
  const after = to.constraints;
  if (before.maxLength !== undefined && (after.maxLength ?? Infinity) < before.maxLength) {
    return false;
  }
  if (before.maxLength === undefined && after.maxLength !== undefined) return false;
  if ((after.precision ?? Infinity) < (before.precision ?? 0)) return false;
  if (after.precision === undefined && before.precision !== undefined) return false;
  if (after.scale !== before.scale) return false;
  if (before.values !== undefined) {
    const kept = new Set(after.values ?? []);
    if (after.values === undefined || before.values.some((value) => !kept.has(value))) return false;
  }
  if (before.values === undefined && after.values !== undefined) return false;
  return true;
}

/**
 * Whether a step waits for finalization (section 14.6.4): the contract steps `dropTable`,
 * `dropColumn` and an `alterColumn` that narrows, and `copyColumn`, whose backfill is batched
 * after finalization so rows the older build writes after the expand reach the new column.
 */
export function isContractStep(step: MigrationStep): boolean {
  switch (step.op) {
    case 'dropTable':
    case 'dropColumn':
    case 'copyColumn':
      return true;
    case 'alterColumn':
      return !widens(step.from, step.to);
    default:
      return false;
  }
}
