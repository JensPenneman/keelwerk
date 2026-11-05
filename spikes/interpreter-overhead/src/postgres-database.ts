import type { PostgresUrls } from './postgres-urls.ts';

/** One empty database on the measurement container. */
export interface PostgresDatabase {
  readonly name: string;
  readonly urls: PostgresUrls;
  /** Drops the database. */
  drop(): Promise<void>;
}
