import type { AppSelection } from './app-selection.ts';
import { behaviourSections } from './behaviour-sections.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import { contributableCoreActions } from './contributable-core-actions.ts';
import { groupedRules } from './grouped-rules.ts';

/**
 * `unknownPolicyTargets`: a policy key names a target its rule does not cover (section 4.4). The one
 * exception: a contribution to the core may mount a rule on a contributable core action (`eraseSubject`)
 * under that action's own key, when the rule covers the core's action itself.
 */
export function checkUnknownPolicyTargets(selection: AppSelection): readonly CompositionProblem[] {
  const coreActions = selection.byId.get('core')?.actions;
  return [...selection.byId.values()].flatMap((module) =>
    behaviourSections(module).flatMap((section) =>
      groupedRules(section.policies)
        .filter(({ key, rule }) =>
          typeof rule.target === 'string'
            ? rule.target !== key
            : section.actions[key] !== rule.target &&
              !(
                section.to === 'core' &&
                contributableCoreActions.has(key) &&
                rule.target === coreActions?.[key]
              ),
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
