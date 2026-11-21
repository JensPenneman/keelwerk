import { createCellDatabase } from './cell-database.ts';
import { transactionsOf } from './commit-counter.ts';
import type { Costs } from './cost-probes.ts';
import { workerCount } from './kinds.ts';
import type { PostgresUrls } from './postgres-urls.ts';
import { runChildren } from './run-children.ts';
import { seedDeployment } from './seed-deployment.ts';

/**
 * The transactions per second the database commits when four processes make synchronous
 * `bench.record` calls over the eight tenants: the calls are the unit of the write path, so this is
 * what the same database can sustain when a job costs one transaction. `calls` is the total over
 * the four processes; the joins' own transactions are taken away.
 */
export async function calibrate(
  container: PostgresUrls,
  costs: Costs,
  calls: number,
): Promise<number> {
  const database = await createCellDatabase(container);
  try {
    const deployment = await seedDeployment(database.urls, 'calls', 0);
    const before = await transactionsOf(container, database.name);
    const children = await runChildren(
      Array.from({ length: workerCount }, () => ({
        urls: database.urls,
        reactions: false,
        backendId: deployment.backendId,
        tenants: deployment.tenants,
        mode: { kind: 'calls' as const, calls: Math.ceil(calls / workerCount) },
      })),
    );
    const started = performance.now();
    for (const child of children) child.send('go');
    await Promise.all(children.map((child) => child.said('done')));
    const seconds = (performance.now() - started) / 1000;
    await Promise.all(children.map((child) => child.stop()));
    const transactions =
      (await transactionsOf(container, database.name)) - before - costs.joinCalls;
    return transactions / seconds;
  } finally {
    await database.drop();
  }
}
