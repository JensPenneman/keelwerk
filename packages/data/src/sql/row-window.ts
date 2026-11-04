export interface RowWindow {
  /** Rows to ask for beyond the page size, so the next page's existence is known. */
  readonly limit: number | undefined;
  readonly offset: number;
  /** Fetch in reverse sort order and flip the rows back. */
  readonly backwards: boolean;
  /** The size of the page; `undefined` for no bound. */
  readonly size: number | undefined;
  readonly after: string | undefined;
  readonly before: string | undefined;
  readonly positional: boolean;
}
