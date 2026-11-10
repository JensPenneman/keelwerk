import type { StateToken } from '../events/state-token.ts';

/** The stored input of an effect part (M1's `'~types'.input`); `never` for anything else (S-177). */
export type EffectInputOf<E> = E extends { readonly '~types'?: { readonly input: infer I } }
  ? I
  : never;

/** One unsettled effect of a `performer: 'external'` declaration, as `ctx.live.effects` yields it (15.4.11). */
export interface PendingEffect<E> {
  readonly id: string;
  /** The effect's reference. */
  readonly type: string;
  readonly input: EffectInputOf<E>;
  readonly deadline?: Temporal.Instant;
  /** The resume position. */
  readonly state: StateToken;
}
