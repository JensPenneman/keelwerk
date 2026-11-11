import type { HeldJob } from './held-job.ts';

/**
 * Renews the leases of the due attempts (9.5.4, D3): one `heartbeat` statement per namespace and
 * lease length, each in a namespace-scope unit of its own, the namespaces concurrently, so a slow
 * namespace never holds another's renewal. Answers the attempts whose lease was lost; the others
 * are renewed at `now`. A group that fails is not lost: its attempts stay due and the next tick
 * asks again, and `onError` hears of it.
 */
export async function renewLeases(
  due: readonly HeldJob[],
  worker: string,
  now: Temporal.Instant,
  onError?: (error: unknown) => void,
): Promise<readonly HeldJob[]> {
  const groups = new Map<string, HeldJob[]>();
  for (const held of due) {
    const key = `${held.source.handle.adapter.placementId}/${held.source.namespace.id}/${held.leaseMs}`;
    groups.set(key, [...(groups.get(key) ?? []), held]);
  }
  const lost: HeldJob[] = [];
  await Promise.all(
    [...groups.values()].map(async (group) => {
      const [first] = group;
      if (first === undefined) return;
      try {
        const alive = await first.source.handle.adapter.unit(
          first.source.namespace,
          { level: 'namespace', reason: 'jobs' },
          (unit) =>
            unit.jobs.heartbeat(
              group.map((held) => held.job.stored.attempt),
              worker,
              first.leaseMs,
            ),
        );
        const kept = new Set(alive.map((attempt) => `${attempt.jobId}/${attempt.attempt}`));
        for (const held of group) {
          const { attempt } = held.job.stored;
          if (kept.has(`${attempt.jobId}/${attempt.attempt}`)) held.renewedAt = now;
          else lost.push(held);
        }
      } catch (error) {
        onError?.(error);
      }
    }),
  );
  return lost;
}
