import type { ConditionInput } from '../conditions/condition-input.ts';
import type { RowQuery } from '../storage/row-query.ts';

/** What `ctx.target.query(...)` and `ctx.load.<m>.<e>.query(...)` build (section 7.9.2). */
export interface QueryDescription {
  readonly entity: string;
  readonly where?: ConditionInput;
  readonly sort?: NonNullable<RowQuery['sort']>;
  readonly page?: NonNullable<RowQuery['page']>;
  /** A bounded scan over personal fields; `partial` accepts a truncated result. */
  readonly scan?: { readonly limit: number; readonly partial: boolean };
  /** The search form; its tags only the kernel computes (section 14.7.9). */
  readonly search?: {
    readonly index: string;
    readonly text: string;
    readonly subject?: string;
  };
}
