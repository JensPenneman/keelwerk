/** A dialect-neutral foreign key. */
export interface ForeignKeySpec {
  readonly name: string;
  readonly columns: readonly string[];
  readonly references: { readonly table: string; readonly columns: readonly string[] };
}
