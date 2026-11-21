/**
 * Pool settings for the placement of a test (`placement.pool`): pg-pool removes a client that sat
 * idle for 10 000 ms, so a pool that a test never ended would close its own connection unseen when
 * its last use lay long before the file's teardown, and the guard of `guardClientConnections`
 * would pass. With the removal off, such a pool keeps its client until it is ended, and the guard
 * fails on it every time. Spread it into `pool` next to `max`.
 */
export const keepIdleClients = { idleTimeoutMs: 0 } as const;
