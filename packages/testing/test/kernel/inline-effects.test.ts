import { deriveEffectId } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { runDirect, snapshot } from './support/command-kit.ts';
import {
  command,
  effectEntity,
  effectsKit,
  eventsOf,
  externalEffect,
  registryWith,
} from './support/effects-kit.ts';
import {
  bootInline,
  countingUnits,
  type InlinePrepareContext,
  type InlineWriteContext,
  inlineAttemptsOf,
  pingDraft,
} from './support/inline-kit.ts';
import { namespace, tenant } from './support/run-read-kit.ts';

describe('inline effects in prepare', () => {
  test('each load of prepare opens its own read-only unit and none is open while the inline executor runs', async () => {
    let during = -1;
    const booted = bootInline(
      function* (_input, ctx) {
        yield* ctx.load.library.book.count();
        yield* ctx.load.library.book.count();
        return yield* ctx.perform(pingDraft);
      },
      async () => {
        during = counted.open();
        return { ok: true };
      },
    );
    const counted = countingUnits(booted.adapter);
    await runDirect({
      registry: booted.registry,
      adapter: counted.adapter,
      action: booted.ref,
      input: {},
    });
    expect(during).toBe(0);
    // Two loads: two read-only units; the requested and the settled record: two read-write units;
    // then the command's own unit.
    expect(counted.opened.slice(0, 2)).toEqual([true, true]);
    expect(counted.opened.slice(2)).toEqual([false, false, false]);
  });

  test('a perform inside ctx.all is refused with core.effect_in_unit and nothing is stored', async () => {
    const booted = bootInline(
      function* (_input, ctx) {
        return yield* ctx.all([ctx.perform(pingDraft)]);
      },
      async () => ({ ok: true }),
    );
    const error = await runDirect({
      registry: booted.registry,
      adapter: booted.adapter,
      action: booted.ref,
      input: {},
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'core.effect_in_unit' });
    const rows = await booted.adapter.unit(
      namespace,
      tenant,
      async (unit) => (await unit.rows.find(effectEntity, {})).rows,
    );
    expect(rows).toEqual([]);
  });

  test('a perform records requested and settled in short units, answers the sealed output, writes start and end attempt records and leaves no live job', async () => {
    let answered: unknown;
    const booted = bootInline(
      function* (_input, ctx) {
        answered = yield* ctx.perform(pingDraft);
        return answered;
      },
      async () => ({ ok: true }),
    );
    await runDirect({
      registry: booted.registry,
      adapter: booted.adapter,
      action: booted.ref,
      input: {},
      commandId: 'c-inline-1',
    });
    expect(answered).toEqual({ ok: true, value: { ok: true } });
    const rows = await booted.adapter.unit(namespace, tenant, async (unit) => ({
      effects: (await unit.rows.find(effectEntity, {})).rows,
    }));
    expect(rows.effects).toHaveLength(1);
    const [row] = rows.effects;
    expect(row).toMatchObject({
      type: 'library.ping',
      status: 'succeeded',
      commandId: 'c-inline-1',
      attempts: 1,
      output: { ok: true },
    });
    const id = String(row?.id);
    const attempts = await inlineAttemptsOf(booted.adapter, id);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ attempt: 1 });
    expect(attempts[0]).not.toHaveProperty('endedAt');
    expect(attempts[1]).toMatchObject({ attempt: 1, endedAt: expect.any(String) });
    const live = await booted.adapter.unit(namespace, tenant, (unit) =>
      unit.jobs.keyed('effects', id),
    );
    expect(live).toBe(false);
    // The stream a rebuild folds: exactly the requested record and the settled one, in order.
    expect(await eventsOf(booted.adapter, 'core.effect', id)).toMatchObject([
      { type: 'core.effect.created', data: { values: { status: 'requested' } } },
      {
        type: 'core.effect.changed',
        data: { set: { status: 'succeeded', attempts: 1, output: { ok: true } } },
      },
    ]);
  });

  test('an executor that outlives its timeout settles failed with core.timeout after one attempt', async () => {
    let answered: { readonly ok: boolean; readonly error?: { readonly code: string } } | undefined;
    const booted = bootInline(
      function* (_input, ctx) {
        answered = (yield* ctx.perform(pingDraft)) as never;
        return answered;
      },
      () => new Promise(() => undefined),
      { timeout: '1s' },
    );
    await runDirect({
      registry: booted.registry,
      adapter: booted.adapter,
      action: booted.ref,
      input: {},
    });
    expect(answered).toMatchObject({ ok: false, error: { code: 'core.timeout' } });
    const rows = await booted.adapter.unit(
      namespace,
      tenant,
      async (unit) => (await unit.rows.find(effectEntity, {})).rows,
    );
    expect(rows[0]).toMatchObject({
      status: 'failed',
      attempts: 1,
      error: { code: 'core.timeout' },
    });
    expect(await inlineAttemptsOf(booted.adapter, String(rows[0]?.id))).toHaveLength(2);
  });

  test('an executor error is answered as a value and settles failed without a retry', async () => {
    let runs = 0;
    let answered: unknown;
    const booted = bootInline(
      function* (_input, ctx) {
        answered = yield* ctx.perform(pingDraft);
        return answered;
      },
      async () => {
        runs += 1;
        throw new Error('the destination refused');
      },
      { retry: { attempts: 5 } } as never,
    );
    await runDirect({
      registry: booted.registry,
      adapter: booted.adapter,
      action: booted.ref,
      input: {},
    });
    expect(runs).toBe(1);
    expect(answered).toMatchObject({ ok: false, error: { code: 'core.internal' } });
    const rows = await booted.adapter.unit(
      namespace,
      tenant,
      async (unit) => (await unit.rows.find(effectEntity, {})).rows,
    );
    expect(rows[0]).toMatchObject({ status: 'failed', attempts: 1 });
  });

  test('a retry with the same command id answers the recorded outcome and runs the executor once', async () => {
    let runs = 0;
    const answers: unknown[] = [];
    const booted = bootInline(
      function* (_input, ctx) {
        const outcome = yield* ctx.perform(pingDraft);
        answers.push(outcome);
        return outcome;
      },
      async () => {
        runs += 1;
        return { ok: true };
      },
    );
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await runDirect({
        registry: booted.registry,
        adapter: booted.adapter,
        action: booted.ref,
        input: {},
        commandId: 'c-inline-retry',
      });
    }
    expect(runs).toBe(1);
    expect(answers).toHaveLength(2);
    expect(answers[1]).toEqual(answers[0]);
  });

  test('an effect whose executor is not inline, an outside performer and an effect with continueWith are refused with core.request_not_allowed and nothing is stored', async () => {
    const queued = externalEffect('queued', async () => ({ ok: true }));
    const outside = externalEffect(
      'outside',
      async () => ({ ok: true }),
      {},
      {
        performer: 'external',
        executor: null,
      },
    );
    const inline = externalEffect('ping', async () => ({ ok: true }), { inline: true });
    const drafts = [
      { kind: 'external', type: 'library.queued', input: { to: 'a' } },
      { kind: 'external', type: 'library.outside', input: { to: 'a' } },
      { ...pingDraft, continueWith: 'library.probe' },
    ];
    for (const draft of drafts) {
      const registry = registryWith({
        effects: [queued.effect, outside.effect, inline.effect],
        executors: [queued.executor, inline.executor],
        actions: [
          command('probe', (() => []) as never, {
            prepare: function* (_input: unknown, ctx: InlinePrepareContext) {
              return yield* ctx.perform(draft);
            } as never,
          }),
        ],
      });
      const { adapter } = effectsKit(registry);
      const error = await runDirect({
        registry,
        adapter,
        action: 'library.probe',
        input: {},
      }).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ code: 'core.request_not_allowed' });
      const rows = await adapter.unit(
        namespace,
        tenant,
        async (unit) => (await unit.rows.find(effectEntity, {})).rows,
      );
      expect(rows).toEqual([]);
    }
  });

  test("the decision record carries prepare's reads, answers and inline effect ids, and its own effects stay the deferred ones", async () => {
    const queued = externalEffect('queued', async () => ({ ok: true }));
    const inline = externalEffect('ping', async () => ({ ok: true }), { inline: true });
    let minted: unknown;
    const registry = registryWith({
      effects: [queued.effect, inline.effect],
      executors: [queued.executor, inline.executor],
      actions: [
        command(
          'probe',
          ((_input: unknown, ctx: InlineWriteContext) => ({
            events: [ctx.write.library.book.create({ title: 'T', isbn: 'i-1', addedBy: 'ada' })],
            effects: [{ kind: 'external', type: 'library.queued', input: { to: 'a' } }],
          })) as never,
          {
            prepare: function* (_input: unknown, ctx: InlinePrepareContext) {
              yield* ctx.load.library.book.count();
              minted = yield* ctx.newId('library.book');
              return yield* ctx.perform(pingDraft);
            } as never,
          },
        ),
      ],
    });
    const { adapter } = effectsKit(registry);
    await runDirect({
      registry: registry,
      adapter,
      action: 'library.probe',
      input: {},
      commandId: 'c-inline-record',
    });
    const { books } = await snapshot(adapter);
    const events = (await snapshot(adapter, String(books[0]?.id))).events;
    const decision = events[0]?.decision;
    expect(decision?.effects).toEqual([deriveEffectId(tenant, 'c-inline-record', 0)]);
    const inlineId = deriveEffectId(tenant, 'prepare:c-inline-record', 0);
    expect(decision?.effects).not.toContain(inlineId);
    expect(decision?.prepare?.effects).toEqual([inlineId]);
    expect(decision?.prepare?.reads).toHaveLength(1);
    // Nothing derived from what prepare returned is kept.
    expect(Object.keys(decision?.prepare ?? {}).sort()).toEqual(['answers', 'effects', 'reads']);
    expect(decision?.prepare?.answers).toEqual([expect.objectContaining({ value: minted })]);
  });
});
