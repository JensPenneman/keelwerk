import type { LedgerRecord } from '@keelwerk/core';
import { expect, test } from 'vitest';
import { type BackendHost, bootBackend } from './erasure-backend-kit.ts';
import { touchAs } from './erasure-backend-stamp.ts';

/** The cases of the backend scope of an erasure (14.7.5), the same on every adapter. */
export function backendCases(host: BackendHost, adapter: string): void {
  const boot = (
    hooks?: Parameters<typeof bootBackend>[1],
    refuses?: (records: readonly LedgerRecord[]) => boolean,
  ) => bootBackend(host, hooks, refuses);

  test(`a backend request record of an erased row's principal no longer opens, with its tombstone in the ledger and a sink; the subject in another tenant keeps everything there (${adapter})`, {
    timeout: 120_000,
  }, async () => {
    const t = await boot();
    const [ada, bea] = [
      await t.make('acme', 'bk.enrol', { email: 'ada@example.test' }),
      await t.make('acme', 'bk.enrol', { email: 'bea@example.test' }),
    ];
    const [mine, theirs, elsewhere] = [
      await t.make('acme', 'bk.open', { ownerId: ada }),
      await t.make('acme', 'bk.open', { ownerId: bea }),
      await t.make('globex', 'bk.open', { ownerId: ada }),
    ];
    const kept = {
      mine: await t.recorded(mine),
      theirs: await t.recorded(theirs),
      elsewhere: await t.recorded(elsewhere),
      subjectsOwn: await t.recorded(ada),
    };
    for (const found of Object.values(kept)) expect(await t.opens(found as never)).toBe(true);

    await t.erase(ada);

    expect(await t.opens(kept.mine as never)).toBe(false);
    expect(await t.opens(kept.theirs as never)).toBe(true);
    expect(await t.opens(kept.elsewhere as never)).toBe(true);
    expect(await t.opens(kept.subjectsOwn as never)).toBe(true);
    expect(await t.tombstones(kept.mine.keyId)).toEqual([t.runtime.backendId]);
    expect(t.sinkTombstones(kept.mine.keyId)).toEqual([t.runtime.backendId]);
    for (const other of [kept.theirs, kept.elsewhere, kept.subjectsOwn]) {
      expect(await t.tombstones(other.keyId)).toEqual([]);
    }
    // The person of the other tenant still acts in the backend, and so does the subject's own id.
    expect((await t.stamp(elsewhere)).ok).toBe(true);
    expect((await t.stamp(ada)).ok).toBe(true);
  });

  test(`a principal that still resolves to the erased row's id can write a record under that id after the purge, in the tenant and in the backend, and the key is made again; a further erasure of the subject removes both (${adapter})`, {
    timeout: 120_000,
  }, async () => {
    const late: { run?: () => Promise<void> } = {};
    const answers: boolean[] = [];
    const t = await boot({
      afterStep: async (step) => {
        if (step !== 'principals') return;
        const { run } = late;
        delete late.run;
        await run?.();
      },
    });
    const ada = await t.make('acme', 'bk.enrol', { email: 'ada@example.test' });
    const [bea, session] = [
      await t.make('acme', 'bk.enrol', { email: 'bea@example.test' }),
      await t.make('acme', 'bk.open', { ownerId: ada }),
    ];
    const other = await t.make('acme', 'bk.open', { ownerId: bea });
    const tenantId = t.runtime.tenants.acme?.id ?? '';
    const key = `principal:${session}`;
    await t.recorded(session);
    expect((await touchAs(t.runtime, tenantId, session, other)).ok).toBe(true);
    const inTenant = () =>
      t.runtime.adapter.unit(
        t.runtime.namespace,
        { level: 'tenant', backendId: t.runtime.backendId, tenantId },
        (unit) => unit.keys.liveValueKeys([key]),
      );
    late.run = async () => {
      answers.push((await t.stamp(session)).ok);
      answers.push((await touchAs(t.runtime, tenantId, session, other)).ok);
    };

    await t.erase(ada);

    expect(late.run).toBeUndefined();
    expect(answers).toEqual([true, true]);
    expect(await inTenant()).toEqual([key]);
    expect(await t.inBackend((unit) => unit.keys.liveValueKeys([key]))).toEqual([key]);
    await t.erase(ada);
    expect(await inTenant()).toEqual([]);
    expect(await t.inBackend((unit) => unit.keys.liveValueKeys([key]))).toEqual([]);
  });

  test(`a crash between the tenant unit and the backend unit of a row is repaired: the backend purge runs on the rerun, its tombstone recorded once (${adapter})`, {
    timeout: 120_000,
  }, async () => {
    // The sink refuses the first backend tombstone: the row's tenant unit has committed, its backend unit has not.
    let refused = false;
    const t = await boot({}, (records) => {
      const named = records.some(
        (record) => record.type === 'keyTombstone' && record.keyId.startsWith('principal:'),
      );
      if (!named || refused) return false;
      refused = true;
      return true;
    });
    const ada = await t.make('acme', 'bk.enrol', { email: 'ada@example.test' });
    const session = await t.make('acme', 'bk.open', { ownerId: ada });
    const found = await t.recorded(session);

    await t.erase(ada);
    expect(refused).toBe(true);
    expect(await t.opens(found as never)).toBe(true);
    await t.worker.pass();
    await t.runtime.drainJobs();

    expect(await t.opens(found as never)).toBe(false);
    expect(await t.tombstones(found.keyId)).toEqual([t.runtime.backendId]);
    expect(t.sinkTombstones(found.keyId)).toEqual([t.runtime.backendId]);
  });

  test(`a principal that acted in the tenant and in the backend has a tombstone for each scope, though the key id is the same (${adapter})`, {
    timeout: 120_000,
  }, async () => {
    const t = await boot();
    const ada = await t.make('acme', 'bk.enrol', { email: 'ada@example.test' });
    const session = await t.make('acme', 'bk.open', { ownerId: ada });
    const tenantId = t.runtime.tenants.acme?.id ?? '';
    const key = `principal:${session}`;
    expect((await touchAs(t.runtime, tenantId, session, session)).ok).toBe(true);
    const found = await t.recorded(session);
    expect(found.keyId).toBe(key);

    await t.erase(ada);

    expect(await t.opens(found as never)).toBe(false);
    expect((await t.tombstones(key)).sort()).toEqual([tenantId, t.runtime.backendId].sort());
    expect(t.sinkTombstones(key).sort()).toEqual([tenantId, t.runtime.backendId].sort());
  });

  test(`one worker that erases the same person in two tenants records a tombstone for each tenant's key, though the key id is the same (${adapter})`, {
    timeout: 120_000,
  }, async () => {
    const t = await boot();
    const ada = await t.make('acme', 'bk.enrol', { email: 'ada@example.test' });
    const key = `principal:${ada}`;
    const scopes = ['acme', 'globex'] as const;
    for (const tenant of scopes) {
      const row = await t.make(tenant, 'bk.open', { ownerId: ada });
      expect((await touchAs(t.runtime, t.runtime.tenants[tenant]?.id ?? '', ada, row)).ok).toBe(
        true,
      );
    }

    for (const tenant of scopes) await t.erase(ada, tenant);

    const ids = scopes.map((tenant) => t.runtime.tenants[tenant]?.id ?? '').sort();
    expect((await t.tombstones(key)).sort()).toEqual(ids);
    expect(t.sinkTombstones(key).sort()).toEqual(ids);
  });
}
