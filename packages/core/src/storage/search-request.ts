import type { Condition } from '../conditions/condition.ts';
import type { RowQuery } from './row-query.ts';

/** Capability `search`. A keyed token index over personal fields receives tags, never words (section 14.7.9.9). */
export interface SearchRequest {
  /** A name from the entity's searchIndexes. */
  readonly index: string;
  readonly match: /** A plaintext search index. */
    | { readonly text: string }
    /** Per query word, its field-qualified tags: any matches, every word must. */
    | {
        readonly terms: readonly (readonly {
          readonly field: string;
          readonly tag: bigint;
        }[])[];
      };
  /** Indexes with `keys: 'subject'`: the one pinned data subject (for mail, the account). */
  readonly subject?: string;
  /** The plan and the other conditions, as in `RowQuery`. */
  readonly where?: Condition;
  readonly page?: RowQuery['page'];
}
