/** One PostgreSQL 18 container, reachable over TCP, with an application role in place. */
export interface RunningPostgres {
  /** Connection URL of the container's superuser: schema, seeding and inspection of the catalogue. */
  readonly adminUrl: string;
  /** Connection URL of the adapter's role: no superuser and no BYPASSRLS, so forced row-level security applies. */
  readonly appUrl: string;
  /** The server's `select version()` text. */
  readonly version: string;
  /** The container's id: `execInContainer` runs the image's client tools (`pg_dump`, `pg_restore`) in it from another process. */
  readonly containerId: string;
  /**
   * Stops and removes the container, after the server shows no client connection left open. When
   * one is still shown by a listing started after two seconds it rejects, naming each, and leaves the container running
   * for the reaper: stopping it would end those connections with an error nobody handles. Unless it was started with
   * `checkDeadlocks: false`, the container is stopped first, and then the call rejects when its
   * deadlock counter moved by other than the deadlocks the file declared, or when the file declared
   * deadlocks and started more than one container with the check.
   */
  stop(): Promise<void>;
}
