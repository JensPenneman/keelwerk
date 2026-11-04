import type { EffectDraft } from './effect-draft.ts';

/** `setTimer({ key, at or after, invoke, input })`: a keyed timer job (section 9.5.1). */
export interface SetTimerEffect extends EffectDraft<never> {
  readonly kind: 'setTimer';
  readonly key: string;
  readonly at?: Temporal.Instant;
  /** A duration such as '45s'. */
  readonly after?: string;
  readonly action: string;
  readonly input: unknown;
}
