import { submitterCondition } from '../effects/submitter-condition.ts';
import type { StateToken } from '../events/state-token.ts';
import type { LiveEffectStatusPlan } from '../live/live-effect-status-plan.ts';
import type { LiveEffectsPlan } from '../live/live-effects-plan.ts';
import type { LivePokesPlan } from '../live/live-pokes-plan.ts';
import type { LiveSourcePlan } from '../live/live-source-plan.ts';
import type { Principal } from '../principals/principal.ts';
import { effectStatusAuthority } from './effect-status-authority.ts';
import type { LiveKernelAuthority } from './live-kernel-authority.ts';
import { pendingEffectsAuthority } from './pending-effects-authority.ts';

/**
 * A planned source made ready to run for one caller: the pokes and a status watch resume from
 * `after`, a status watch shows only the rows the caller requested (`submitterCondition`), and a
 * plan that reads `core.effect` through the kernel's own view (pending effects, status) answers
 * that view's authority too.
 */
export function completeLivePlan(
  planned: LiveSourcePlan | LivePokesPlan | LiveEffectsPlan | LiveEffectStatusPlan,
  after: StateToken | undefined,
  principal: Principal,
): {
  readonly plan: LiveSourcePlan | LivePokesPlan | LiveEffectsPlan | LiveEffectStatusPlan;
  readonly authority: (LiveKernelAuthority & { readonly entity: string }) | undefined;
} {
  if (planned.kind === 'pokes') return { plan: { ...planned, after }, authority: undefined };
  if (planned.kind === 'effects') {
    return { plan: planned, authority: pendingEffectsAuthority(planned) };
  }
  if (planned.kind === 'effectStatus') {
    const plan: LiveEffectStatusPlan = { ...planned, after, where: submitterCondition(principal) };
    return { plan, authority: effectStatusAuthority(plan) };
  }
  return { plan: planned, authority: undefined };
}
