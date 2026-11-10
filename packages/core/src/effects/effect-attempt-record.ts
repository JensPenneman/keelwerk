import type { WireError } from '../errors/wire-error.ts';

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
  readonly error?: WireError;
}
