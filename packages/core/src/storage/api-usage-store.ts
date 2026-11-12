/** One kw_api_usage row (S-144). `day` is `YYYY-MM-DD` UTC; `item` '' is the version total. */
export interface ApiUsageCount {
  readonly day: string;
  readonly backendId: string;
  readonly tenantId: string;
  readonly apiVersion: string;
  readonly transport: string;
  readonly item: string;
  readonly count: number;
}

/** Days `since` to `until`, both included. */
export interface ApiUsageQuery {
  readonly since: string;
  readonly until: string;
  readonly backendId?: string;
  readonly apiVersion?: string;
  readonly item?: string;
  readonly limit: number;
}

/** The counts of one (backend, tenant, version, transport, item) summed over the days. */
export interface ApiUsageTotal {
  readonly backendId: string;
  readonly tenantId: string;
  readonly apiVersion: string;
  readonly transport: string;
  readonly item: string;
  readonly count: number;
  readonly firstDay: string;
  readonly lastDay: string;
}

/** kw_api_usage in the control root; on deployment-scope units only. */
export interface ApiUsageStore {
  /** Adds each count to its row (insert, or add to the stored count), rows in key order; writing units only (`internal` in a read-only unit). */
  add(counts: readonly ApiUsageCount[]): Promise<void>;
  /** Grouped and ordered by backendId, tenantId, apiVersion, transport, item; at most `limit`. */
  totals(query: ApiUsageQuery): Promise<readonly ApiUsageTotal[]>;
}
