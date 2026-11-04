/** One entry of a row's history. */
export interface HistoryEntry<R> {
  readonly version: number;
  readonly type: string;
  readonly at: Temporal.Instant;
  readonly changes: { readonly [K in keyof R]?: { readonly before: R[K]; readonly after: R[K] } };
}
