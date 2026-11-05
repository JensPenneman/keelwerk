import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { isFieldRevealed } from './is-field-revealed.ts';
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
    if (!isFieldRevealed(plan, head)) denied.push(path);
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
