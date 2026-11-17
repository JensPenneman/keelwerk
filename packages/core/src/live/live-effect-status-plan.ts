import type { Condition } from '../conditions/condition.ts';
import type { StateToken } from '../events/state-token.ts';
import type { WatchInput } from './watch-input.ts';

/** What a status watch follows: the `core.effect` rows of its ids under the kernel's authority, shown only where `where` holds, resumed from `after`. */
export interface LiveEffectStatusPlan {
  readonly kind: 'effectStatus';
  readonly entity: 'core.effect';
  /** `{ ids, from: 'beginning' }`, one object per plan: `prepare` and the hub must see the same input object. */
  readonly input: WatchInput<unknown>;
  /** `neverCondition` as `planLiveSource` answers it; the setup sets the caller's `submitterCondition`. */
  readonly where: Condition;
  readonly after: StateToken | undefined;
  /** Applied to each item in array order; an answer of `undefined` drops the item. */
  readonly maps: readonly ((item: unknown) => unknown)[];
}
