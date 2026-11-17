import type { Id } from '../ids/id.ts';
import type { EffectAttemptError } from './effect-attempt-error.ts';

/** The closed projection of a settled effect's error: never a message, retry hint or request id. */
export type EffectStatusError = Pick<EffectAttemptError, 'kind' | 'code'>;

/**
 * What the submitter of a command reads of an effect it requested (7.9.5): its id, type, status and
 * times, and for a failed or abandoned effect the closed code and kind. Never the input, the
 * continuation, the output, a key id, an attempt, the submitter reference or the command id.
 */
export interface EffectStatus {
  readonly id: Id<'core.effect'>;
  /** 'dispatch.ship'. */
  readonly type: string;
  readonly status: 'requested' | 'succeeded' | 'failed' | 'abandoned';
  /** When the decision requested it: the row's `createdAt`. */
  readonly requestedAt: Temporal.Instant;
  readonly runAt?: Temporal.Instant | undefined;
  readonly deadline?: Temporal.Instant | undefined;
  readonly settledAt?: Temporal.Instant | undefined;
  /** `failed` and `abandoned` only. */
  readonly error?: EffectStatusError | undefined;
}
