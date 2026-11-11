import type { StateToken } from '../events/state-token.ts';
import type { WatchInput } from './watch-input.ts';

/** What a subscription follows: one entity's changes under an input, and what is done to each item. */
export interface LiveSourcePlan {
  /** 'loans.loan'. */
  readonly entity: string;
  readonly input: WatchInput<unknown>;
  /** The token the stream resumes from. */
  readonly after: StateToken | undefined;
  /** Applied to each item in array order; an answer of `undefined` drops the item. */
  readonly maps: readonly ((item: unknown) => unknown)[];
}
