/** Pagination of an entity's generated `query` (section 16.2.2). */
export interface PageSpec {
  readonly sortable: readonly string[];
  readonly defaultSort: readonly {
    readonly field: string;
    readonly direction: 'asc' | 'desc';
  }[];
  readonly defaultSize: number;
  readonly maxSize: number;
}
