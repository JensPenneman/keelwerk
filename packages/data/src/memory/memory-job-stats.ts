import type { WorkClassStats } from '@keelwerk/core';
import { memoryJobScopes } from './memory-job-scopes.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/**
 * Statistics per queue and capability set from the lane tables (21.4). Arrivals are the jobs
 * created in the last minute over sixty seconds; the mean run time comes from the history of
 * the queue; the SLO is the queue's configuration, which the store does not hold, so it is 0.
 */
export function memoryJobStats(ctx: MemoryUnitContext, queue?: string): readonly WorkClassStats[] {
  const now = ctx.clock.now();
  const minuteAgo = now.subtract({ seconds: 60 }).epochMilliseconds;
  const classes = new Map<string, WorkClassStats>();
  for (const tables of memoryJobScopes(ctx)) {
    const histories = [...tables.history().values()];
    for (const lane of tables.lanes().values()) {
      if (queue !== undefined && lane.queue !== queue) continue;
      const key = `${lane.queue}\u0000${lane.capabilitySet}`;
      const before = classes.get(key);
      const jobs = [...tables.jobs().values()].filter(
        (job) => job.laneKey === `${lane.queue}\u0000${lane.capabilitySet}\u0000${lane.priority}`,
      );
      const due = jobs.filter(
        (job) => job.state === 'available' && Temporal.Instant.compare(job.runAt, now) <= 0,
      );
      const ran = histories.filter((row) => row.queue === lane.queue && row.startedAt !== null);
      const meanRunSeconds =
        ran.length === 0
          ? 0
          : ran.reduce(
              (total, row) =>
                total +
                (row.finishedAt.epochMilliseconds - (row.startedAt?.epochMilliseconds ?? 0)) / 1000,
              0,
            ) / ran.length;
      const waits = due.map((job) => (now.epochMilliseconds - job.runAt.epochMilliseconds) / 1000);
      const upcoming = jobs
        .filter((job) => job.state === 'scheduled' || job.state === 'available')
        .map((job) => job.runAt)
        .sort((a, b) => Temporal.Instant.compare(a, b))
        .at(0);
      const arrivals = jobs.filter(
        (job) => job.spec.createdAt.epochMilliseconds >= minuteAgo,
      ).length;
      classes.set(key, {
        queue: lane.queue,
        capabilities: lane.capabilitySet === '' ? [] : lane.capabilitySet.split(','),
        due: (before?.due ?? 0) + due.length,
        oldestDueSeconds: Math.max(before?.oldestDueSeconds ?? 0, ...waits),
        arrivalsPerSecond: (before?.arrivalsPerSecond ?? 0) + arrivals / 60,
        meanRunSeconds: Math.max(before?.meanRunSeconds ?? 0, meanRunSeconds),
        running: (before?.running ?? 0) + (lane.taken - lane.done),
        nextDueAt:
          before?.nextDueAt == null ||
          (upcoming !== undefined && Temporal.Instant.compare(upcoming, before.nextDueAt) < 0)
            ? (upcoming ?? before?.nextDueAt ?? null)
            : before.nextDueAt,
        sloSeconds: 0,
      });
    }
  }
  return [...classes.values()].sort(
    (a, b) =>
      a.queue.localeCompare(b.queue) || a.capabilities.join().localeCompare(b.capabilities.join()),
  );
}
