import type { PostgresUrls } from './postgres-urls.ts';

/** The one PostgreSQL 18 container of the measurement, with `pg_stat_statements` loaded. */
export interface MeasuredPostgres extends PostgresUrls {
  /** The server's `select version()` text. */
  readonly version: string;
  /** Stops and removes the container. */
  stop(): Promise<void>;
}
