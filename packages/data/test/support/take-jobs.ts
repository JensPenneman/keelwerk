import type { StoredJob } from '@keelwerk/core';
import { namespaceScope } from './namespace-scope.ts';
import type { StoreFixture } from './store-fixture.ts';

/** A take of the `commands` queue in a namespace-scope unit, over the lanes without capabilities. */
export async function takeJobs(
  store: StoreFixture,
  worker: string,
  request: { limit?: number; lanes?: number; leaseMs?: number } = {},
): Promise<readonly StoredJob[]> {
  return store.run(namespaceScope, async (unit) => {
    const taken = await unit.jobs.take('commands', worker, {
      limit: request.limit ?? 10,
      ...(request.lanes === undefined ? {} : { lanes: request.lanes }),
      capabilitySets: [''],
      maxRevision: 100,
      leaseMs: request.leaseMs ?? 60_000,
    });
    return taken.jobs;
  });
}
