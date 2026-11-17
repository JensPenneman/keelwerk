import type { ConditionInput } from '../conditions/condition-input.ts';
import type { EffectDraft } from './effect-draft.ts';

/**
 * `settle(effect, outcome, options?)`: the `settled` record of an effect with an external performer,
 * and its continuation. The optional third parameter `{ effect, where? }` ties the settle to its
 * performer: `effectType` is the reference of `options.effect` and `where` the object-form condition
 * over the plain input. A settle that does not match (the id is of another effect or module, or the
 * decoded plain input does not satisfy the `where`) answers `not_found`, as an unknown id does, before
 * the performer, the status and the outcome are looked at.
 */
export interface SettleEffect extends EffectDraft<never> {
  readonly kind: 'settle';
  /** The effect id. */
  readonly effect: string;
  readonly outcome: unknown;
  /** The reference of the effect the settle names (`SettleOptions.effect`); another type answers `not_found`. */
  readonly effectType?: string;
  /** The object-form `where` over the plain input, normalised and evaluated by the kernel. */
  readonly where?: ConditionInput;
}
