import type { DataAdapter, JobOutcome, StoredJobSpec, Unit } from '@keelwerk/core';

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
        const held = 'action' in spec.run && watch.deferred.has(spec.run.action);
        const jobId = await unit.jobs.enqueue(held ? { ...spec, runAt: neverDue } : spec);
        watch.enqueued.push({ jobId, principalId: spec.principal.principalId, spec });
        return jobId;
      },
      take: async (queue, worker, request) =>
        watch.paused !== undefined && worker !== watch.paused
          ? { jobs: [], skippedLanes: 1 }
          : unit.jobs.take(queue, worker, request),
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

/** The instant of a job that waits: no test clock reaches it, and a test that wants the job moves the clock there. */
export const neverDue = Temporal.Instant.from('9999-01-01T00:00:00Z');

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
  /** Every job enqueued, with the id of the principal it was enqueued under (a key's id for a key's work) and what was stored. */
  readonly enqueued: {
    readonly jobId: string;
    readonly principalId: string;
    readonly spec: StoredJobSpec;
  }[];
  /** The only worker whose takes are answered while the takes are paused, else undefined. */
  paused: string | undefined;
  /** The actions whose jobs are enqueued due at `neverDue`, so that they wait until the clock is moved there. */
  readonly deferred: Set<string>;
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
    paused: undefined,
    deferred: new Set(),
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

/** What was enqueued under the principal of one key, in order. */
export function specsOfKey(watch: StoreWatch, keyId: string): StoredJobSpec[] {
  return watch.enqueued.filter((job) => job.principalId === keyId).map((job) => job.spec);
}

/** The attempts that did not succeed (a retry, a dead or a failed one): the job and the error's code and kind. */
export function failedAttempts(watch: StoreWatch): { jobId: string; outcome: string }[] {
  return watch.attempts.flatMap(({ jobId, outcome }) =>
    outcome.kind === 'succeeded'
      ? []
      : [{ jobId, outcome: `${outcome.kind}:${outcome.error.code}:${outcome.error.kind}` }],
  );
}
