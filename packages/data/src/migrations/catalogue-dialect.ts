import type { ColumnSpec, Condition } from '@keelwerk/core';

/** What a dialect tells the neutral comparison about its types and predicates. */
export interface CatalogueDialect {
  /** The type text `introspect` reports for a column of this spec. */
  typeOf(column: ColumnSpec): string;
  /** Whether the live predicate text means the condition of a partial index. */
  samePredicate(condition: Condition, live: string): boolean;
}
