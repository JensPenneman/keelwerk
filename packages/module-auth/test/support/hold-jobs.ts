import type { DataAdapter, JobOutcome } from '@keelwerk/core';

/** The jobs of a runtime while its workers are kept from taking any, and how each attempt ended. */
export interface HeldJobs {
  /** Lets the workers take jobs again; the caller then settles. */
  release(): void;
  /** How every job attempt ended since the hold started, in order. */
  readonly outcomes: JobOutcome[];
}

/**
 * Makes the workers of a running test runtime take no job until `release`, so a test can change the
 * state a queued job will find when it runs. The adapter object the kernel holds is changed in place,
 * so the hold starts at once and ends with the runtime.
 */
export function holdJobs(adapter: DataAdapter): HeldJobs {
  let held = true;
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
            take: (queue, worker, request) =>
              held
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
      held = false;
    },
    outcomes,
  };
}
