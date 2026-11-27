import { describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { backendApp } from './support/erasure-backend-app.ts';
import { backendCases } from './support/erasure-backend-cases.ts';
import { type BackendHost, bootBackend } from './support/erasure-backend-kit.ts';
import { stampAs } from './support/erasure-backend-stamp.ts';
import type { erasureDumpApp } from './support/erasure-probe-module.ts';
import { type RestartRuntime, useRestartDatabase } from './support/restart-kit.ts';
import { useRestoreKit } from './support/restore-kit.ts';

describe('the backend scope of an erasure (14.7.5) on PostgreSQL', () => {
  const { stops, external } = useRestartDatabase();
  const host: BackendHost = {
    start: async ({ worker, sink }) => {
      const runtime = await startTestRuntime(backendApp, {
        external: external(),
        operators: true,
        workers: true,
        tenants: ['acme', 'globex'],
        eventWorkers: [worker],
        ledgers: [sink],
      });
      stops.push(() => runtime.stop());
      return runtime;
    },
  };
  backendCases(host, 'postgres');

  test('a principal key that a unit seals under for the first time while the purge runs is not destroyed and keeps its record; a key the purge read is destroyed after its tombstone', {
    timeout: 120_000,
  }, async () => {
    const keys: { seen?: string; unseen?: string } = {};
    let liveWhenTombstoned: boolean | undefined;
    let look: (() => Promise<boolean>) | undefined;
    const t = await bootBackend(host, {}, async (records) => {
      const named = records.some(
        (record) => record.type === 'keyTombstone' && record.keyId === keys.seen,
      );
      if (named) liveWhenTombstoned = await look?.();
      return false;
    });
    const ada = await t.make('acme', 'bk.enrol', { email: 'ada@example.test' });
    const [seen, unseen] = [
      await t.make('acme', 'bk.open', { ownerId: ada }),
      await t.make('acme', 'bk.open', { ownerId: ada }),
    ];
    keys.seen = `principal:${seen}`;
    keys.unseen = `principal:${unseen}`;
    look = async () =>
      (await t.inBackend((u) => u.keys.liveValueKeys([`principal:${seen}`]))).length === 1;
    // The first key is committed before the erasure runs.
    const first = await t.recorded(seen);
    // The second is made at its first use by a unit that has not committed when the purge reads.
    const gate = Promise.withResolvers<void>();
    const sealedNow = Promise.withResolvers<void>();
    let sealed: unknown;
    const inflight = t.inBackend(async (unit) => {
      sealed = await unit.keys.sealValue(
        { entity: 'core.principal', id: unseen, field: 'request' },
        new TextEncoder().encode('request of the session'),
        { keyId: keys.unseen as string },
      );
      sealedNow.resolve();
      await gate.promise;
    });
    await sealedNow.promise;

    await t.erase(ada);
    gate.resolve();
    await inflight;

    // Ending one: the purge read the key, recorded its tombstone while it was still there, then destroyed it.
    expect(liveWhenTombstoned).toBe(true);
    expect(await t.opens(first as never)).toBe(false);
    expect(await t.tombstones(keys.seen)).toEqual([t.runtime.backendId]);
    expect(t.sinkTombstones(keys.seen)).toEqual([t.runtime.backendId]);
    // Ending two: the purge did not read the key; the key and its record stay, with no tombstone.
    expect(await t.inBackend((u) => u.keys.liveValueKeys([keys.unseen as string]))).toEqual([
      keys.unseen,
    ]);
    expect(
      await t.inBackend(async (u) => (await u.keys.openValue(sealed as never)) !== undefined),
    ).toBe(true);
    expect(await t.tombstones(keys.unseen as string)).toEqual([]);
    expect(t.sinkTombstones(keys.unseen as string)).toEqual([]);
  });
});

describe('a backend scope restored from a backup on PostgreSQL (14.7.6)', () => {
  const { eraseAfterBackup, startAgain } = useRestoreKit(
    backendApp as unknown as typeof erasureDumpApp,
  );

  test('a backend restored from before the erasure destroys the principal key again from its tombstone', {
    timeout: 240_000,
  }, async () => {
    const keyOf = (session: string) => `principal:${session}`;
    let session = '';
    const { sink, first, backup, client } = await eraseAfterBackup(
      async (runtime: RestartRuntime) => {
        const operator = createLocalClient(runtime as never, {
          principal: testOperator(),
          tenant: 'acme',
        });
        const made = async (action: string, input: unknown) =>
          String(((await operator.invoke(action as never, input as never)) as { id: string }).id);
        const ada = await made('bk.enrol', { email: 'ada@example.test' });
        session = await made('bk.open', { ownerId: ada });
        const outcome = await stampAs(runtime, session);
        expect(outcome.ok).toBe(true);
        return ada;
      },
      // One more command of the backend, after the backup: the scope's mark outruns the position the backup holds.
      async (runtime: RestartRuntime) => {
        expect((await stampAs(runtime, crypto.randomUUID())).ok).toBe(true);
      },
    );
    const rowOf = async () =>
      (
        await client.query(
          `select key_id from "${first.namespace.root}".kw_value_keys where key_id = $1 and scope_id = $2`,
          [keyOf(session), first.backendId],
        )
      ).rows.length;
    // The erasure destroyed the key; the restored backup holds the key again.
    expect(await rowOf()).toBe(0);
    // Only the value keys are put back, and the backend's position goes back below its mark, as a restore leaves it: the rows stay erased, so the erasure itself runs nothing again.
    await backup.restore((table) => table === 'kw_value_keys');
    await client.query(
      `update "${first.namespace.root}".kw_positions set next = next - 1 where scope_id = $1`,
      [first.backendId],
    );
    expect(await rowOf()).toBe(1);
    const { steps } = await startAgain(first, sink);
    expect(steps).toEqual([]);
    expect(await rowOf()).toBe(0);
  });
});
