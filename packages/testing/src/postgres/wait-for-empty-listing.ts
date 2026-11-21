import { setTimeout as delay } from 'node:timers/promises';

/** What `waitForEmptyListing` takes; both seams exist for the tests of the wait itself. */
export interface EmptyListingOptions {
  /** The grace: a listing that started before this many milliseconds have passed never decides a failure. */
  readonly timeoutMs: number;
  /** The pause between two listings; default 100. */
  readonly pollMs?: number;
  /** The clock; default `Date.now`. */
  readonly now?: () => number;
  /** The pause; default a timer. */
  readonly pause?: (ms: number) => Promise<void>;
}

/**
 * Lists until a listing comes back empty and returns that empty list; returns the entries of a
 * listing that was started at or after the deadline (`timeoutMs` after the call) and still shows
 * something. The start of each listing is read before it runs, so a listing that is slower than
 * the bound (a loaded machine) never fails the wait by itself: only a listing that began after the
 * grace ran out decides. `timeoutMs` is therefore a minimum grace, not a limit on wall time; a
 * listing that hangs is capped by the timeout of the hook that calls this. Shared by the
 * connection guard and by tests that wait for the backends of one adapter to go.
 */
export async function waitForEmptyListing<T>(
  list: () => Promise<readonly T[]>,
  options: EmptyListingOptions,
): Promise<readonly T[]> {
  const now = options.now ?? Date.now;
  const pause = options.pause ?? ((ms: number) => delay(ms));
  const deadline = now() + options.timeoutMs;
  while (true) {
    const startedAt = now();
    const listed = await list();
    if (listed.length === 0 || startedAt >= deadline) return listed;
    await pause(options.pollMs ?? 100);
  }
}
