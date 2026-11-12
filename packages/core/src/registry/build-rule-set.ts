import { applyPolicyOverrides } from '../authorization/apply-policy-overrides.ts';
import type { ConditionInput } from '../conditions/condition-input.ts';
import { isRuleSelector } from '../dsl/is-rule-selector.ts';
import type { PrincipalKind } from '../principals/principal-kind.ts';
import type { AppliedPart } from './applied-part.ts';
import type { ComposableApp } from './composable-app.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import { isRule, type RuleView } from './is-rule.ts';
import type { Registry } from './registry.ts';
import type { RuleEntry } from './rule-entry.ts';
import { rulePrefixOf } from './rule-prefix-of.ts';
import { rulesIn } from './rules-in.ts';
import type { RuntimeModule } from './runtime-module.ts';

interface RuleSpecView {
  readonly effect: 'allow' | 'deny';
  readonly principal?: PrincipalKind | readonly PrincipalKind[];
  readonly where?: (context: unknown) => ConditionInput | boolean;
  readonly check?: (context: unknown) => ConditionInput | boolean;
  readonly when?: (context: unknown, input: unknown) => boolean;
  readonly fields?: readonly string[];
  readonly reason?: string;
}

interface RuleSite {
  readonly id: string;
  readonly module: string;
  /** The module whose namespace the rule's target lives in. */
  readonly targetModule: string;
  readonly contributedBy?: string;
}

function subjectOf(rule: RuleView, targetModule: string): RuleEntry['subject'] & object {
  if (isRuleSelector(rule.target)) {
    const { kinds, transports } = rule.target;
    return {
      ...(kinds === undefined ? {} : { kinds }),
      ...(transports === undefined ? {} : { transports }),
    };
  }
  if (typeof rule.target === 'string') {
    const dot = rule.target.indexOf('.');
    return dot < 0
      ? { module: targetModule, entity: rule.target }
      : { module: rule.target.slice(0, dot), entity: rule.target.slice(dot + 1) };
  }
  const ref = Reflect.get(rule.target as object, 'ref');
  const segments = typeof ref === 'string' ? ref.split('.') : [targetModule];
  const [module = targetModule, second, third] = segments;
  return third === undefined ? { module } : { module, entity: second ?? '' };
}

function actionsOf(rule: RuleView): readonly string[] {
  if (rule.actions.length > 0 || typeof rule.target === 'string') return rule.actions;
  const ref = Reflect.get(rule.target as object, 'ref');
  return typeof ref === 'string' ? [ref.split('.').at(-1) ?? ref] : ['*'];
}

function entryOf(rule: RuleView, site: RuleSite, disabled: boolean): RuleEntry {
  const spec = rule.spec as RuleSpecView;
  return {
    id: site.id,
    module: site.module,
    effect: spec.effect,
    subject: subjectOf(rule, site.targetModule),
    actions: actionsOf(rule),
    ...(spec.principal === undefined ? {} : { principal: spec.principal }),
    ...(spec.where === undefined ? {} : { where: spec.where }),
    ...(spec.check === undefined ? {} : { check: spec.check }),
    ...(spec.when === undefined ? {} : { when: spec.when }),
    ...(spec.fields === undefined ? {} : { fields: spec.fields }),
    ...(spec.reason === undefined ? {} : { reason: spec.reason }),
    ...(site.contributedBy === undefined ? {} : { contributedBy: site.contributedBy }),
    disabled,
  };
}

function idOf(value: object): string | null {
  const own = Reflect.get(value, 'id');
  if (typeof own === 'string') return own;
  const spec = Reflect.get(value, 'spec');
  const inner = typeof spec === 'object' && spec !== null ? Reflect.get(spec, 'id') : undefined;
  return typeof inner === 'string' ? inner : null;
}

/** An app-written rule as a rule entry, keyed by its own id; `null` when it has none or is no rule. */
function appRuleOf(value: unknown, module: string): RuleEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const id = idOf(value);
  if (id === null) return null;
  if (isRule(value)) return entryOf(value, { id, module, targetModule: 'app' }, false);
  return typeof Reflect.get(value, 'effect') === 'string' ? (value as RuleEntry) : null;
}

/** The rule set and the problems met while building it. */
export interface RuleSet {
  readonly rules: ReadonlyMap<string, RuleEntry>;
  readonly problems: readonly CompositionProblem[];
}

/**
 * Every policy rule of the app by id (section 8.1): the modules' own rules and those of active
 * contributions and conditional parts, then `policies.disable`, `policies.add` and
 * `policies.replace` through the authorization engine's `applyPolicyOverrides`.
 */
export function buildRuleSet(
  app: ComposableApp,
  ordered: readonly RuntimeModule[],
  parts: readonly AppliedPart[],
  registry: Pick<Registry, 'actions' | 'entities'>,
): RuleSet {
  const base: RuleEntry[] = [];
  const problems: CompositionProblem[] = [];
  const seen = new Set<string>();
  const put = (rule: RuleView, site: RuleSite): void => {
    if (seen.has(site.id)) {
      problems.push({
        code: 'duplicateRuleId',
        severity: 'error',
        message: `The rule id "${site.id}" is already taken.`,
        module: site.module,
        ref: site.id,
      });
      return;
    }
    seen.add(site.id);
    base.push(entryOf(rule, site, false));
  };
  for (const module of ordered) {
    for (const { id, rule } of rulesIn(module.policies, module.id)) {
      put(rule, { id, module: module.id, targetModule: module.id });
    }
  }
  for (const part of parts) {
    if (!part.active) continue;
    const contribution = part.kind === 'contribution';
    const prefix = rulePrefixOf(part);
    for (const { id, rule } of rulesIn(part.policies, prefix)) {
      put(rule, {
        id,
        module: part.declaredBy.id,
        targetModule: part.target,
        ...(contribution ? { contributedBy: part.declaredBy.id } : {}),
      });
    }
  }
  const add: RuleEntry[] = [];
  (app.policies.add ?? []).forEach((added, index) => {
    const entry = appRuleOf(added, 'app');
    if (entry === null) {
      problems.push(
        compositionError('invalidAddedRules', `policies.add[${index}] is not a rule with an id.`, {
          ref: `policies.add[${index}]`,
        }),
      );
    } else add.push(entry);
  });
  const replace: Record<string, readonly RuleEntry[]> = {};
  for (const [module, list] of Object.entries(app.policies.replace ?? {})) {
    const entries = list.flatMap((value) => {
      const entry = appRuleOf(value, module);
      return entry === null ? [] : [{ ...entry, module }];
    });
    replace[module] = entries;
  }
  const overridden = applyPolicyOverrides(
    base,
    {
      ...(app.policies.disable === undefined ? {} : { disable: app.policies.disable }),
      add,
      replace,
    },
    registry,
  );
  // Whatever built it (a module's definition, an app's `policies.add`), an allow over a selector
  // would let one module grant access to the actions of every other module.
  for (const rule of overridden.rules) {
    if (rule.effect === 'allow' && !rule.disabled && !('module' in rule.subject)) {
      problems.push(
        compositionError(
          'selectorRuleAllows',
          `The rule "${rule.id}" allows over a selector (action kinds or transports across modules); only a deny rule may.`,
          { module: rule.module, ref: rule.id },
        ),
      );
    }
  }
  return {
    rules: new Map(overridden.rules.map((rule) => [rule.id, rule])),
    problems: [...problems, ...overridden.problems],
  };
}
