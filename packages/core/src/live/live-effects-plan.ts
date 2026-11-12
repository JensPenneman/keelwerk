import type { Condition } from '../conditions/condition.ts';
import type { StateToken } from '../events/state-token.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import type { WatchInput } from './watch-input.ts';

/** What a `ctx.live.effects` subscription follows: the `core.effect` rows of one effect under the kernel's authority, resumed from `after`. */
export interface LiveEffectsPlan {
  readonly kind: 'effects';
  readonly entity: 'core.effect';
  readonly effect: string;
  readonly plain: readonly string[];
  /** The registry entry of the effect: its input fields decode the plain members. */
  readonly entry: EffectEntry;
  readonly where: Condition | undefined;
  /** `{ from: 'beginning' }`, one object per plan: `prepare` and the hub must see the same input object. */
  readonly input: WatchInput<unknown>;
  readonly after: StateToken | undefined;
  readonly maps: readonly ((item: unknown) => unknown)[];
}
