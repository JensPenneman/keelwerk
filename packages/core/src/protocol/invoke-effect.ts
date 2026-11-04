import type { EffectDraft } from './effect-draft.ts';

/** `invoke(action, input, { as?, prefer? })`: a command of the same scope, in a savepoint after this decision's events. */
export interface InvokeEffect extends EffectDraft<never> {
  readonly kind: 'invoke';
  readonly action: string;
  readonly input: unknown;
  /** `system(reason)`: runs as the system principal, logged with the reason. */
  readonly as?: { readonly kind: 'system'; readonly reason: string };
  readonly prefer?: 'sync' | 'async';
}
