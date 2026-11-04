import type { ColumnSpec } from './column-spec.ts';
import type { ForeignKeySpec } from './foreign-key-spec.ts';
import type { IndexSpec } from './index-spec.ts';

/** A dialect-neutral table. */
export interface TableSpec {
  /** Physical name inside the namespace root. */
  readonly name: string;
  readonly columns: readonly ColumnSpec[];
  readonly primaryKey: readonly string[];
  readonly indexes: readonly IndexSpec[];
  readonly foreignKeys: readonly ForeignKeySpec[];
  /** The scope column and its row-level security policy. */
  readonly scoped: 'tenant' | 'backend' | 'deployment';
}
