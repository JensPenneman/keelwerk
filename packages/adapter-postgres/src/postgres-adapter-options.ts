/** What `postgresAdapter` takes; every member is optional. */
export interface PostgresAdapterOptions {
  /** Tags the sessions in `pg_stat_activity`; default `keelwerk`. */
  readonly applicationName?: string;
}
