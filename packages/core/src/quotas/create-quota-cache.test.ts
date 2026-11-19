import { describe, expect, test, vi } from 'vitest';
import {
  backendValuesOf,
  notesQuota,
  quotaRig,
  quotaTenantScope,
  registryOf,
  storedQuotaRow,
} from '../../test/quota-cache-kit.ts';

const registry = registryOf(notesQuota);
const count = (value: number) => ({ kind: 'count', value });
const backendScope = { level: 'backend', backendId: 'b1' } as const;

describe('createQuotaCache', () => {
  test('before the first load the declared defaults serve; fresh() loads rows and backend values', async () => {
    const r = quotaRig(
      [storedQuotaRow('notes.rows', '30')],
      undefined,
      backendValuesOf({ 'notes.rows': '40' }),
    );
    expect(r.loads()).toBe(0);
    expect(r.cache.limitOf(registry, quotaTenantScope, 'notes.rows')).toEqual(count(50));
    await r.cache.fresh();
    expect(r.loads()).toBe(1);
    expect(r.backendLoads()).toBe(1);
    expect(r.cache.limitOf(registry, quotaTenantScope, 'notes.rows')).toEqual(count(30));
    expect(r.cache.limitOf(registry, backendScope, 'notes.rows')).toEqual(count(40));
    r.stop();
  });

  test('a feed wake reloads both: a lowered quota and a lowered backend value are served after it', async () => {
    const r = quotaRig(
      [storedQuotaRow('notes.rows', '30')],
      undefined,
      backendValuesOf({ 'notes.rows': '40' }),
    );
    await r.cache.fresh();
    r.set([storedQuotaRow('notes.rows', '10', { version: 2 })]);
    r.setBackend(backendValuesOf({ 'notes.rows': '20' }));
    r.wake();
    await vi.waitFor(
      () => expect(r.cache.limitOf(registry, backendScope, 'notes.rows')).toEqual(count(20)),
      { timeout: 10_000 },
    );
    expect(r.cache.limitOf(registry, quotaTenantScope, 'notes.rows')).toEqual(count(10));
    expect(r.loads()).toBe(2);
    expect(r.backendLoads()).toBe(2);
    r.stop();
  });

  test('fresh() reloads rows older than a second and not younger ones', async () => {
    const r = quotaRig([storedQuotaRow('notes.rows', '40')]);
    await r.cache.fresh();
    r.set([storedQuotaRow('notes.rows', '10', { version: 2 })]);
    r.advance(999);
    await r.cache.fresh();
    expect(r.loads()).toBe(1);
    expect(r.cache.limitOf(registry, quotaTenantScope, 'notes.rows')).toEqual(count(40));
    r.advance(1);
    await r.cache.fresh();
    expect(r.loads()).toBe(2);
    expect(r.cache.limitOf(registry, quotaTenantScope, 'notes.rows')).toEqual(count(10));
    r.stop();
  });

  test('a failing read keeps the rows and logs, and fresh() does not reject', async () => {
    const r = quotaRig([storedQuotaRow('notes.rows', '40')]);
    await r.cache.fresh();
    r.fail(true);
    r.advance(1_000);
    await expect(r.cache.fresh()).resolves.toBeUndefined();
    expect(r.errors).toEqual(['the quota rows could not be loaded; the last rows keep serving']);
    // Far past any age the rows could be served for: the lowered limit still holds.
    r.advance(24 * 3_600_000);
    await expect(r.cache.fresh()).resolves.toBeUndefined();
    expect(r.cache.limitOf(registry, quotaTenantScope, 'notes.rows')).toEqual(count(40));
    r.stop();
  });

  test('a failing backend reader keeps both previous maps', async () => {
    const r = quotaRig(
      [storedQuotaRow('notes.rows', '30')],
      undefined,
      backendValuesOf({ 'notes.rows': '40' }),
    );
    await r.cache.fresh();
    r.failBackend(true);
    r.set([storedQuotaRow('notes.rows', '5', { version: 2 })]);
    r.setBackend(backendValuesOf({ 'notes.rows': '8' }));
    r.advance(1_000);
    await expect(r.cache.fresh()).resolves.toBeUndefined();
    expect(r.errors).toEqual(['the quota rows could not be loaded; the last rows keep serving']);
    expect(r.cache.limitOf(registry, quotaTenantScope, 'notes.rows')).toEqual(count(30));
    expect(r.cache.limitOf(registry, backendScope, 'notes.rows')).toEqual(count(40));
    r.stop();
  });

  test('a row that does not parse is skipped and logged once per row version', async () => {
    const r = quotaRig(
      [storedQuotaRow('notes.rows', 'lots', { version: 3 })],
      undefined,
      backendValuesOf({ 'notes.rows': '40' }),
    );
    await r.cache.fresh();
    for (let index = 0; index < 3; index++) {
      expect(r.cache.limitOf(registry, quotaTenantScope, 'notes.rows')).toEqual(count(40));
    }
    expect(r.errors).toEqual(['a stored quota row cannot be used; the row is ignored']);
    r.set([storedQuotaRow('notes.rows', 'plenty', { version: 4 })]);
    r.advance(1_000);
    await r.cache.fresh();
    expect(r.cache.limitOf(registry, quotaTenantScope, 'notes.rows')).toEqual(count(40));
    expect(r.errors).toHaveLength(2);
    r.stop();
  });

  test('a row without a tenant is logged once and dropped', async () => {
    const orphan = { ...storedQuotaRow('notes.rows', '5'), tenantId: null };
    const r = quotaRig([orphan], undefined, backendValuesOf({ 'notes.rows': '40' }));
    await r.cache.fresh();
    for (let index = 0; index < 3; index++) {
      expect(r.cache.limitOf(registry, quotaTenantScope, 'notes.rows')).toEqual(count(40));
    }
    r.advance(1_000);
    await r.cache.fresh();
    expect(r.errors).toEqual(['a stored quota row cannot be used; the row is ignored']);
    r.stop();
  });

  test('a configured value that does not parse is logged once and the default serves', async () => {
    const r = quotaRig([], undefined, backendValuesOf({ 'notes.rows': 'lots' }));
    await r.cache.fresh();
    for (let index = 0; index < 3; index++) {
      expect(r.cache.limitOf(registry, quotaTenantScope, 'notes.rows')).toEqual(count(50));
    }
    expect(r.errors).toEqual([
      'a configured quota limit of a backend does not parse; the value is ignored',
    ]);
    r.stop();
  });

  test('queueOf answers the deployment queue under the configuration, a tenant clamped to the backend', async () => {
    const r = quotaRig(
      [storedQuotaRow('queue:commands.weight', '3')],
      { commands: { running: 8 } },
      backendValuesOf({ 'queue:commands.weight': '2' }),
    );
    expect(r.cache.queueOf(quotaTenantScope, 'commands')).toEqual({
      running: 8,
      queued: 10_000,
      weight: 1,
    });
    await r.cache.fresh();
    expect(r.cache.queueOf(quotaTenantScope, 'commands')).toEqual({
      running: 8,
      queued: 10_000,
      weight: 2,
    });
    expect(r.cache.queueOf(quotaTenantScope, 'reactions')).toEqual({
      running: 4,
      queued: 10_000,
      weight: 1,
    });
    r.stop();
  });

  test('queueOf keeps a configured weight at 1 or more and a member within the integer range', async () => {
    const r = quotaRig(
      [],
      undefined,
      backendValuesOf({
        'queue:commands.weight': '0',
        'queue:commands.running': '9999999999',
        'queue:reactions.weight': '5000000000',
      }),
    );
    await r.cache.fresh();
    expect(r.cache.queueOf(quotaTenantScope, 'commands')).toEqual({
      running: 2_147_483_647,
      queued: 10_000,
      weight: 1,
    });
    expect(r.cache.queueOf(quotaTenantScope, 'reactions').weight).toBe(2_147_483_647);
    r.stop();
  });

  test('limitOf of an undeclared ref is internal', () => {
    const r = quotaRig([]);
    expect(() => r.cache.limitOf(registry, quotaTenantScope, 'notes.missing')).toThrow(
      expect.objectContaining({ kind: 'internal' }),
    );
    r.stop();
  });

  test('one load at a time: a wake during a load reruns it once', async () => {
    const r = quotaRig([storedQuotaRow('notes.rows', '40')]);
    r.hold(true);
    const first = r.cache.fresh();
    await vi.waitFor(() => expect(r.loads()).toBe(1), { timeout: 10_000 });
    r.wake();
    r.wake();
    r.hold(false);
    r.release();
    await first;
    await vi.waitFor(() => expect(r.loads()).toBe(2), { timeout: 10_000 });
    await r.cache.fresh();
    expect(r.loads()).toBe(2);
    r.stop();
  });

  test('two open pairs of reads block a third', async () => {
    const timeouts: AbortController[] = [];
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const controller = new AbortController();
      timeouts.push(controller);
      return controller.signal;
    });
    try {
      const r = quotaRig([storedQuotaRow('notes.rows', '40')]);
      r.hold(true);
      const first = r.cache.fresh();
      await vi.waitFor(() => expect(r.loads()).toBe(1), { timeout: 10_000 });
      for (const timeout of timeouts) timeout.abort(new Error('slow'));
      await first;
      r.advance(10_000);
      const second = r.cache.fresh();
      await vi.waitFor(() => expect(r.loads()).toBe(2), { timeout: 10_000 });
      for (const timeout of timeouts) timeout.abort(new Error('slow'));
      await second;
      r.advance(10_000);
      await r.cache.fresh();
      // Two pairs are still open in the adapter: no third pair is started.
      expect(r.loads()).toBe(2);
      expect(r.backendLoads()).toBe(2);
      r.hold(false);
      r.release();
      r.stop();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
