import type { DataAdapter, JobOutcome, StoredJobSpec } from '@keelwerk/core';

/** What a test sees and does to the reaction jobs of a running runtime. */
export interface ReactionJobs {
  /** Lets the workers take reaction jobs again; the caller then settles. */
  release(): void;
  /** Every reaction job enqueued since the watch started, as stored. */
  readonly enqueued: StoredJobSpec[];
  /** How every attempt of a reaction job ended, in order. */
  readonly outcomes: JobOutcome[];
}

/**
 * Watches the jobs of the `reactions` queue of a running runtime, and, until `release`, makes the
 * workers take none of them (the other queues run), so a test can change what a queued job will
 * find when it runs. The adapter object the kernel holds is changed in place, so the hold starts at
 * once and ends with the runtime. `held: false` only watches.
 */
export function holdReactionJobs(adapter: DataAdapter, held = true): ReactionJobs {
  let holding = held;
  const enqueued: StoredJobSpec[] = [];
  const outcomes: JobOutcome[] = [];
  const target = adapter as { unit: DataAdapter['unit'] };
  const inner = target.unit.bind(adapter);
  target.unit = (namespace, scope, fn, options) =>
    inner(
      namespace,
      scope,
      (unit) =>
        fn({
          ...unit,
          jobs: {
            ...unit.jobs,
            enqueue: (spec) => {
              if (spec.queue === 'reactions') enqueued.push(spec);
              return unit.jobs.enqueue(spec);
            },
            take: (queue, worker, request) =>
              holding && queue === 'reactions'
                ? Promise.resolve({ jobs: [], skippedLanes: 0 })
                : unit.jobs.take(queue, worker, request),
            complete: (attempt, worker, outcome) => {
              outcomes.push(outcome);
              return unit.jobs.complete(attempt, worker, outcome);
            },
          },
        }),
      options,
    );
  return {
    release: () => {
      holding = false;
    },
    enqueued,
    outcomes,
  };
}
