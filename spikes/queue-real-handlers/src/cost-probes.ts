import pg from 'pg';
import { asAdmin, createCellDatabase } from './cell-database.ts';
import type { ChildConfig } from './child-config.ts';
import { transactionsOf } from './commit-counter.ts';
import { workerCount } from './kinds.ts';
import type { PostgresUrls } from './postgres-urls.ts';
import { runChildren } from './run-children.ts';
import type { Deployment } from './seed-deployment.ts';
import { seedDeployment } from './seed-deployment.ts';

/** Transactions the measurement itself adds to a database's count, and which it takes away. */
export interface Costs {
  /** A monitoring connection's own: opening and closing it. */
  readonly connect: number;
  /** One poll of the history. */
  readonly poll: number;
  /** The four workers' joins and exits, with nothing to run. */
  readonly joinWork: number;
  /** The same with the reaction app, whose processes also start the reaction dispatcher. */
  readonly joinReactions: number;
  /** The same for four processes that join without workers, as the calibration's do. */
  readonly joinCalls: number;
}

/** Joins four processes in `mode` to `deployment`, which holds no job, and ends them. */
async function joinCost(
  container: PostgresUrls,
  database: { readonly name: string; readonly urls: PostgresUrls },
  deployment: Deployment,
  mode: ChildConfig['mode'],
  reactions: boolean,
): Promise<number> {
  const before = await transactionsOf(container, database.name);
  const children = await runChildren(
    Array.from({ length: workerCount }, () => ({
      urls: database.urls,
      reactions,
      ...deployment,
      mode,
    })),
  );
  await Promise.all(children.map((child) => child.stop()));
  return (await transactionsOf(container, database.name)) - before;
}

/**
 * Measures what the measurement adds to a database's transaction count: a monitoring connection
 * that opens and closes (`connect`), one poll (`poll`), and the four workers' joins on an empty
 * queue (`join`). The poll must cost exactly one transaction, or the figures below cannot be corrected.
 */
export async function costProbes(container: PostgresUrls): Promise<Costs> {
  const database = await createCellDatabase(container);
  try {
    const deployment = await seedDeployment(database.urls, 'calls', 0);
    const session = async (polls: number): Promise<number> => {
      const before = await transactionsOf(container, database.name);
      await asAdmin(database.urls.adminUrl, async (client: pg.Client) => {
        for (let n = 0; n < polls; n += 1) await client.query('select 1');
      });
      return (await transactionsOf(container, database.name)) - before;
    };
    const connect = await session(0);
    const poll = (await session(10)) - connect;
    if (poll !== 10) throw new Error(`ten polls cost ${poll} transactions, not 10`);
    const work = { kind: 'work', queue: 'commands', slots: 1 } as const;
    const joinWork = await joinCost(container, database, deployment, work, false);
    const joinReactions = await joinCost(container, database, deployment, work, true);
    const calls = { kind: 'calls', calls: 0 } as const;
    const joinCalls = await joinCost(container, database, deployment, calls, false);
    return { connect, poll: 1, joinWork, joinReactions, joinCalls };
  } finally {
    await database.drop();
  }
}
