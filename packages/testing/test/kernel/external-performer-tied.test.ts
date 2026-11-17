import { describe, expect, test, vi } from 'vitest';
import { dispatchRuntime } from './support/dispatch-runtime.ts';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });

const unknownId = '0198a2c4-7e10-7a3b-8c5d-3f2a1b9d4e99';
const matching = {
  at: Temporal.Instant.from('2026-11-12T10:00:00Z'),
  n: 5n,
  raw: new Uint8Array([1, 2]),
  tags: new Set(['a', 'b']),
};
const other = {
  at: Temporal.Instant.from('2025-01-01T00:00:00Z'),
  n: 4n,
  raw: new Uint8Array([3]),
  tags: new Set(['z']),
};

interface Refusal {
  readonly ok: false;
  readonly error: { readonly kind: string; readonly code: string; readonly message: string };
}

describe.each(['memory', 'pglite'] as const)('a settle tied to its performer on %s', (adapter) => {
  const { start } = dispatchRuntime(adapter);

  test('a performer bound to depot north cannot settle an effect of depot south: the answer of an unknown id', async () => {
    const { call, rows, runtime, sent } = await start();
    const south = await sent({ depot: 'south' });
    const refused = (await call('dispatch.reportAt', {
      effectId: south.id,
      depot: 'north',
      tracking: 'T',
    })) as Refusal;
    const unknown = (await call('dispatch.reportAt', {
      effectId: unknownId,
      depot: 'north',
      tracking: 'T',
    })) as Refusal;
    expect(refused).toMatchObject({
      ok: false,
      error: { kind: 'not_found', code: 'core.not_found' },
    });
    expect(unknown).toMatchObject({
      ok: false,
      error: { kind: 'not_found', code: 'core.not_found' },
    });
    expect(refused.error.message.replace(south.id, '<id>')).toBe(
      unknown.error.message.replace(unknownId, '<id>'),
    );
    await runtime.drainJobs();
    const [effect] = (await rows('core.effect')).filter((row) => row.id === south.id);
    expect(effect?.status).toBe('requested');
    expect(await rows('dispatch.delivery')).toEqual([]);
  });

  test('a where that normalisation refuses gives the same answer for an existing id and an unknown one', async () => {
    const { call, sent } = await start();
    const north = await sent({ depot: 'north' });
    const depots = Array.from({ length: 10_001 }, (_, index) => `d${index}`);
    const existing = await call('dispatch.reportIn', { effectId: north.id, depots });
    const unknown = await call('dispatch.reportIn', { effectId: unknownId, depots });
    expect(existing).toEqual(unknown);
  });

  test('a matching settle works and the continuation runs', async () => {
    const { call, rows, runtime, sent } = await start();
    const north = await sent({ depot: 'north' });
    expect(
      await call('dispatch.reportAt', { effectId: north.id, depot: 'north', tracking: 'T-1' }),
    ).toMatchObject({ ok: true });
    await runtime.drainJobs();
    const [effect] = (await rows('core.effect')).filter((row) => row.id === north.id);
    expect(effect?.status).toBe('succeeded');
    expect(await rows('dispatch.delivery')).toEqual([
      expect.objectContaining({ parcel: 'p-1', ok: true, tracking: 'T-1' }),
    ]);
  });

  test('a settle tied to ship with the id of a stamp effect answers not_found', async () => {
    const { call, effectOf, rows } = await start();
    const commandId = crypto.randomUUID();
    expect(await call('dispatch.stampIt', matching, { commandId })).toMatchObject({ ok: true });
    const id = effectOf(commandId);
    expect(
      await call('dispatch.reportAt', { effectId: id, depot: 'north', tracking: 'T' }),
    ).toMatchObject({ ok: false, error: { kind: 'not_found' } });
    const [effect] = (await rows('core.effect')).filter((row) => row.id === id);
    expect(effect?.status).toBe('requested');
  });

  test('a settled effect that does not match answers not_found, not conflict', async () => {
    const { call, sent } = await start();
    const north = await sent({ depot: 'north' });
    expect(
      await call('dispatch.reportAt', { effectId: north.id, depot: 'north', tracking: 'T' }),
    ).toMatchObject({ ok: true });
    expect(
      await call('dispatch.reportAt', { effectId: north.id, depot: 'south', tracking: 'T' }),
    ).toMatchObject({ ok: false, error: { kind: 'not_found' } });
    expect(
      await call('dispatch.reportAt', { effectId: north.id, depot: 'north', tracking: 'T' }),
    ).toMatchObject({ ok: false, error: { kind: 'conflict' } });
  });

  test("the settle's where reads decoded members as the stream does", async () => {
    const { call, effectOf, rows } = await start();
    for (const by of ['at', 'n', 'raw', 'tags'] as const) {
      const admittedCommand = crypto.randomUUID();
      const refusedCommand = crypto.randomUUID();
      await call('dispatch.stampIt', matching, { commandId: admittedCommand });
      await call('dispatch.stampIt', other, { commandId: refusedCommand });
      expect(
        await call('dispatch.reportStamp', { effectId: effectOf(admittedCommand), by }),
        by,
      ).toMatchObject({ ok: true });
      expect(
        await call('dispatch.reportStamp', { effectId: effectOf(refusedCommand), by }),
        by,
      ).toMatchObject({ ok: false, error: { kind: 'not_found' } });
    }
    const statuses = (await rows('core.effect')).map((row) => row.status);
    expect(statuses.filter((status) => status === 'succeeded')).toHaveLength(4);
    expect(statuses.filter((status) => status === 'requested')).toHaveLength(4);
  });

  test('a sealed where the compose probe does not see is refused internal and settles nothing', async () => {
    const { call, rows, runtime, sent } = await start();
    const { id } = await sent();
    const outcome = await call('dispatch.reportSealed', { effectId: id, deep: true });
    expect(outcome).toMatchObject({ ok: false, error: { kind: 'internal' } });
    await runtime.drainJobs();
    const [effect] = (await rows('core.effect')).filter((row) => row.id === id);
    expect(effect?.status).toBe('requested');
    expect(await rows('dispatch.delivery')).toEqual([]);
  });
});
