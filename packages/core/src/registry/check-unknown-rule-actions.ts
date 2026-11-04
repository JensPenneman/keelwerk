import type { AppSelection } from './app-selection.ts';
import { behaviourSections } from './behaviour-sections.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import { groupedRules } from './grouped-rules.ts';

const builtin: ReadonlySet<string> = new Set([
  '*',
  'read',
  'write',
  'get',
  'query',
  'changes',
  'queryChanges',
  'watch',
  'history',
  'create',
  'update',
  'archive',
  'restore',
  'set',
]);

/** `unknownRuleActions`: a mounted rule names a custom action its target does not mount (section 8.1). */
export function checkUnknownRuleActions(selection: AppSelection): readonly CompositionProblem[] {
  return [...selection.byId.values()].flatMap((module) =>
    behaviourSections(module).flatMap((section) =>
      groupedRules(section.policies).flatMap(({ key, name, rule }) => {
        const mounted =
          typeof rule.target === 'string' ? Object.keys(section.entityActions(rule.target)) : [];
        return rule.actions
          .filter((action) => !(builtin.has(action) || mounted.includes(action)))
          .map((action) =>
            compositionError(
              'unknownRuleActions',
              `${section.label}: the rule '${key}.${name}' names '${action}', which its target does not mount.`,
              { module: module.id, ref: `${key}.${name}.${action}` },
            ),
          );
      }),
    ),
  );
}
