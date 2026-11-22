import type { RunningPostgres } from './running-postgres.ts';

/**
 * A PostgreSQL container whose server can be stopped and started again while the container, its
 * data and its host port stay (`startPostgres({ restartable: true })`). Restarting the container
 * itself would empty the data directory (it is on tmpfs) and may give it a new host port.
 */
export interface RestartablePostgres extends RunningPostgres {
  /**
   * Shuts the server down fast (`pg_ctl stop -m fast`): every connection ends. Resolves when the
   * server has stopped. Reads the deadlock counter first.
   */
  stopServer(): Promise<void>;
  /**
   * Starts the server again on the same data and port. Resolves when it accepts connections;
   * rejects when the deadlock counter is lower than `stopServer` read it, so a reset of the
   * statistics can never pass unseen. `stop` needs the server running: it lists the connections
   * through it.
   */
  startServer(): Promise<void>;
}
