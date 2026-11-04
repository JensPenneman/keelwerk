import type { EffectDraft } from './effect-draft.ts';

/** An effect declared with `defineEffect` and constructed by value (section 7.9.5); `O` is its output. */
export interface ExternalEffect<O = unknown> extends EffectDraft<O> {
  readonly kind: 'external';
  readonly input: unknown;
  /** The module's own action that receives the outcome. */
  readonly continueWith?: string;
  /** Entity continuations get the target id through `with`. */
  readonly with?: Readonly<Record<string, unknown>>;
  readonly key?: string;
  readonly runAt?: Temporal.Instant;
  readonly deadline?: Temporal.Instant;
}
