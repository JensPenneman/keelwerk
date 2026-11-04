import { performance } from 'node:perf_hooks';
import type { Client } from 'pg';
import { connect } from './connect.ts';
import type { MeasurementResult } from './measurement-result.ts';
import { namespaceRoot as ns } from './namespace-root.ts';
import type { ResultRow } from './result-row.ts';
import { runAppends } from './run-appends.ts';
import type { RunningPostgres } from './running-postgres.ts';
import { seedScopes } from './seed-scopes.ts';
import type { SeededScope } from './seeded-scope.ts';
import { summarize } from './summarize.ts';

const rounds = 1500;
const columns = `id, version, count::text as count, kw_last_hash as "lastHash"`;
const forms = {
  plain: `select ${columns} from ${ns}.demo__item where tenant_id = $1 and id = $2`,
  positioned: `select ${columns}, (select next - 1 from ${ns}.kw_positions where scope_id = $1)::text as at
    from ${ns}.demo__item where tenant_id = $1 and id = $2`,
  counter: `select next - 1 as at from ${ns}.kw_positions where scope_id = $1 and $2::uuid is not null`,
} as const;
type Form = keyof typeof forms;

// Runs the three statement forms in alternation (the order rotates every round) inside read
// committed units of 50 rounds, so drifting background load affects every form alike.
const alternate = async (client: Client, scope: SeededScope): Promise<Record<Form, number[]>> => {
  const latencies: Record<Form, number[]> = { plain: [], positioned: [], counter: [] };
  const order: readonly Form[] = ['plain', 'positioned', 'counter'];
  for (let round = 0; round < rounds; round += 1) {
    if (round % 50 === 0) {
      if (round > 0) await client.query('commit');
      await client.query('begin isolation level read committed');
      await client.query(`select set_config('keelwerk.tenant_id', $1, true)`, [scope.id]);
    }
    for (let step = 0; step < order.length; step += 1) {
      const form = order[(round + step) % order.length] as Form;
      const entity = scope.entities[48 + (round % 8)];
      const started = performance.now();
      await client.query(forms[form], [scope.id, entity]);
      latencies[form].push(performance.now() - started);
    }
  }
  await client.query('commit');
  return latencies;
};

// The forms are told apart by their text; the writers' locked target load ends in `for update` and
// is excluded.
const serverMicros = async (admin: Client): Promise<Record<Form, number>> => {
  const result = await admin.query<{ form: Form; mean: number }>(
    `select case when query like '%$2::uuid is not null' then 'counter'
                 when query like '%kw_positions%' then 'positioned'
                 else 'plain' end as form,
            sum(total_exec_time) / sum(calls) as mean
     from pg_stat_statements
     where (query like '%demo__item where tenant_id = $1 and id = $2' or query like '%$2::uuid is not null')
     group by 1`,
  );
  const micros: Record<Form, number> = {
    plain: Number.NaN,
    positioned: Number.NaN,
    counter: Number.NaN,
  };
  for (const row of result.rows) micros[row.form] = Number((Number(row.mean) * 1000).toFixed(1));
  return micros;
};

/**
 * Item (5), cost: one connection runs the plain load, the positioned load of section 7.9.4 phase 5
 * (the scope counter in the same statement) and the bare counter read a REPEATABLE READ decision
 * needs once, in rotating alternation; first alone, then beside 16 writers appending in the same
 * scope, so the counter row is updated by every commit (sections 7.9.3, 7.9.4, 26.2 item 6, 26.3).
 */
export async function measureLoadCost(postgres: RunningPostgres): Promise<MeasurementResult> {
  const admin = await connect(postgres.admin, 'seed');
  const [alone, crowded] = (await seedScopes(admin, 400, 2, 64)) as SeededScope[];
  if (alone === undefined || crowded === undefined) throw new Error('seeding failed');
  const loader = await connect(postgres.app, 'loader');
  const rows: ResultRow[] = [];
  try {
    for (const [label, scope] of [
      ['alone', alone],
      ['beside 16 writers of the scope', crowded],
    ] as const) {
      await admin.query('select pg_stat_statements_reset()');
      const writers =
        label === 'alone'
          ? undefined
          : runAppends({
              app: postgres.app,
              writers: Array.from({ length: 16 }, (_, writer) => ({
                scope,
                targets: scope.entities.slice(writer * 3, writer * 3 + 3),
                loads: [],
              })),
              unit: {
                isolation: 'read committed',
                positionedLoads: true,
                targetPosition: 'same-statement',
                tail: 'statements',
                notifyInTransaction: false,
                auditTargetPosition: false,
              },
              warmupMs: 0,
              durationMs: 4000,
              seed: 6,
            });
      const latencies = await alternate(loader, scope);
      const commits = writers === undefined ? undefined : (await writers).samples.length;
      const server = await serverMicros(admin);
      for (const form of ['plain', 'positioned', 'counter'] as const) {
        const client = summarize(latencies[form]);
        rows.push({
          load: label,
          statement: {
            plain: 'plain load',
            positioned: 'positioned load (counter subselect)',
            counter: 'counter read alone (once per REPEATABLE READ decision)',
          }[form],
          'client p50 ms': Number(client.p50.toFixed(3)),
          'client p95 ms': Number(client.p95.toFixed(3)),
          'server mean us': server[form],
          'writer commits in run': commits ?? 0,
        });
      }
    }
  } finally {
    await loader.end();
    await admin.end();
  }
  return {
    id: '5a',
    title: 'Cost of the per-load scope-counter read',
    sections: '7.9.3, 7.9.4 phase 5, 26.2 item 6, 26.3',
    rows,
    notes: [
      `${rounds} rounds per load condition, the three statements alternating in rotating order inside read committed units of 50 rounds; server: mean execution time from pg_stat_statements.`,
      'Per decision with k loads plus the target, positioned loads add (k + 1) times the server difference between the positioned and the plain load; a REPEATABLE READ decision instead adds one counter statement (a round trip) and the retries of table 5b.',
    ],
  };
}
