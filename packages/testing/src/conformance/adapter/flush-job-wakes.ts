import type { JobWakeTap } from './job-wake-tap.ts';

/**
 * Waits until a reader has acted on every wake-up that commits made before the call. A commit in a
 * queue of its own (`touch`) is followed by the wake-up that names it, and wake-ups reach a reader in
 * the order of the commits, so nothing older comes after it; the reader's next request for a wake-up
 * shows that it has acted on that one. A feed that opens its session late (PostgreSQL) loses a commit
 * made before it listened and answers with a wake-up that names no queue: the commit is repeated.
 */
export async function flushJobWakes(
  tap: JobWakeTap,
  touch: (queue: string) => Promise<void>,
): Promise<void> {
  for (;;) {
    const marker = `marker-${crypto.randomUUID()}`;
    await touch(marker);
    for (;;) {
      const wake = await tap.next();
      if (wake.queues?.includes(marker) === true) {
        await tap.processed();
        return;
      }
      if (wake.queues === undefined) break;
    }
  }
}
