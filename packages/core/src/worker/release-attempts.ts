import type { StoredJob } from '../storage/stored-job.ts';
import type { HeldJob } from './held-job.ts';

/**
 * An attempt a worker holds and may give back: a running `HeldJob`, or a batch taken and never
 * started.
 */
export type HeldAttempt = Pick<HeldJob, 'source'> & {
  readonly job: { readonly stored: StoredJob };
};

/**
 * Releases the attempts a draining fetcher holds, running or taken and never started (21.6 step 4):
 * one `jobs.release` per placement and namespace, each in a namespace-scope unit
 * (`reason: 'jobs'`), the namespaces concurrently, grouped like `renewLeases`. Answers how many were
 * released; a namespace whose unit fails goes to `onError` and its attempts are left to their
 * leases.
 */
export async function releaseAttempts(
  held: readonly HeldAttempt[],
  worker: string,
  onError?: (error: unknown) => void,
): Promise<number> {
  const groups = new Map<string, HeldAttempt[]>();
  for (const entry of held) {
    const key = `${entry.source.handle.adapter.placementId}/${entry.source.namespace.id}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const counts = await Promise.all(
    [...groups.values()].map(async (group) => {
      const [first] = group;
      if (first === undefined) return 0;
      try {
        const released = await first.source.handle.adapter.unit(
          first.source.namespace,
          { level: 'namespace', reason: 'jobs' },
          (unit) =>
            unit.jobs.release(
              group.map((entry) => entry.job.stored.attempt),
              worker,
            ),
        );
        return released.length;
      } catch (error) {
        onError?.(error);
        return 0;
      }
    }),
  );
  return counts.reduce((sum, count) => sum + count, 0);
}
