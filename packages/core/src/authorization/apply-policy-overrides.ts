import type { CompositionProblem } from '../registry/composition-problem.ts';
import type { Registry } from '../registry/registry.ts';
import type { RuleEntry } from '../registry/rule-entry.ts';
import type { OverriddenRules } from './overridden-rules.ts';
import type { PolicyOverrides } from './policy-overrides.ts';
import { ruleProblems } from './rule-problems.ts';

/**
 * Applies `policies.disable`, `policies.add` and `policies.replace` (section 8.7) to the rules of
 * the selection. A disabled rule stays in the list with `disabled: true`, so a rename cannot
 * silently re-enable it; a disable naming no rule, a duplicate id and a replacement for a module
 * without rules are named problems (`unknownDisabledRule`, `duplicateRuleId`,
 * `unknownReplacedModule`), and every added rule passes `ruleProblems`.
 */
export function applyPolicyOverrides(
  rules: readonly RuleEntry[],
  overrides: PolicyOverrides,
  registry: Pick<Registry, 'actions' | 'entities'>,
): OverriddenRules {
  const problems: CompositionProblem[] = [];
  const ids = new Set(rules.map((rule) => rule.id));
  const disable = new Set(overrides.disable ?? []);
  for (const id of disable) {
    if (!ids.has(id)) {
      problems.push({
        code: 'unknownDisabledRule',
        severity: 'error',
        message: `policies.disable names "${id}", which is no rule of the selection.`,
        ref: id,
      });
    }
  }
  const replaced = new Set<string>();
  for (const module of Object.keys(overrides.replace ?? {})) {
    if (rules.some((rule) => rule.module === module)) replaced.add(module);
    else {
      problems.push({
        code: 'unknownReplacedModule',
        severity: 'error',
        message: `policies.replace names "${module}", which owns no rule of the selection.`,
        module,
      });
    }
  }
  const result: RuleEntry[] = rules.map((rule) =>
    disable.has(rule.id) || replaced.has(rule.module) ? { ...rule, disabled: true } : rule,
  );
  const added = [...(overrides.add ?? []), ...Object.values(overrides.replace ?? {}).flat()];
  for (const rule of added) {
    if (ids.has(rule.id)) {
      problems.push({
        code: 'duplicateRuleId',
        severity: 'error',
        message: `The rule id "${rule.id}" is already taken.`,
        module: rule.module,
        ref: rule.id,
      });
      continue;
    }
    ids.add(rule.id);
    problems.push(...ruleProblems(rule, registry));
    result.push({ ...rule, disabled: false });
  }
  return { rules: result, problems };
}
