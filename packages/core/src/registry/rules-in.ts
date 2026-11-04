import { isRule, type RuleView } from './is-rule.ts';
import type { PolicyMap } from './runtime-module.ts';

/**
 * The rules of a policy map with their ids (section 8.1): a rule directly under a key is
 * '<prefix>.<key>', a rule in a group is '<prefix>.<key>.<name>'.
 */
export function* rulesIn(
  policies: PolicyMap,
  prefix: string,
): Generator<{ readonly id: string; readonly rule: RuleView }> {
  for (const [key, value] of Object.entries(policies)) {
    if (isRule(value)) {
      yield { id: `${prefix}.${key}`, rule: value };
    } else {
      for (const [name, rule] of Object.entries(value as PolicyMap)) {
        if (isRule(rule)) yield { id: `${prefix}.${key}.${name}`, rule };
      }
    }
  }
}
