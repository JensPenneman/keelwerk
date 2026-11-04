/** One PostgreSQL 18 container, reachable over TCP, with an application role in place. */
export interface RunningPostgres {
  /** Connection URL of the container's superuser: schema, seeding and inspection of the catalogue. */
  readonly adminUrl: string;
  /** Connection URL of the adapter's role: no superuser and no BYPASSRLS, so forced row-level security applies. */
  readonly appUrl: string;
  /** The server's `select version()` text. */
  readonly version: string;
  /** Stops and removes the container. */
  stop(): Promise<void>;
}
