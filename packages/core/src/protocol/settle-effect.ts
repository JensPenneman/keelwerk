import type { EffectDraft } from './effect-draft.ts';

/** `settle(effect, outcome)`: the `settled` record of an effect with an external performer, and its continuation. */
export interface SettleEffect extends EffectDraft<never> {
  readonly kind: 'settle';
  /** The effect id. */
  readonly effect: string;
  readonly outcome: unknown;
}
