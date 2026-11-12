import type { ApiUsageQuery, ApiUsageTotal } from '../storage/api-usage-store.ts';
import type { Scope } from '../storage/scope.ts';

/** What a request is counted under; no address and no principal id (S-144). */
interface ApiUsageRequest {
  readonly scope: Scope;
  readonly apiVersion: string;
  readonly transport: string;
  /** '' for the version total; the head ref of a deprecated action. */
  readonly item: string;
}

/** `ControlStore.apiUsage`: the process's buffer of request counts and the kw_api_usage accessors. */
export interface ControlApiUsage {
  /** Buffers one count, no I/O: day = utcDayOf(store clock); deployment scope counts under backend = tenant = deploymentId, backend scope under tenant = backend (S-144). */
  record(request: ApiUsageRequest): void;
  /** Drains the buffer into one writing deployment-scope unit (`unit.apiUsage.add`, chunks of 1000 rows); on failure restores the counts and rethrows. Answers the rows written. */
  flush(): Promise<number>;
  /** `unit.apiUsage.totals` in one read-only deployment-scope unit. */
  read(query: ApiUsageQuery): Promise<readonly ApiUsageTotal[]>;
}
