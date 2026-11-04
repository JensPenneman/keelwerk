import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { EntityModel } from './entity-model.ts';
import type { RuleEntry } from './rule-entry.ts';

const readNames: ReadonlySet<string> = new Set([
  'read',
  'get',
  'query',
  'changes',
  'queryChanges',
  'watch',
  'history',
]);

/**
 * `readRuleFields`: only maskable fields may appear in the field list of a rule that names read
 * actions (section 8.1); a name that is no field of the entity is refused with it.
 */
export function checkReadRuleFields(
  rules: ReadonlyMap<string, RuleEntry>,
  entities: ReadonlyMap<string, EntityModel>,
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  for (const rule of rules.values()) {
    const { subject } = rule;
    if (rule.fields === undefined || !('entity' in subject) || subject.entity === undefined)
      continue;
    if (!rule.actions.some((action) => action === '*' || readNames.has(action))) continue;
    const model = entities.get(`${subject.module}.${subject.entity}`);
    if (model === undefined) continue;
    for (const name of rule.fields) {
      const def = model.fields[name];
      if (def === undefined || !def.flags.maskable) {
        problems.push(
          compositionError(
            'readRuleFields',
            `The read rule '${rule.id}' lists '${name}', which is not a maskable field of ${model.entry.ref}.`,
            { module: rule.module, ref: rule.id },
          ),
        );
      }
    }
  }
  return problems;
}
