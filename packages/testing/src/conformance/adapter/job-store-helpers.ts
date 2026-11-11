import type { JobOutcome, Scope, StorageScope, StoredJob, StoredJobSpec } from '@keelwerk/core';
import { conformanceScopes } from '@keelwerk/data/conformance';
import type { ConformanceSubject } from './conformance-subject.ts';
import { storedJob } from './stored-job.ts';

const { tenantA } = conformanceScopes;
const namespaceScope = { level: 'namespace', reason: 'conformance' } as const;

/** What a take of the job store cases asks for. */
export interface TakeOptions {
  readonly limit?: number;
  readonly lanes?: number;
  readonly capabilitySets?: readonly string[];
  readonly maxRevision?: number;
  readonly leaseMs?: number;
  /** The queue to take from; default `commands`. */
  readonly queue?: string;
}

/** The enqueue, take and completion helpers the job store cases share. */
export function jobStoreHelpers(subject: Pick<ConformanceSubject, 'run'>): {
  readonly take: (worker: string, options?: TakeOptions) => Promise<readonly StoredJob[]>;
  readonly enqueue: (
    jobs: readonly StoredJobSpec[],
    scope?: StorageScope,
  ) => Promise<readonly string[]>;
  readonly finish: (job: StoredJob, worker: string, outcome: JobOutcome) => Promise<boolean>;
  readonly only: (jobs: readonly StoredJob[]) => StoredJob;
  readonly inputs: (jobs: readonly StoredJob[]) => readonly unknown[];
  readonly numbered: (n: number, over?: Partial<StoredJobSpec>) => StoredJobSpec;
} {
  const take = async (worker: string, options: TakeOptions = {}): Promise<readonly StoredJob[]> =>
    subject.run(namespaceScope, async (unit) => {
      const taken = await unit.jobs.take(options.queue ?? 'commands', worker, {
        limit: options.limit ?? 10,
        ...(options.lanes === undefined ? {} : { lanes: options.lanes }),
        capabilitySets: options.capabilitySets ?? [''],
        maxRevision: options.maxRevision ?? 100,
        leaseMs: options.leaseMs ?? 60_000,
      });
      return taken.jobs;
    });
  const enqueue = async (
    jobs: readonly StoredJobSpec[],
    scope: StorageScope = tenantA,
  ): Promise<readonly string[]> =>
    subject.run(scope, async (unit) => {
      const ids: string[] = [];
      for (const job of jobs) ids.push(await unit.jobs.enqueue({ ...job, scope: scope as Scope }));
      return ids;
    });
  const finish = async (job: StoredJob, worker: string, outcome: JobOutcome): Promise<boolean> =>
    subject.run(namespaceScope, (unit) => unit.jobs.complete(job.attempt, worker, outcome));
  const only = (jobs: readonly StoredJob[]): StoredJob => {
    const [job] = jobs;
    if (job === undefined || jobs.length !== 1)
      throw new Error(`expected one job, got ${jobs.length}`);
    return job;
  };
  const inputs = (jobs: readonly StoredJob[]): readonly unknown[] =>
    jobs.map((job) => ('input' in job.run ? job.run.input : null));
  const numbered = (n: number, over: Partial<StoredJobSpec> = {}): StoredJobSpec =>
    storedJob({ run: { action: 'a', input: n }, ...over });

  return { take, enqueue, finish, only, inputs, numbered };
}
