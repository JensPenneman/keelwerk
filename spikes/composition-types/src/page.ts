/** A page of rows with cursor pagination (section 16.4.3). */
export interface Page<R> {
  readonly items: readonly R[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
  readonly queryState: string;
}
