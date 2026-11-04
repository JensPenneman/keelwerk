import type { JobOutcome, StoredJob } from '@keelwerk/core';
import { namespaceScope } from './namespace-scope.ts';
import type { StoreFixture } from './store-fixture.ts';

/** Completes a taken job in a namespace-scope unit. */
export async function finishJob(
  store: StoreFixture,
  job: StoredJob,
  worker: string,
  outcome: JobOutcome,
): Promise<boolean> {
  return store.run(namespaceScope, (unit) => unit.jobs.complete(job.attempt, worker, outcome));
}
