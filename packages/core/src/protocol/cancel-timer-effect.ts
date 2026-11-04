import type { EffectDraft } from './effect-draft.ts';

/** `cancelTimer(key)`. */
export interface CancelTimerEffect extends EffectDraft<never> {
  readonly kind: 'cancelTimer';
  readonly key: string;
}
