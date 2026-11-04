import type { AuthorizedAction } from './authorized-action.ts';
import type { Plan } from './plan.ts';

/** Plans memoised for the length of one invocation (section 8.5): one compile per entity and action. */
export interface PlanMemo {
  /** The plan of `action`, compiled by `compile` on first use. */
  plan(action: AuthorizedAction, compile: () => Plan): Plan;
  /** How many distinct plans were compiled. */
  readonly size: number;
}

/** A fresh memo; the invoker makes one per invocation and drops it with the invocation. */
export function createPlanMemo(): PlanMemo {
  const plans = new Map<string, Plan>();
  return {
    plan(action, compile) {
      const known = plans.get(action.ref);
      if (known !== undefined) return known;
      const plan = compile();
      plans.set(action.ref, plan);
      return plan;
    },
    get size() {
      return plans.size;
    },
  };
}
