import type { LiveEffectsPlan } from '../live/live-effects-plan.ts';
import { pendingEffectsRule } from '../live/pending-effects-rule.ts';
import type { LiveKernelAuthority } from './live-kernel-authority.ts';

/** The members of a `core.effect` row a pending-effects view presents: the frames build a pending effect from exactly these. */
const members: readonly string[] = ['id', 'type', 'status', 'deadline', 'input'];

/** What the kernel reads for the pending effects of a plan: the one rule, the members and the plan's own condition. */
export function pendingEffectsAuthority(
  plan: LiveEffectsPlan,
): LiveKernelAuthority & { readonly entity: string } {
  return {
    entity: plan.entity,
    rules: [pendingEffectsRule(plan.effect)],
    members,
    where: plan.where,
  };
}
