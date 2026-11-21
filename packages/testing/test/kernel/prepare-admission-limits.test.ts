import { describe, expect, test } from 'vitest';
import { receiptOf, stored } from './support/effects-kit.ts';
import { boot } from './support/prepare-admission-world.ts';
import { namespace, tenant } from './support/run-read-kit.ts';

// The admission of a command with `prepare` against the storage counters, on the in-memory adapter
// with limits the test sets. What decides each case: the committed store and the executor's count
// after the awaited calls, and a clock that only the test or the `prepare` of the case moves.

describe('admission before prepare', () => {
  test('a counter above core.rows refuses a command with prepare before it runs, naming the dimension', async () => {
    const { world, adapter, invoke } = boot();
    expect((await invoke('library.grow', { isbn: 'g-1' })).ok).toBe(true);
    world.rows = 0;
    const id = '00000000-0000-7000-8000-000000000190';
    const refused = await invoke('library.probe', {}, { commandId: id });
    expect(refused).toMatchObject({ ok: false, error: { code: 'core.quota_exceeded' } });
    expect((refused as { error: { details: unknown } }).error.details).toEqual({
      dimension: 'core.rows',
      limit: 0,
      value: 1,
    });
    expect(world.runs).toBe(0);
    expect((await stored(adapter)).effects).toEqual([]);
    expect(await receiptOf(adapter, id)).toBeUndefined();
  });

  test('a counter equal to its limit is admitted: only a counter above it refuses', async () => {
    const { world, invoke, read } = boot();
    expect((await invoke('library.grow', { isbn: 'g-1' })).ok).toBe(true);
    const [bytes, rows] = await read();
    world.bytes = Number(bytes);
    world.rows = Number(rows);
    expect(world.bytes).toBeGreaterThan(0);
    expect(world.rows).toBeGreaterThan(0);
    expect(
      (await invoke('library.probe', {}, { commandId: '00000000-0000-7000-8000-000000000194' })).ok,
    ).toBe(true);
    expect(world.runs).toBe(1);
  });

  test('a refusal before prepare is not pinned: the same command id runs once the limit is raised', async () => {
    const { world, adapter, invoke, unlimited } = boot();
    expect((await invoke('library.grow', { isbn: 'g-1' })).ok).toBe(true);
    world.bytes = 0;
    const id = '00000000-0000-7000-8000-000000000191';
    expect(await invoke('library.probe', {}, { commandId: id })).toMatchObject({
      ok: false,
      error: { code: 'core.quota_exceeded', details: { dimension: 'core.eventBytes', limit: 0 } },
    });
    expect(await receiptOf(adapter, id)).toBeUndefined();
    world.bytes = unlimited;
    expect((await invoke('library.probe', {}, { commandId: id })).ok).toBe(true);
    expect(world.runs).toBe(1);
    expect(await receiptOf(adapter, id)).toMatchObject({ status: 'completed' });
  });

  test('a command without prepare is refused at its tail, and that refusal is pinned to its id', async () => {
    const { world, adapter, invoke } = boot();
    expect((await invoke('library.grow', { isbn: 'g-1' })).ok).toBe(true);
    world.bytes = 0;
    const id = '00000000-0000-7000-8000-000000000192';
    expect(await invoke('library.grow', { isbn: 'g-2' }, { commandId: id })).toMatchObject({
      ok: false,
      error: { code: 'core.quota_exceeded' },
    });
    expect(await receiptOf(adapter, id)).toMatchObject({ status: 'failed' });
  });

  test('a resend whose receipt is gone before a perform has to start is retryable and starts nothing', async () => {
    const { world, adapter, invoke } = boot();
    expect((await invoke('library.grow', { isbn: 'g-1' })).ok).toBe(true);
    const id = '00000000-0000-7000-8000-000000000193';
    expect((await invoke('library.probe', {}, { commandId: id })).ok).toBe(true);
    expect(world.runs).toBe(1);
    // Sent again with changed data: its `prepare` now performs a second effect, which has no row,
    // and moves the clock past the expiry of the receipt before it does.
    world.performs = 2;
    const resent = await invoke('library.probe', {}, { commandId: id });
    expect(resent).toMatchObject({
      ok: false,
      error: { code: 'core.command_in_progress', retryable: true },
    });
    expect(world.runs).toBe(1);
    expect((await stored(adapter)).effects).toHaveLength(1);
  });

  test('a resend of a failed command over the limits gets its recorded error back and charges nothing', async () => {
    const { world, adapter, invoke, read } = boot();
    expect((await invoke('library.grow', { isbn: 'g-1' })).ok).toBe(true);
    const id = '00000000-0000-7000-8000-000000000195';
    world.refuse = true;
    const first = await invoke('library.probe', {}, { commandId: id });
    expect(first).toMatchObject({ ok: false, error: { code: 'core.validation' } });
    expect(await receiptOf(adapter, id)).toMatchObject({ status: 'failed' });
    expect(world.runs).toBe(1);
    const counters = await read();
    world.bytes = 0;
    world.rows = 0;
    const resent = await invoke('library.probe', {}, { commandId: id });
    expect(resent).toMatchObject({
      ok: false,
      error: { code: 'core.validation', retryable: false },
    });
    expect(world.runs).toBe(1);
    expect(await read()).toEqual(counters);
  });

  test('a finished receipt past its expiry is no resend: over the limits the command is refused, below them it runs', async () => {
    const { world, adapter, invoke, unlimited } = boot();
    expect((await invoke('library.grow', { isbn: 'g-1' })).ok).toBe(true);
    const id = '00000000-0000-7000-8000-000000000196';
    expect((await invoke('library.bare', {}, { commandId: id })).ok).toBe(true);
    expect(await receiptOf(adapter, id)).toMatchObject({ status: 'completed' });
    world.now = world.now.add({ hours: 48 });
    world.bytes = 0;
    expect(await invoke('library.bare', {}, { commandId: id })).toMatchObject({
      ok: false,
      error: { code: 'core.quota_exceeded' },
    });
    world.bytes = unlimited;
    expect((await invoke('library.bare', {}, { commandId: id })).ok).toBe(true);
  });

  test('a receipt that is not finished does not exempt its id: over the limit the command with prepare is refused', async () => {
    const { world, adapter, invoke } = boot();
    expect((await invoke('library.grow', { isbn: 'g-1' })).ok).toBe(true);
    const id = '00000000-0000-7000-8000-000000000199';
    // The id of an asynchronous command that was accepted and has not run: its receipt is `accepted`.
    expect(await invoke('library.slow', {}, { commandId: id })).toMatchObject({
      ok: true,
      receipt: { status: 'accepted' },
    });
    expect(await receiptOf(adapter, id)).toMatchObject({ status: 'accepted' });
    world.bytes = 0;
    expect(await invoke('library.probe', {}, { commandId: id })).toMatchObject({
      ok: false,
      error: { code: 'core.quota_exceeded', details: { dimension: 'core.eventBytes' } },
    });
    expect(world.runs).toBe(0);
    expect((await stored(adapter)).effects).toEqual([]);
    expect(await receiptOf(adapter, id)).toMatchObject({ status: 'accepted' });
  });

  test('the admission waits for no read-write unit: a refusal comes while another unit of the namespace is open', async () => {
    const { world, adapter, invoke } = boot();
    expect((await invoke('library.grow', { isbn: 'g-1' })).ok).toBe(true);
    world.rows = 0;
    // A read-write unit of the namespace holds its lock until the test releases it, which it does
    // only after the refusal came: an admission in a read-write unit would wait for it, so the call
    // would never answer.
    const held = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const holder = adapter.unit(namespace, tenant, async () => {
      held.resolve();
      await release.promise;
    });
    try {
      await held.promise;
      expect(
        await invoke('library.probe', {}, { commandId: '00000000-0000-7000-8000-000000000200' }),
      ).toMatchObject({ ok: false, error: { code: 'core.quota_exceeded' } });
      expect(world.runs).toBe(0);
    } finally {
      release.resolve();
      await holder;
    }
  });

  test('a resend whose first attempt has committed its effect record is no new command: it is never refused by the limits and charged nothing', async () => {
    const { world, adapter, invoke, read, unlimited } = boot();
    expect((await invoke('library.grow', { isbn: 'g-1' })).ok).toBe(true);
    const id = '00000000-0000-7000-8000-000000000197';
    // The first attempt is held inside its executor: its effect record is committed, its receipt
    // is not written yet, and it goes on only when the test lets it.
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    world.onRun = async () => {
      entered.resolve();
      await release.promise;
    };
    const first = invoke('library.probe', {}, { commandId: id });
    try {
      await entered.promise;
      expect((await stored(adapter)).effects).toHaveLength(1);
      expect(await receiptOf(adapter, id)).toBeUndefined();
      // Both counters now stand above their limits.
      world.bytes = 0;
      world.rows = 0;
      const counters = await read();
      expect(counters[0]).toBeGreaterThan(0n);
      expect(counters[1]).toBeGreaterThan(0n);
      const resent = await invoke('library.probe', {}, { commandId: id });
      expect(resent).toMatchObject({
        ok: false,
        error: { code: 'core.command_in_progress', retryable: true },
      });
      expect(world.runs).toBe(1);
      expect((await stored(adapter)).effects).toHaveLength(1);
      expect(await read()).toEqual(counters);
    } finally {
      world.bytes = unlimited;
      world.rows = unlimited;
      release.resolve();
    }
    expect((await first).ok).toBe(true);
    expect(world.runs).toBe(1);
    expect(await receiptOf(adapter, id)).toMatchObject({ status: 'completed' });
  });

  test('a resend after a cut first attempt goes on from its effect record over the limits: executor once, nothing refused', async () => {
    const { world, adapter, invoke, read } = boot();
    expect((await invoke('library.grow', { isbn: 'g-1' })).ok).toBe(true);
    const id = '00000000-0000-7000-8000-000000000198';
    // Cut as the neighbouring cases cut a run: its signal aborts from inside the executor, once the
    // effect record is committed, so the run ends with no receipt.
    const cut = new AbortController();
    world.onRun = () => cut.abort(new Error('the run was cut'));
    const first = await invoke('library.probe', {}, { commandId: id, signal: cut.signal });
    expect(first.ok).toBe(false);
    world.onRun = undefined;
    expect(world.runs).toBe(1);
    expect((await stored(adapter)).effects).toMatchObject([{ status: 'abandoned' }]);
    expect(await receiptOf(adapter, id)).toBeUndefined();
    world.bytes = 0;
    world.rows = 0;
    const counters = await read();
    expect(counters[0]).toBeGreaterThan(0n);
    expect(counters[1]).toBeGreaterThan(0n);
    const resent = await invoke('library.probe', {}, { commandId: id });
    expect(resent.ok).toBe(true);
    expect(world.runs).toBe(1);
    expect(await receiptOf(adapter, id)).toMatchObject({ status: 'completed' });
    expect(await read()).toEqual(counters);
  });
});
