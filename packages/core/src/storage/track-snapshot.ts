import type { EntityDescriptor } from './entity-descriptor.ts';
import type { FieldDescriptor } from './field-descriptor.ts';
import type { TableSpec } from './table-spec.ts';

/** The neutral description of one track's tables as of its last file (section 14.6.1). */
export interface TrackSnapshot {
  /** 'auth', 'auth->accounts', 'auth[accounts]'. */
  readonly track: string;
  /** The number of the track's last file. */
  readonly version: number;
  /** The columns, indexes and foreign keys this track owns. */
  readonly tables: readonly TableSpec[];
  readonly entities: Readonly<
    Record<
      string,
      {
        readonly history: EntityDescriptor['history'];
        readonly mergeState: boolean;
        readonly fields: Readonly<Record<string, FieldDescriptor>>;
        readonly renames: readonly {
          readonly from: string;
          readonly to: string;
          readonly file: string;
        }[];
        /** Domain event shapes and their versions. */
        readonly events: Readonly<Record<string, number>>;
        /** SHA-256 of the evolve source text (section 15.2.4). */
        readonly evolveHash: string;
      }
    >
  >;
}
