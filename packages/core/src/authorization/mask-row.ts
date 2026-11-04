import type { StorageRow } from '../storage/storage-row.ts';
import type { Plan } from './plan.ts';
import type { RowMatcher } from './row-matcher.ts';

/**
 * Masks a row that leaves the invoker (section 16.4.5). A maskable field is shown when an allow
 * rule that selected the row lists it, or lists no fields, and no deny rule that matches the row
 * lists it; every other maskable field is omitted. The names omitted come back as `$masked`, a
 * member present only when something is masked. Fields that are not maskable are untouched.
 */
export function maskRow(plan: Plan, row: StorageRow, matches: RowMatcher): StorageRow {
  const masked: string[] = [];
  const present = plan.maskable.filter((field) => Object.hasOwn(row, field));
  if (present.length === 0) return row;
  const selecting = plan.allows.filter((clause) => matches(clause.where, row));
  const hiding = plan.fieldDenies.filter((clause) => matches(clause.where, row));
  for (const field of present) {
    const revealed = selecting.some((clause) => clause.fields === null || clause.fields.has(field));
    const hidden = hiding.some((clause) => clause.fields?.has(field) === true);
    if (!revealed || hidden) masked.push(field);
  }
  if (masked.length === 0) return row;
  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(row)) {
    if (!masked.includes(name)) result[name] = value;
  }
  result.$masked = masked.sort();
  return result;
}
