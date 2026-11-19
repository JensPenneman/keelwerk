/** A core.quota row as stored (S-142: the stored format is final). */
export interface QuotaRow {
  readonly id: string;
  /** `<dimension>@<backendId>@<tenantId>`. */
  readonly slot: string;
  /** A declared ref, or `queue:<q>.<running|queued|weight>`. */
  readonly dimension: string;
  readonly backendId: string;
  /** Never null in a written row; a row read with null is passed to `skipped` by the cache and ignored. */
  readonly tenantId: string | null;
  /** Null: no override (the row was set to 'default'). */
  readonly limit: string | null;
  readonly version: number;
}

/** `ControlStore.quotas`: the core.quota rows and their change subscription. */
export interface ControlQuotas {
  /** Every core.quota row, one read-only deployment unit, pages of 500 by id (as `ControlFlags.rows`). */
  rows(): Promise<readonly QuotaRow[]>;
  /** Wake-ups of the control namespace's feed (`adapter.feed.wake`), never data. */
  changes(signal: AbortSignal): AsyncIterable<unknown>;
}
