import { errors } from '../errors/errors.ts';
import type { Registry } from '../registry/registry.ts';
import { normalizeRule } from './normalize-rule.ts';
import type { NormalizedRule } from './normalized-rule.ts';
import { ownModuleRulePrefix } from './own-module-rule-prefix.ts';
import { ownModuleRules } from './own-module-rules.ts';

/**
 * The rules every decision reads: the registry's enabled rules, then the core's default rule of each
 * module. A registry rule whose id starts with `core.ownModule.` would shadow a default rule and is
 * internal.
 */
export function effectiveRules(
  registry: Pick<Registry, 'modules' | 'entities' | 'rules'>,
): readonly NormalizedRule[] {
  const declared: NormalizedRule[] = [];
  for (const rule of registry.rules.values()) {
    if (rule.id.startsWith(ownModuleRulePrefix)) {
      throw errors.internal(
        `The rule "${rule.id}" uses the id prefix "${ownModuleRulePrefix}" that the core keeps for its default rules.`,
      );
    }
    if (rule.disabled !== true) declared.push(normalizeRule(rule));
  }
  return [...declared, ...ownModuleRules(registry)];
}
