import { isNever } from './is-never.ts';
import type { Plan } from './plan.ts';

/**
 * Whether a maskable field is revealed for every row the plan selects: each allow rule in effect
 * lists it or lists no fields, and no deny rule lists it. A field that is not maskable is always
 * revealed.
 */
export function isFieldRevealed(plan: Plan, head: string): boolean {
  if (!plan.maskable.includes(head)) return true;
  const revealed = plan.allows
    .filter((clause) => !isNever(clause.where))
    .every((clause) => clause.fields === null || clause.fields.has(head));
  const hidden = plan.fieldDenies.some((clause) => clause.fields?.has(head) === true);
  return revealed && !hidden;
}
