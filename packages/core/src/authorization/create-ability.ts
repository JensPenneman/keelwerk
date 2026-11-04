import type { Ability } from '../contexts/ability.ts';
import type { PrincipalContext } from '../contexts/principal-context.ts';
import type { Registry } from '../registry/registry.ts';
import type { AuthorizedAction } from './authorized-action.ts';
import { compilePlan } from './compile-plan.ts';
import { evaluateGate } from './evaluate-gate.ts';
import { explainPlan } from './explain-plan.ts';
import { itemAction } from './item-action.ts';
import { normalizeRule } from './normalize-rule.ts';
import type { NormalizedRule } from './normalized-rule.ts';
import type { Plan } from './plan.ts';
import { createPlanMemo } from './plan-memo.ts';

/** A plan allows something unless it is `never`; no plan (an unknown entity) allows nothing. */
function isAllowing(plan: Plan | undefined): boolean {
  return plan !== undefined && plan.kind !== 'never';
}

/** `ctx.ability`: pure questions over the rules, with the explanation of a plan. */
export interface AuthorizationAbility extends Ability {
  /**
   * Whether the principal may invoke the action (a reference, `accounts.profile.deactivate`):
   * the gate allows it and, for an entity action, the plan is not `never`. `input` reaches `when`.
   */
  can(action: string, input?: unknown): boolean;
  /** The plan the principal has for an entity action, memoised for the ability's lifetime. */
  plan(action: string): Plan | undefined;
  explain(plan: Plan): string;
}

/** What `createAbility` reads. */
export interface AbilityOptions {
  readonly registry: Pick<Registry, 'actions' | 'entities' | 'rules'>;
  readonly context: PrincipalContext;
  readonly transport?: string | null;
  /** Normalised rules, when the caller already holds them (after the policy overrides). */
  readonly rules?: readonly NormalizedRule[];
}

/** Builds the ability of one principal context (section 8.6). */
export function createAbility(options: AbilityOptions): AuthorizationAbility {
  const { registry, context } = options;
  const transport = options.transport ?? null;
  const rules =
    options.rules ??
    [...registry.rules.values()].filter((rule) => !rule.disabled).map(normalizeRule);
  const memo = createPlanMemo();

  const planOf = (action: AuthorizedAction): Plan | undefined => {
    if (action.entity === undefined) return undefined;
    const entity = registry.entities.get(action.entity);
    if (entity === undefined) return undefined;
    return memo.plan(action, () =>
      compilePlan({ rules, action, entity: entity.descriptor, context, transport }),
    );
  };

  const canInvoke = (action: AuthorizedAction, input: unknown): boolean => {
    const gate = evaluateGate({ rules, action, context, transport, input });
    if (!gate.allowed) return false;
    if (action.auth === 'public' || action.entity === undefined) return true;
    if (action.generated === 'set') {
      return (['create', 'update', 'archive', 'restore'] as const).some((operation) => {
        return isAllowing(planOf(itemAction(action, operation)));
      });
    }
    return isAllowing(planOf(action));
  };

  return {
    can(reference, input) {
      const action = registry.actions.get(reference);
      return action === undefined ? false : canInvoke(action, input);
    },
    plan(reference) {
      const action = registry.actions.get(reference);
      return action === undefined || action.generated === 'set' ? undefined : planOf(action);
    },
    explain: explainPlan,
  };
}
