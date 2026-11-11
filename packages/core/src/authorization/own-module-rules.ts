import { serviceModuleOf } from '../principals/service-module-of.ts';
import type { Registry } from '../registry/registry.ts';
import type { RuleEntry } from '../registry/rule-entry.ts';
import { normalizeRule } from './normalize-rule.ts';
import type { NormalizedRule } from './normalized-rule.ts';
import { ownModuleRulePrefix } from './own-module-rule-prefix.ts';

function ruleOf(
  module: string,
  subject: { readonly module: string; readonly entity?: string },
): NormalizedRule {
  const entry: RuleEntry = {
    id: `${ownModuleRulePrefix}${module}`,
    module: 'core',
    effect: 'allow',
    subject,
    actions: ['*'],
    principal: 'service',
    when: (context) => serviceModuleOf(Reflect.get(context as object, 'principal')) === module,
    disabled: false,
  };
  return normalizeRule(entry);
}

/**
 * The core's default rule of section 7.7, one per module: the service principal the kernel minted
 * for a module may act on the actions of its own module, its module-level actions and each entity
 * of it. It is an ordinary allow rule, so a deny rule and an action's `principal` list still bind
 * it. The principal is recognised by the object the kernel minted, never by a string.
 */
export function ownModuleRules(
  registry: Pick<Registry, 'modules' | 'entities'>,
): readonly NormalizedRule[] {
  const rules: NormalizedRule[] = [];
  for (const { id } of registry.modules) {
    rules.push(ruleOf(id, { module: id }));
    for (const entity of registry.entities.values()) {
      if (entity.module === id) rules.push(ruleOf(id, { module: id, entity: entity.name }));
    }
  }
  return rules;
}
