import { normalizeRule } from '../authorization/normalize-rule.ts';
import type { NormalizedRule } from '../authorization/normalized-rule.ts';

/**
 * The only rule a pending-effects view is compiled from: allow `watch` on `core.effect` where `type`
 * is the effect, `performer` is `external` and `status` is `requested`; id
 * `core.pendingEffects.<effect>`, module `core`, any principal. The subscription action's own gate
 * decides who may follow; this rule only bounds which rows the kernel reads for it.
 */
export function pendingEffectsRule(effect: string): NormalizedRule {
  return normalizeRule({
    id: `core.pendingEffects.${effect}`,
    module: 'core',
    effect: 'allow',
    subject: { module: 'core', entity: 'effect' },
    actions: ['watch'],
    where: () => ({ type: effect, performer: 'external', status: 'requested' }),
    disabled: false,
  });
}
