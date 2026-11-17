import { effectStatusRule } from '../live/effect-status-rule.ts';
import type { LiveEffectStatusPlan } from '../live/live-effect-status-plan.ts';
import type { LiveKernelAuthority } from './live-kernel-authority.ts';

/** The members of a `core.effect` row a status view presents: the view is built from exactly these, and the two submitter columns are read only to decide whom a row is shown to. */
const members: readonly string[] = [
  'id',
  'type',
  'status',
  'createdAt',
  'runAt',
  'deadline',
  'settledAt',
  'error',
  'principalResolver',
  'principalId',
];

/**
 * What the kernel reads for a status watch: `effectStatusRule()`, the members of the view and the
 * plan's `where`, which binds the stream token to the submitter.
 */
export function effectStatusAuthority(
  plan: LiveEffectStatusPlan,
): LiveKernelAuthority & { readonly entity: string } {
  return { entity: plan.entity, rules: [effectStatusRule()], members, where: plan.where };
}
