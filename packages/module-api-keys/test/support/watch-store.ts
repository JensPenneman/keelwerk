import type { DataAdapter, JobOutcome, Unit } from '@keelwerk/core';

function watchedUnit(unit: Unit, watch: StoreWatch, readOnly: boolean): Unit {
  return {
    ...unit,
    keys: {
      ...unit.keys,
      dataKey: async (subjectId, options) => {
        const key = await unit.keys.dataKey(subjectId, options);
        if (readOnly) {
          watch.calls.dataKey += 1;
          if (key !== undefined) watch.calls.dataKeyFound += 1;
        }
        return key;
      },
      keyById: (keyId) => {
        if (readOnly) watch.calls.keyById += 1;
        return unit.keys.keyById(keyId);
      },
      openValue: (sealed, expected) => {
        if (readOnly) watch.calls.openValue += 1;
        return unit.keys.openValue(sealed, expected);
      },
    },
    jobs: {
      ...unit.jobs,
      enqueue: async (spec) => {
        const jobId = await unit.jobs.enqueue(spec);
        watch.enqueued.push({ jobId, principalId: spec.principal.principalId });
        return jobId;
      },
      complete: async (attempt, worker, outcome) => {
        watch.outcomes.push(outcome);
        watch.attempts.push({ jobId: attempt.jobId, outcome });
        return unit.jobs.complete(attempt, worker, outcome);
      },
    },
  };
}

/** One attempt of a job and how it ended. */
interface WatchedAttempt {
  readonly jobId: string;
  readonly outcome: JobOutcome;
}

/** What the watch counts of the key store, in the read-only units the principal resolvers run in. */
export interface KeyStoreCalls {
  keyById: number;
  openValue: number;
  dataKey: number;
  /** The `dataKey` reads that found a key. */
  dataKeyFound: number;
}

/** What a test reads of the store it watches. */
export interface StoreWatch {
  /** The calls of the key store in read-only units since the last `startCounting`. */
  readonly calls: KeyStoreCalls;
  /** How every job attempt ended, in order. */
  readonly outcomes: JobOutcome[];
  /** The same attempts with the job each belongs to. */
  readonly attempts: WatchedAttempt[];
  /** Every job enqueued, with the id of the principal it was enqueued under (a key's id for a key's work). */
  readonly enqueued: { readonly jobId: string; readonly principalId: string }[];
  /** Zeroes the counts. */
  startCounting(): void;
}

/**
 * Watches the store a running test runtime stores into: the calls its key store gets in read-only
 * units (where a principal is resolved) and the way each job attempt ends. The adapter object the
 * kernel holds is changed in place, so the watch starts at once and ends with the runtime.
 */
export function watchStore(adapter: DataAdapter): StoreWatch {
  const watch: StoreWatch = {
    calls: { keyById: 0, openValue: 0, dataKey: 0, dataKeyFound: 0 },
    outcomes: [],
    attempts: [],
    enqueued: [],
    startCounting: () => {
      watch.calls.keyById = 0;
      watch.calls.openValue = 0;
      watch.calls.dataKey = 0;
      watch.calls.dataKeyFound = 0;
    },
  };
  const target = adapter as { unit: DataAdapter['unit'] };
  const inner = target.unit.bind(adapter);
  target.unit = (namespace, scope, fn, options) =>
    inner(
      namespace,
      scope,
      (unit) => fn(watchedUnit(unit, watch, options?.readOnly === true)),
      options,
    );
  return watch;
}

/** The ids of the jobs enqueued under the principal of one key. */
export function jobsOfKey(watch: StoreWatch, keyId: string): string[] {
  return watch.enqueued.filter((job) => job.principalId === keyId).map((job) => job.jobId);
}

/** The attempts that did not succeed (a retry, a dead or a failed one): the job and the error's code and kind. */
export function failedAttempts(watch: StoreWatch): { jobId: string; outcome: string }[] {
  return watch.attempts.flatMap(({ jobId, outcome }) =>
    outcome.kind === 'succeeded'
      ? []
      : [{ jobId, outcome: `${outcome.kind}:${outcome.error.code}:${outcome.error.kind}` }],
  );
}
