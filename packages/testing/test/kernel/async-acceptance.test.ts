import { field, shape } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { command, effectsKit, receiptOf, registryWith, stored } from './support/effects-kit.ts';
import { tenant } from './support/run-read-kit.ts';

interface Writes {
  readonly write: {
    readonly library: { readonly book: { create(values: Record<string, unknown>): unknown } };
  };
}

const addsBook = (_input: unknown, ctx: Writes) => [
  ctx.write.library.book.create({ title: 'Ran', isbn: 'r-1', addedBy: 'ada' }),
];

const registry = registryWith({
  actions: [
    command('slow', addsBook, { execution: 'async', idempotencyWindowMs: 3_600_000 }),
    command('flexible', addsBook, { execution: 'either' }),
    command('mounted', addsBook, {
      execution: 'async',
      output: shape({ id: field.string() }),
      entityOutput: { entity: 'library.book', shape: 'row' },
    }),
  ],
});

describe('asynchronous acceptance', () => {
  test('an async command answers accepted with a receipt and a job, and runs nothing', async () => {
    const { adapter, invoke } = effectsKit(registry);
    const outcome = await invoke('library.slow', { n: 1 }, { commandId: 'a1' });
    expect(outcome).toMatchObject({ ok: true, receipt: { commandId: 'a1', status: 'accepted' } });
    const receipt = await receiptOf(adapter, 'a1');
    expect(receipt).toMatchObject({
      status: 'accepted',
      outcome: null,
      action: 'library.slow',
      apiVersion: '2026-11-01',
      principal: null,
      principalResolver: null,
      principalId: null,
    });
    const { books, jobs } = await stored(adapter);
    expect(books).toHaveLength(0);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      kind: 'action',
      queue: 'commands',
      run: { action: 'library.slow', input: { n: 1 }, commandId: 'a1' },
      principal: { principalId: 'ada' },
      causation: { commandId: 'a1', actor: { kind: 'user', id: 'ada' } },
      build: { id: 'build-42', revision: 7 },
      apiVersion: '2026-11-01',
    });
    expect(jobs[0]?.scope).toEqual(tenant);
  });

  test('the receipt expires after the action window', async () => {
    const { adapter, invoke } = effectsKit(registry);
    await invoke('library.slow', {}, { commandId: 'a1' });
    const receipt = await receiptOf(adapter, 'a1');
    const accepted = receipt?.expiresAt;
    expect(accepted?.toString()).toBe(Temporal.Instant.from('2026-01-01T01:00:00Z').toString());
  });

  test('a retry with the same id and input answers accepted again and enqueues nothing more', async () => {
    const { adapter, invoke } = effectsKit(registry);
    await invoke('library.slow', { n: 1 }, { commandId: 'a1' });
    const again = await invoke('library.slow', { n: 1 }, { commandId: 'a1' });
    expect(again).toMatchObject({
      ok: true,
      replayed: true,
      receipt: { commandId: 'a1', status: 'accepted' },
    });
    expect((await stored(adapter)).jobs).toHaveLength(1);
  });

  test('another input under the same id is core.idempotency_mismatch', async () => {
    const { invoke } = effectsKit(registry);
    await invoke('library.slow', { n: 1 }, { commandId: 'a1' });
    const other = await invoke('library.slow', { n: 2 }, { commandId: 'a1' });
    expect(!other.ok && other.error.code).toBe('core.idempotency_mismatch');
  });

  test('a finished receipt replays its outcome', async () => {
    const { adapter, invoke } = effectsKit(registry);
    await invoke('library.slow', { n: 1 }, { commandId: 'a1' });
    await adapter.unit((await import('./support/run-read-kit.ts')).namespace, tenant, (unit) =>
      unit.receipts.complete('a1', { ok: true, value: { done: true }, effects: [] }),
    );
    const again = await invoke('library.slow', { n: 1 }, { commandId: 'a1' });
    expect(again).toMatchObject({ ok: true, replayed: true, value: { done: true } });
  });

  test('an either command runs synchronously unless the caller prefers async', async () => {
    const sync = effectsKit(registry);
    const ran = await sync.invoke('library.flexible', {}, { commandId: 'e1' });
    expect(ran).toMatchObject({ ok: true });
    expect(ran.ok && ran.receipt).toBeUndefined();
    expect((await stored(sync.adapter)).books).toHaveLength(1);
    const later = effectsKit(registry);
    const accepted = await later.invoke(
      'library.flexible',
      {},
      { commandId: 'e2', prefer: 'async' },
    );
    expect(accepted).toMatchObject({ ok: true, receipt: { commandId: 'e2', status: 'accepted' } });
    const kept = await stored(later.adapter);
    expect(kept.books).toHaveLength(0);
    expect(kept.jobs).toHaveLength(1);
  });

  test('a command id is minted when the caller sends none', async () => {
    const { adapter, invoke } = effectsKit(registry);
    const outcome = await invoke('library.slow', {});
    const id = outcome.ok ? outcome.receipt?.commandId : undefined;
    expect(id).toEqual(expect.any(String));
    expect((await receiptOf(adapter, String(id)))?.status).toBe('accepted');
  });

  test('an async command that answers an entity row or has required outputs is accepted, not shaped', async () => {
    const { adapter, invoke } = effectsKit(registry);
    const outcome = await invoke('library.mounted', {}, { commandId: 'm1' });
    expect(outcome).toMatchObject({
      ok: true,
      value: {},
      receipt: { commandId: 'm1', status: 'accepted' },
    });
    expect((await stored(adapter)).jobs).toHaveLength(1);
  });
});
