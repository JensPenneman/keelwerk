import type { Condition } from '../conditions/condition.ts';

/** A read of one entity's rows. */
export interface RowQuery {
  /** The authorization plan is already conjoined; the scope predicate is added by the adapter. */
  readonly where?: Condition;
  readonly sort?: readonly { readonly field: string; readonly direction: 'asc' | 'desc' }[];
  readonly page?:
    | {
        readonly first?: number;
        readonly after?: string;
        readonly last?: number;
        readonly before?: string;
      }
    /** Capability `positionPaging`, bounded by `maxOffset`. */
    | { readonly position: number; readonly limit: number };
  /** Field mask; system fields are always returned. */
  readonly select?: readonly string[];
  /** Default false: `archivedAt` must be absent. */
  readonly includeArchived?: boolean;
  readonly total?: boolean;
  /** Lock the rows for the unit where supported; versions guard everywhere. */
  readonly forUpdate?: boolean;
  /** Read the scope counter in the same statement and return it as `RowPage.position` (S-19). */
  readonly positioned?: true;
}
