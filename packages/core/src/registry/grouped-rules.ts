import { isRule, type RuleView } from './is-rule.ts';
import type { PolicyMap } from './runtime-module.ts';

/** The rules a policy map groups, by policy key and rule name; a rule directly under a key is a module-level rule and has no group. */
export function groupedRules(
  policies: PolicyMap,
): readonly { readonly key: string; readonly name: string; readonly rule: RuleView }[] {
  return Object.entries(policies).flatMap(([key, group]) =>
    isRule(group)
      ? []
      : Object.entries(group as PolicyMap).flatMap(([name, rule]) =>
          isRule(rule) ? [{ key, name, rule }] : [],
        ),
  );
}
