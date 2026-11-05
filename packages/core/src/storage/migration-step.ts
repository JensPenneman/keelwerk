import type { ColumnSpec } from './column-spec.ts';
import type { ForeignKeySpec } from './foreign-key-spec.ts';
import type { IndexSpec } from './index-spec.ts';
import type { TableSpec } from './table-spec.ts';

/** A neutral step (section 14.6.2); adapters render and apply, they do not plan. */
export type MigrationStep =
  | { readonly op: 'createTable'; readonly entity: string; readonly table: TableSpec }
  /** Contract step. */
  | { readonly op: 'dropTable'; readonly entity: string }
  | {
      readonly op: 'addColumn';
      readonly entity: string;
      readonly field: string;
      readonly column: ColumnSpec;
    }
  /** Contract step. */
  | {
      readonly op: 'dropColumn';
      readonly entity: string;
      readonly field: string;
      /** The physical columns that go; absent: the field's own column (and a CRDT field's value column). */
      readonly columns?: readonly string[];
    }
  | {
      readonly op: 'alterColumn';
      readonly entity: string;
      readonly field: string;
      readonly from: ColumnSpec;
      readonly to: ColumnSpec;
    }
  /** Data step: a rename's or a split's backfill, batched after finalization. */
  | {
      readonly op: 'copyColumn';
      readonly entity: string;
      readonly from: string;
      readonly to: string;
    }
  | { readonly op: 'createIndex' | 'dropIndex'; readonly entity: string; readonly index: IndexSpec }
  | {
      readonly op: 'addForeignKey' | 'dropForeignKey';
      readonly entity: string;
      readonly key: ForeignKeySpec;
    }
  /** M6: adds kw_merge, then a rebuild. */
  | { readonly op: 'enableMergeState'; readonly entity: string }
  /** Re-project from the log. */
  | { readonly op: 'rebuild'; readonly entity: string; readonly reason: string }
  | {
      readonly op: 'sql';
      readonly statements: Readonly<
        Partial<Record<'postgres' | 'mysql' | 'sqlite', readonly string[]>>
      >;
    };
