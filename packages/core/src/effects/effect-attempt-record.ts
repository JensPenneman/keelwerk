import type { EffectAttemptError } from './effect-attempt-error.ts';

/** One record of the stream `core.effectAttempt`, keyed by effect id (7.9.6). */
export interface EffectAttemptRecord {
  readonly process: string;
  readonly build: string;
  /** 1-based. */
  readonly attempt: number;
  /** An ISO instant. */
  readonly startedAt: string;
  /** An ISO instant. */
  readonly endedAt?: string;
  /** The closed projection of the failure (code and status), not the full error. */
  readonly error?: EffectAttemptError;
}
