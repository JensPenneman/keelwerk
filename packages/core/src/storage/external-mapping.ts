/** History 'external' (M5): the existing table and its columns (section 14.8.4). */
export interface ExternalMapping {
  readonly schema: string | null;
  readonly table: string;
  /** Field name to column name. */
  readonly columns: Readonly<Record<string, string>>;
}
