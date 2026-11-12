import type { StateToken } from '../events/state-token.ts';
import type { Id } from '../ids/id.ts';
import type { PlainEffectInputOf } from './plain-effect-input-of.ts';

/** The stored input of an effect part (M1's `'~types'.input`); `never` for anything else (S-177). */
export type EffectInputOf<E> = E extends { readonly '~types'?: { readonly input: infer I } }
  ? I
  : never;

/** One unsettled effect of a `performer: 'external'` declaration, as `ctx.live.effects` yields it (15.4.11). */
export interface PendingEffect<E> {
  readonly id: Id<'core.effect'>;
  /** The effect's reference. */
  readonly type: string;
  /** The plain members of the stored input (S-166). */
  readonly input: PlainEffectInputOf<E>;
  readonly deadline?: Temporal.Instant;
  /**
   * The resume position. An item emitted before `head` carries the state the stream was opened with,
   * or none on a fresh start; `head` holds the token that covers the batch.
   */
  readonly state?: StateToken;
}
