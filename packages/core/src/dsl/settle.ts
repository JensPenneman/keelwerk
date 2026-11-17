import type { ConditionInput } from '../conditions/condition-input.ts';
import type { Id } from '../ids/id.ts';
import type { EffectOutcome } from '../model/effect-outcome.ts';
import type { SettleEffect } from '../protocol/settle-effect.ts';
import type { AnyEffectPart } from './define-effect.ts';
import { refOf } from './ref-of.ts';
import type { SettleOptions } from './settle-options.ts';

/**
 * Settles an effect with an external performer: the `settled` record and its continuation (section
 * 7.9.5). The optional third parameter ties the settle to its performer: `effect` is the effect the
 * id must be of, and `where` is the `where` of `ctx.live.effects` over the effect's plain input. An
 * effect of another type, or one whose input does not match, answers `not_found` as an unknown id.
 */
export function settle<O, E extends AnyEffectPart = AnyEffectPart>(
  effect: Id<'core.effect'>,
  outcome: EffectOutcome<O>,
  options?: SettleOptions<E>,
): SettleEffect {
  return Object.freeze({
    kind: 'settle',
    type: 'settle',
    effect,
    outcome,
    ...(options === undefined ? {} : { effectType: refOf(options.effect) }),
    ...(options?.where === undefined ? {} : { where: options.where as unknown as ConditionInput }),
  });
}
