import { performance } from 'node:perf_hooks';
import { connect } from './connect.ts';
import type { MeasurementResult } from './measurement-result.ts';
import { namespaceRoot as ns } from './namespace-root.ts';
import type { RunningPostgres } from './running-postgres.ts';
import { summarize } from './summarize.ts';

const timed = async (times: number, run: () => Promise<unknown>): Promise<number[]> => {
  const latencies: number[] = [];
  for (let index = 0; index < times; index += 1) {
    const started = performance.now();
    await run();
    latencies.push(performance.now() - started);
  }
  return latencies;
};

const fixed = (...values: readonly number[]): string =>
  values.map((value) => value.toFixed(3)).join(' / ');

/** The round trip, the cost of a durable commit and the server settings the other numbers rest on. */
export async function measureEnvironment(postgres: RunningPostgres): Promise<MeasurementResult> {
  const admin = await connect(postgres.admin, 'environment');
  try {
    const settings = await admin.query<{ name: string; setting: string }>(
      `select name, current_setting(name) as setting from pg_settings
       where name in ('fsync', 'synchronous_commit', 'wal_sync_method', 'shared_buffers', 'max_connections',
                      'commit_delay', 'default_transaction_isolation')
       order by name`,
    );
    const roundTrip = summarize(await timed(500, () => admin.query('select 1')));
    const commit = summarize(
      await timed(300, () => admin.query(`insert into ${ns}.probe default values`)),
    );
    return {
      id: '0',
      title: 'Environment',
      sections: '15.1.4 (cost model)',
      rows: [
        { measure: 'server', value: postgres.version.split(' on ')[0] ?? postgres.version },
        ...settings.rows.map((row) => ({ measure: row.name, value: row.setting })),
        {
          measure: 'round trip (select 1) p50 / p95 ms',
          value: fixed(roundTrip.p50, roundTrip.p95),
        },
        { measure: 'autocommit insert p50 / p95 ms', value: fixed(commit.p50, commit.p95) },
      ],
      notes: [],
    };
  } finally {
    await admin.end();
  }
}
