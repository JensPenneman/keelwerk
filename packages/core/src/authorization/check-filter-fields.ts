import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { isNever } from './is-never.ts';
import type { Plan } from './plan.ts';

/**
 * A filter or sort on a field the caller cannot see is `forbidden` (section 8.4), so a masked
 * field cannot leak through a query. A maskable field counts as visible only when it is revealed
 * for every row the plan selects: each allow rule in effect lists it or lists no fields, and
 * no deny rule lists it. `fields` are the field paths of the filter and the sort.
 */
export function checkFilterFields(plan: Plan, fields: readonly string[]): void {
  const denied: string[] = [];
  for (const path of fields) {
    const head = path.split('.')[0] ?? path;
    if (!plan.maskable.includes(head)) continue;
    const revealed = plan.allows
      .filter((clause) => !isNever(clause.where))
      .every((clause) => clause.fields === null || clause.fields.has(head));
    const hidden = plan.fieldDenies.some((clause) => clause.fields?.has(head) === true);
    if (!revealed || hidden) denied.push(path);
  }
  if (denied.length === 0) return;
  throw new KeelwerkError({
    kind: 'forbidden',
    code: 'core.forbidden',
    message: `The caller may not filter or sort by ${denied.map((name) => `"${name}"`).join(', ')}.`,
    issues: denied.map((path) => ({
      path: [path],
      message: 'The field is masked for the caller.',
    })),
    rules: plan.rules,
  });
}
