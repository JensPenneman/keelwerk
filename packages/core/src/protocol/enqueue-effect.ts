import type { EffectDraft } from './effect-draft.ts';

/** `enqueue(action, input, { runAt?, key?, commandId? })`: a command job committed with the unit, any scope. */
export interface EnqueueEffect extends EffectDraft<never> {
  readonly kind: 'enqueue';
  readonly action: string;
  readonly input: unknown;
  readonly runAt?: Temporal.Instant;
  readonly key?: string;
  readonly commandId?: string;
}
