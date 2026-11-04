import type { TableSpec } from './table-spec.ts';

/** A live catalogue, as `introspect` reads it. */
export interface Catalogue {
  readonly tables: readonly TableSpec[];
}
