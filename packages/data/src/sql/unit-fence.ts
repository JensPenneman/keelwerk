import { AsyncLocalStorage } from 'node:async_hooks';
import { errors } from '@keelwerk/core';
import type { DatabaseConnection } from 'kysely';

/** The fence whose end work the running code belongs to. */
const endWork = new AsyncLocalStorage<UnitFence>();

/**
 * What stops work that outlives its unit. The code that races a unit's work against a deadline
 * abandons the loser, which keeps running; once the unit's function has settled the connection goes
 * back to its pool (or, on PGlite, to the next unit), so a statement of the abandoned work must reach
 * nothing. The fence is open while the unit's function runs, and closed from the moment it settles
 * for everything except the unit's own end work (`closing`: the commit tail), and from `finish`, once
 * the commit or the rollback is done, for everything. The end work is told
 * from other work by the async context it runs in, not by a counter, so abandoned work that sends
 * its statement while the tail runs is refused like any other statement after the end.
 */
export interface UnitFence {
  /** True while a statement of the caller's work may reach the connection. */
  open(): boolean;
  /** Throws `internal` when the fence is closed. */
  check(): void;
  /** The unit's function has settled: only the work run by `closing` passes from now on. */
  end(): void;
  /**
   * The unit has committed or rolled back and its connection is free: from now on the fence is closed
   * for every caller, the closing context included, so work that the commit tail started and did not
   * await is refused too.
   */
  finish(): void;
  /** Runs the unit's own end work (the commit tail): its statements, and only its, pass the closed fence. */
  closing<T>(work: () => Promise<T>): Promise<T>;
  /** A connection whose statements and streams are refused once the fence is closed. */
  connection(connection: DatabaseConnection): DatabaseConnection;
}

export function unitFence(): UnitFence {
  let ended = false;
  let finished = false;
  const open = (): boolean => !finished && (!ended || endWork.getStore() === fence);
  const check = (): void => {
    if (!open()) {
      throw errors.internal('the unit has ended; a statement of work that outlived it was refused');
    }
  };
  const fence: UnitFence = {
    open,
    check,
    end: () => {
      ended = true;
    },
    finish: () => {
      ended = true;
      finished = true;
    },
    closing: (work) => endWork.run(fence, work),
    connection: (connection) => ({
      executeQuery: async (query) => {
        check();
        return connection.executeQuery(query);
      },
      streamQuery: (query, chunkSize) => {
        check();
        return connection.streamQuery(query, chunkSize);
      },
    }),
  };
  return fence;
}
