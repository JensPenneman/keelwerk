import type { IdOf } from './id-of.ts';

/**
 * One change of an entity row, as `watch` and `ctx.live.entity` deliver it (15.4.2, S-170).
 * `version` is the row's version after the change and `cause` the domain event behind it, without
 * its data. `removed` carries no row; its reasons are those of the sync protocol's `RowChange`.
 */
export type EntityChange<R> =
  | {
      readonly type: 'created' | 'changed' | 'restored';
      readonly id: IdOf<R>;
      readonly version: number;
      readonly cause?: string;
      readonly row: R;
    }
  | {
      readonly type: 'archived';
      readonly id: IdOf<R>;
      readonly version: number;
      readonly cause?: string;
      readonly row?: R;
    }
  | {
      readonly type: 'removed';
      readonly id: IdOf<R>;
      readonly reason: 'left-view' | 'purged' | 'erased';
    };
