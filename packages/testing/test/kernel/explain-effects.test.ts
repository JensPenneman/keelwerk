import { traceCommand } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { bookEntity } from './support/command-kit.ts';
import {
  command,
  effectEntity,
  effectsKit,
  externalEffect,
  registryWith,
} from './support/effects-kit.ts';
import { dry } from './support/explain-kit.ts';
import { namespace, tenant } from './support/run-read-kit.ts';

interface Writes {
  readonly write: {
    readonly library: { readonly book: { create(values: Record<string, unknown>): unknown } };
  };
}

describe('effects in a dry run and in a trace', () => {
  const declared = externalEffect('notify', async () => ({ ok: true }), { queue: 'mail' });
  const registry = registryWith({
    effects: [declared.effect],
    executors: [declared.executor],
    actions: [
      command('send', (_i: unknown, ctx: Writes) => ({
        events: [ctx.write.library.book.create({ title: 'T', isbn: 't-1', addedBy: 'ada' })],
        effects: [
          {
            kind: 'external',
            type: 'library.notify',
            input: { to: 'ada@example.org' },
            continueWith: 'library.after',
          },
        ],
      })),
      command('after', () => []),
    ],
  });

  test('the dry run lists the effect with its id and continuation and writes nothing', async () => {
    const { adapter, run } = dry(registry, 'library.send');
    const report = await run();
    expect(report).toMatchObject({
      status: 'decided',
      effects: [{ kind: 'external', type: 'library.notify', continuation: 'library.after' }],
    });
    if (report.status !== 'decided') throw new Error('unreachable');
    expect(report.deferred).toEqual([report.effects[0]?.id]);
    expect(report.decision?.effects).toEqual(report.deferred);
    const rows = await adapter.unit(namespace, tenant, async (unit) => ({
      books: (await unit.rows.find(bookEntity, {})).rows,
      effects: (await unit.rows.find(effectEntity, {})).rows,
      receipt: await unit.receipts.get('dry-1'),
    }));
    expect(rows.books).toEqual([]);
    expect(rows.effects).toEqual([]);
    expect(rows.receipt).toBeUndefined();
  });

  test('the dry run id is the id the real run gives', async () => {
    const { adapter, run } = dry(registry, 'library.send');
    const report = await run();
    const { invoke } = effectsKit(registry, { adapter });
    const real = await invoke('library.send', {}, { commandId: 'dry-1' });
    expect(real).toMatchObject({ ok: true });
    if (report.status !== 'decided' || !real.ok) throw new Error('unreachable');
    expect(real.effects).toEqual(report.deferred);
  });

  test('a trace of the effect id leads to the command, whose effect shows its status', async () => {
    const { adapter } = dry(registry, 'library.send');
    const { invoke } = effectsKit(registry, { adapter });
    const real = await invoke('library.send', {}, { commandId: 'c-real' });
    if (!real.ok) throw new Error('unreachable');
    const [effectId] = real.effects ?? [];
    const traced = await traceCommand({ adapter, namespace, scope: tenant, id: String(effectId) });
    expect(traced.requested).toEqual({ kind: 'effect', id: effectId });
    expect(traced.command.commandId).toBe('c-real');
    expect(traced.command.effects).toMatchObject([
      { id: effectId, type: 'library.notify', status: 'requested' },
    ]);
    expect(traced.command.decision?.effects).toEqual([effectId]);
  });
});

describe('an inline effect in prepare', () => {
  const declared = externalEffect('lookup', async () => ({ ok: true }), { inline: true });
  const registry = registryWith({
    effects: [declared.effect],
    executors: [declared.executor],
    actions: [
      command(
        'checked',
        (_i: unknown, ctx: { prepared: unknown } & Writes) => [
          ctx.write.library.book.create({ title: 'T', isbn: 'p-1', addedBy: 'ada' }),
        ],
        {
          prepare: ((_input: unknown, ctx: { perform(effect: unknown): unknown }) =>
            ctx.perform({ kind: 'external', type: 'library.lookup', input: { to: 'x' } })) as never,
        },
      ),
    ],
  });

  test('stops as would-perform without an answer and decides with one', async () => {
    const stopped = await dry(registry, 'library.checked').run();
    expect(stopped).toEqual({
      status: 'would-perform',
      action: 'library.checked',
      effect: 'library.lookup',
      input: { to: 'x' },
    });
    const answered = await dry(registry, 'library.checked', {
      answers: { 'library.lookup': { ok: true } },
    }).run();
    expect(answered).toMatchObject({
      status: 'decided',
      events: [{ type: 'library.book.created' }],
    });
  });
});

describe('the seam', () => {
  test('a dry run keeps the other paths unchanged: a repeated command id is a conflict, not a replay', async () => {
    const registry = registryWith({ actions: [command('noop', () => [])] });
    const { adapter, run } = dry(registry, 'library.noop');
    expect(await run()).toMatchObject({ status: 'decided', events: [] });
    const { invoke } = effectsKit(registry, { adapter });
    expect(await invoke('library.noop', {}, { commandId: 'dry-1' })).toMatchObject({ ok: true });
    await expect(run()).rejects.toMatchObject({ kind: 'conflict' });
  });
});
