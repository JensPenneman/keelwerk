import type { AppSelection } from './app-selection.ts';
import { behaviourSections } from './behaviour-sections.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import { groupedRules } from './grouped-rules.ts';

/** `unknownPolicyTargets`: a policy key names a target its rule does not cover (section 4.4). */
export function checkUnknownPolicyTargets(selection: AppSelection): readonly CompositionProblem[] {
  return [...selection.byId.values()].flatMap((module) =>
    behaviourSections(module).flatMap((section) =>
      groupedRules(section.policies)
        .filter(({ key, rule }) =>
          typeof rule.target === 'string'
            ? rule.target !== key
            : section.actions[key] !== rule.target,
        )
        .map(({ key, name }) =>
          compositionError(
            'unknownPolicyTargets',
            `${section.label}: the rule '${name}' is mounted under '${key}', which it does not cover.`,
            { module: module.id, ref: `${key}.${name}` },
          ),
        ),
    ),
  );
}
