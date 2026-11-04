/**
 * A kernel or external effect a decision requests; `O` is the outcome value of external effects.
 * `kind` names the effect variant (S-50).
 */
export interface EffectDraft<O = unknown> {
  readonly kind: 'invoke' | 'enqueue' | 'setTimer' | 'cancelTimer' | 'settle' | 'external';
  readonly type: string;
  readonly '~output'?: O;
}
