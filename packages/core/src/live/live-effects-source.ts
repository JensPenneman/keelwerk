import type { Condition } from '../conditions/condition.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';

/** The leaf of a `ctx.live.effects` description: the pending effects of one own external effect (15.4.2). */
export interface LiveEffectsSource {
  readonly kind: 'effects';
  /** 'dispatch.ship'. */
  readonly effect: string;
  /** `plainInputMembers` of the effect: what a pending effect's input carries. */
  readonly plain: readonly string[];
  /** The registry entry of the effect: its input fields decode the plain members. */
  readonly entry: EffectEntry;
  readonly where?: Condition;
  readonly after?: string;
}
