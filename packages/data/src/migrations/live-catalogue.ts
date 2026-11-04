import type { Catalogue } from '@keelwerk/core';

/**
 * A catalogue as `introspect` reads it, with what `TableSpec` cannot hold: the exact type of each
 * column (`table.column` to its type text), the row-level security policies per table, whether
 * row-level security is enabled and forced on each table, and the predicate text of each partial
 * index by index name.
 */
export interface LiveCatalogue extends Catalogue {
  readonly types?: Readonly<Record<string, string>>;
  readonly policies?: Readonly<Record<string, readonly string[]>>;
  readonly security?: Readonly<
    Record<string, { readonly enabled: boolean; readonly forced: boolean }>
  >;
  readonly predicates?: Readonly<Record<string, string>>;
}
