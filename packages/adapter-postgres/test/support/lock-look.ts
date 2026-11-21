import type pg from 'pg';
import { pause } from './job-store-fixtures.ts';

/** A connection of the database owner, as `eventHarness` hands it out. */
type Owner = <T>(work: (client: pg.Client) => Promise<T>) => Promise<T>;

/**
 * Looks at the server for the unit `taggedUnit` named `job-store:<label>`: whether its backend waits
 * for a lock of any kind (an advisory lock or a row, `wait_event_type = 'Lock'`), the one state a
 * unit that is held back by another open unit can be in.
 */
export function lockLook(owner: Owner): {
  /** The kind of lock the unit waits for, or undefined when a look shows no wait. */
  readonly waiting: (label: string) => Promise<string | undefined>;
  /**
   * Goes on when the unit under test has ended, or when a look shows its backend waiting on a lock:
   * the two states it can be in while the other unit is open. A look that shows neither proves
   * nothing and leads to another look; the pause only spaces them. Answers whether the wait was seen.
   */
  readonly untilEndedOrWaits: (ended: () => boolean, label: string) => Promise<boolean>;
} {
  const waiting = async (label: string): Promise<string | undefined> => {
    const [row] = await owner(
      async (client) =>
        (
          await client.query(
            `select wait_event from pg_stat_activity
             where datname = current_database() and application_name = $1 and wait_event_type = 'Lock'`,
            [`kwtest:job-store:${label}`],
          )
        ).rows,
    );
    return row?.wait_event === undefined ? undefined : String(row.wait_event);
  };
  return {
    waiting,
    untilEndedOrWaits: async (ended, label) => {
      while (!ended()) {
        if ((await waiting(label)) !== undefined) return true;
        await pause(5);
      }
      return false;
    },
  };
}
