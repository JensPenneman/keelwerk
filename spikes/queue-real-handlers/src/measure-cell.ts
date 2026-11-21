import { asAdmin, createCellDatabase } from './cell-database.ts';
import { transactionsOf } from './commit-counter.ts';
import type { Costs } from './cost-probes.ts';
import type { Kind } from './kinds.ts';
import { queueOf, tenantNames, workerCount, writtenBy } from './kinds.ts';
import type { PostgresUrls } from './postgres-urls.ts';
import { runChildren } from './run-children.ts';
import { seedDeployment } from './seed-deployment.ts';

/** How often the history is counted while the workers run; a bound on a hang follows from it, not the result. */
const pollMs = 500;
/** The longest a cell may take (a hang bound; a normal cell takes a fraction of it). */
const hangMs = 30 * 60_000;

/** What one cell of one round measured. */
export interface CellSample {
  readonly kind: Kind;
  readonly batch: number;
  readonly jobs: number;
  /** Jobs per second from the first job's start to the last job's end. */
  readonly jobsPerSecond: number;
  /** Transactions the database ended per job, with the measurement's own taken away. */
  readonly transactionsPerJob: number;
  readonly loadAtStart: number;
  readonly loadAtEnd: number;
}

/**
 * One cell: a database of its own, `perTenant` jobs of `kind` committed for each of eight tenants,
 * then four worker processes join with `batch` slots on the kind's queue and the cell ends when
 * `kw_job_history` holds every job. The transactions counted are those from just before the workers
 * start to just after they stop, less the monitoring's polls and connection and the workers' joins.
 */
export async function measureCell(
  container: PostgresUrls,
  costs: Costs,
  kind: Kind,
  batch: number,
  perTenant: number,
  load: () => number,
): Promise<CellSample> {
  const jobs = perTenant * tenantNames.length;
  const database = await createCellDatabase(container);
  try {
    const { root, ...deployment } = await seedDeployment(database.urls, kind, perTenant);
    const history = `"${root.replaceAll('"', '""')}".kw_job_history`;
    const loadAtStart = load();
    const before = await transactionsOf(container, database.name);
    const children = await runChildren(
      Array.from({ length: workerCount }, () => ({
        urls: database.urls,
        reactions: kind === 'reaction',
        ...deployment,
        mode: { kind: 'work' as const, queue: queueOf[kind], slots: batch },
      })),
    );
    const deadline = Date.now() + hangMs;
    let polls = 0;
    const span = await asAdmin(database.urls.adminUrl, async (client) => {
      for (;;) {
        polls += 1;
        const row = await client.query<{ done: string; failed: string; seconds: number | null }>(
          `select count(*)::text as done, (count(*) filter (where outcome <> 'succeeded'))::text as failed,
  extract(epoch from max(finished_at) - min(started_at))::float8 as seconds
from ${history} where queue = $1`,
          [queueOf[kind]],
        );
        if (Number(row.rows[0]?.failed) > 0) {
          throw new Error(`${row.rows[0]?.failed} jobs of ${kind} did not succeed`);
        }
        if (Number(row.rows[0]?.done) === jobs) return row.rows[0]?.seconds ?? 0;
        if (Date.now() > deadline) throw new Error(`cell ${kind} ${batch} did not finish`);
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    });
    const loadAtEnd = load();
    await Promise.all(children.map((child) => child.stop()));
    const join = kind === 'reaction' ? costs.joinReactions : costs.joinWork;
    const own = costs.connect + polls * costs.poll + join;
    const transactions = (await transactionsOf(container, database.name)) - before - own;
    // After the final reading, so that its connection and query are not in the transactions counted.
    const table = writtenBy[kind];
    if (table !== undefined) {
      const rows = await asAdmin(database.urls.adminUrl, (client) =>
        client.query<{ rows: string }>(
          `select count(*)::text as rows from "${root.replaceAll('"', '""')}".${table}`,
        ),
      );
      if (Number(rows.rows[0]?.rows) !== jobs) {
        throw new Error(`${table} holds ${rows.rows[0]?.rows} rows after ${jobs} ${kind} jobs`);
      }
    }
    return {
      kind,
      batch,
      jobs,
      jobsPerSecond: jobs / span,
      transactionsPerJob: transactions / jobs,
      loadAtStart,
      loadAtEnd,
    };
  } finally {
    await database.drop();
  }
}
