import type { RetentionRun } from '../control/retention-run.ts';

/** The scope whose runs `RetentionRunStore.list` reads. */
export interface RetentionRunQuery {
  readonly backendId: string;
  readonly tenantId: string | null;
  readonly limit: number;
}

/** kw_retention_runs in the control root; deployment-scope units only; append only. */
export interface RetentionRunStore {
  /** Inserts the row; `internal` in a read-only unit. */
  append(run: RetentionRun): Promise<void>;
  /** The scope's runs, newest `startedAt` first, at most `limit` (`validation` outside 1..1000). */
  list(query: RetentionRunQuery): Promise<readonly RetentionRun[]>;
}
