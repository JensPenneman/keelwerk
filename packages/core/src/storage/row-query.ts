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
  /**
   * Default false: an erased tombstone (`kwErasedAt` set) is invisible, `includeArchived` included
   * (14.7.2). For the kernel only: no wire input, filter, hop or watch and no call of a module can
   * set it (a module's `QuerySpec` and a transport's input have no such member, and the generated
   * reads take their flags by name). The kernel sets it where it must see a tombstone: the erasure
   * (the lookups of owned rows and of the stream to erase), the history read of an erased row, the
   * walk of a data-subject path through an erased row and the live hub, which tells an erased row
   * from a purged one. The row then carries `kwErasedAt`.
   */
  readonly includeErased?: boolean;
  readonly total?: boolean;
  /** Lock the rows for the unit where supported; versions guard everywhere. */
  readonly forUpdate?: boolean;
  /** Read the scope counter in the same statement and return it as `RowPage.position` (S-19). */
  readonly positioned?: true;
}
