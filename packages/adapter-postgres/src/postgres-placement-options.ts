/** The placement options the adapter validates at boot (`options` of `PlacementConfig`). */
export interface PostgresPlacementOptions {
  /** Sessions end a transaction left idle for longer than this; default 30000. */
  readonly idleInTransactionTimeoutMs: number;
  /** How long the pool waits for a new connection; default 10000. */
  readonly connectionTimeoutMs: number;
}
