import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';
import {
  type FrameworkStep,
  frameworkStepChecksum,
  frameworkSteps,
  frameworkTrack,
} from '../src/index.ts';
import type { PgliteAdapter } from '../src/pglite/index.ts';
import { exampleNamespace } from './support/example-namespace.ts';
import { fixedInstant } from './support/fixed-instant.ts';
import { namespaceRef } from './support/namespace-ref.ts';
import { openClockedPglite } from './support/open-clocked-pglite.ts';
import { provisionExampleRoots } from './support/provision-example-roots.ts';
import { storeControlNamespace } from './support/store-control-namespace.ts';

const dump = readFileSync(new URL('./fixtures/m1-dump.sql', import.meta.url), 'utf8');
const opened: PgliteAdapter[] = [];

async function open(): Promise<PgliteAdapter> {
  const adapter = await openClockedPglite();
  opened.push(adapter);
  return adapter;
}

afterEach(async () => {
  for (const adapter of opened.splice(0)) await adapter.close(1000);
});

const rowsOf = async (
  adapter: PgliteAdapter,
  sql: string,
): Promise<readonly Record<string, unknown>[]> =>
  adapter.asOwner(async (database) => (await database.query<Record<string, unknown>>(sql)).rows);

const frameworkRows = (adapter: PgliteAdapter, root: string) =>
  rowsOf(
    adapter,
    `select id, checksum, duration_ms, steps_applied from "${root}".kw_migrations where track = '${frameworkTrack}' order by id`,
  );

/** The rows the M1 dump holds, in full: the five rows of the history tables, the positions and the usage. */
const rowsOfFixture = async (adapter: PgliteAdapter): Promise<readonly unknown[]> =>
  Promise.all(
    [
      `select * from "kw__control".kw_migrations where track <> '${frameworkTrack}' order by track, id`,
      `select * from "example".kw_migrations where track <> '${frameworkTrack}' order by track, id`,
      'select * from "kw__control".kw_positions order by scope_id',
      'select * from "example".kw_positions order by scope_id',
      'select * from "example".kw_usage order by 1',
    ].map((sql) => rowsOf(adapter, sql)),
  );

const stepOf = (id: string): FrameworkStep => {
  const step = frameworkSteps.find((candidate) => candidate.id === id);
  if (step === undefined) throw new Error(`no framework step ${id}`);
  return step;
};

const counts = async (adapter: PgliteAdapter): Promise<readonly unknown[]> =>
  (
    await Promise.all(
      [
        '"kw__control".kw_migrations',
        '"kw__control".kw_positions',
        '"example".kw_migrations',
        '"example".kw_positions',
        '"example".kw_usage',
      ].map((table) => rowsOf(adapter, `select count(*)::int as n from ${table}`)),
    )
  ).map((rows) => rows[0]?.n);

describe('the framework track on PGlite', () => {
  test('a fresh namespace records both steps at the adapter clock', async () => {
    const adapter = await open();
    await provisionExampleRoots(adapter);
    for (const [ref, options] of [
      [exampleNamespace, {}],
      [storeControlNamespace, { control: true }],
    ] as const) {
      const history = (await adapter.schema.history(ref)).filter(
        (row) => row.track === frameworkTrack,
      );
      expect(history.map((row) => row.id)).toEqual(['0001', '0002']);
      expect(history.map((row) => row.checksum)).toEqual(
        frameworkSteps.map((step) => frameworkStepChecksum(step, options)),
      );
      for (const row of history) expect(row.appliedAt.toString()).toBe(fixedInstant.toString());
    }
  });

  test('the M1 dump migrates: 0001 is recognised and 0002 adds the tables', async () => {
    const adapter = await open();
    await adapter.asOwner(async (database) => database.exec(dump));
    const before = await counts(adapter);
    const fixtureRows = await rowsOfFixture(adapter);
    await provisionExampleRoots(adapter);
    expect(await rowsOfFixture(adapter)).toEqual(fixtureRows);
    for (const root of ['example', 'kw__control']) {
      const rows = await frameworkRows(adapter, root);
      expect(rows.map((row) => row.id)).toEqual(['0001', '0002']);
      expect(rows[0]?.duration_ms).toBe(0);
      const tables = await rowsOf(
        adapter,
        `select to_regclass('"${root}".kw_consumers') is not null as present`,
      );
      expect(tables[0]?.present).toBe(true);
    }
    const ledger = await rowsOf(
      adapter,
      `select to_regclass('"kw__control".kw_ledger')::text as t`,
    );
    expect(ledger[0]?.t).toBe('kw__control.kw_ledger');
    const aside = await rowsOf(adapter, `select to_regclass('"example".kw_ledger') as t`);
    expect(aside[0]?.t).toBeNull();
    const library = await rowsOf(
      adapter,
      `select id, steps_applied as "stepsApplied" from "example".kw_migrations where track = 'library'`,
    );
    expect(library).toEqual([{ id: '0001-initial', stepsApplied: 3 }]);
    const deploymentTrack = await rowsOf(
      adapter,
      `select id from "kw__control".kw_migrations where track = 'keelwerk.deployment'`,
    );
    expect(deploymentTrack).toEqual([{ id: '01952f3e-7c1a-7b2d-8e4f-3a5b6c7d8e9f' }]);
    const usage = await rowsOf(adapter, `select value::int as value from "example".kw_usage`);
    expect(usage).toEqual([{ value: 7 }]);
    const positions = await rowsOf(adapter, `select next::int as next from "example".kw_positions`);
    expect(positions).toEqual([{ next: 8 }]);
    const after = await counts(adapter);
    expect(after.map(Number)).toEqual(
      before.map(Number).map((n, index) => (index === 0 || index === 2 ? n + 2 : n)),
    );
  });

  test('provision again changes nothing', async () => {
    const adapter = await open();
    await adapter.asOwner(async (database) => database.exec(dump));
    await provisionExampleRoots(adapter);
    const history = await rowsOf(
      adapter,
      `select track, id, checksum, applied_at::text as at from "example".kw_migrations order by track, id`,
    );
    const rows = await counts(adapter);
    await provisionExampleRoots(adapter);
    expect(
      await rowsOf(
        adapter,
        `select track, id, checksum, applied_at::text as at from "example".kw_migrations order by track, id`,
      ),
    ).toEqual(history);
    expect(await counts(adapter)).toEqual(rows);
  });

  test('a recorded step with another checksum refuses with conflict', async () => {
    const adapter = await open();
    await provisionExampleRoots(adapter);
    await adapter.asOwner(async (database) =>
      database.exec(
        `update "example".kw_migrations set checksum = '${'0'.repeat(64)}' where track = '${frameworkTrack}' and id = '0002'`,
      ),
    );
    await expect(adapter.schema.provision(exampleNamespace, [])).rejects.toMatchObject({
      kind: 'conflict',
    });
  });

  test('a step a newer version recorded is left alone', async () => {
    const adapter = await open();
    await provisionExampleRoots(adapter);
    await adapter.asOwner(async (database) =>
      database.exec(
        `insert into "example".kw_migrations values ('${frameworkTrack}', '0003', '${'f'.repeat(64)}', now(), 0, 1)`,
      ),
    );
    await adapter.schema.provision(exampleNamespace, []);
    expect((await frameworkRows(adapter, 'example')).map((row) => row.id)).toEqual([
      '0001',
      '0002',
      '0003',
    ]);
  });

  test('a history emptied by a truncate is recognised from the tables', async () => {
    const adapter = await open();
    await provisionExampleRoots(adapter);
    await adapter.asOwner(async (database) => database.exec(`truncate "example".kw_migrations`));
    await adapter.schema.provision(exampleNamespace, []);
    const rows = await frameworkRows(adapter, 'example');
    expect(rows.map((row) => row.id)).toEqual(['0001', '0002']);
    expect(rows.map((row) => row.duration_ms)).toEqual([0, 0]);
    expect(rows.map((row) => row.steps_applied)).toEqual(
      frameworkSteps.map((step) => step.ddl('example', {}).length),
    );
    expect(rows.map((row) => row.checksum)).toEqual(
      frameworkSteps.map((step) => frameworkStepChecksum(step, {})),
    );
  });

  test('a schema without kw_migrations refuses with conflict', async () => {
    const adapter = await open();
    await adapter.asOwner(async (database) => database.exec('create schema stray'));
    await expect(
      adapter.schema.provision({ ...namespaceRef, id: 'ns-stray', root: 'stray' }, []),
    ).rejects.toMatchObject({ kind: 'conflict' });
  });

  test('step 0002 is the second step of the track', () => {
    expect(frameworkSteps.map((step) => step.id)).toEqual(['0001', '0002']);
    expect(stepOf('0002').marker).toBe('kw_consumers');
  });
});
