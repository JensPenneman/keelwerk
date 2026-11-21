import type { ClientConfig } from 'pg';

/** One PostgreSQL 18 container with the spike's schema in place. */
export interface RunningPostgres {
  /** The container's superuser: schema, seeding and sampling of pg_stat_activity. */
  readonly admin: ClientConfig;
  /** The adapter's role: no superuser and no BYPASSRLS, so forced row-level security applies. */
  readonly app: ClientConfig;
  readonly version: string;
  /** The container's id, with which the shared deadlock rule reads the counter of the testing package. */
  readonly containerId: string;
  stop(): Promise<void>;
}
