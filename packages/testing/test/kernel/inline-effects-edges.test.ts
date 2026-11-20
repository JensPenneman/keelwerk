import type { DataAdapter, Principal, StorageRow } from '@keelwerk/core';
import { deriveEffectId, field, shape } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { runDirect } from './support/command-kit.ts';
import {
  command,
  effectEntity,
  effectsKit,
  externalEffect,
  registryWith,
} from './support/effects-kit.ts';
import {
  bootInline,
  type InlinePrepareContext,
  inlineAttemptsOf,
  pingDraft,
} from './support/inline-kit.ts';
import { namedPrincipal } from './support/inline-pair-kit.ts';
import { namespace, stamp, tenant } from './support/run-read-kit.ts';

const effectRowsOf = (adapter: DataAdapter): Promise<readonly StorageRow[]> =>
  adapter.unit(namespace, tenant, async (unit) => (await unit.rows.find(effectEntity, {})).rows);

describe('inline effects: answers and aborted runs', () => {
  test('a retry answers an output with an instant member exactly as the live run did', async () => {
    const answers: unknown[] = [];
    const booted = bootInline(
      function* (_input, ctx) {
        const outcome = yield* ctx.perform(pingDraft);
        answers.push(outcome);
        return outcome;
      },
      async () => ({ at: Temporal.Instant.from('2026-11-19T10:00:00Z') }),
      {},
      () => [],
      { output: shape({ at: field.instant() }) },
    );
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await runDirect({
        registry: booted.registry,
        adapter: booted.adapter,
        action: booted.ref,
        input: {},
        commandId: 'c-inline-instant',
      });
    }
    expect(answers).toHaveLength(2);
    expect(answers[0]).toEqual({ ok: true, value: { at: '2026-11-19T10:00:00Z' } });
    expect(answers[1]).toEqual(answers[0]);
  });

  test('a run aborted inside prepare before the perform rejects with the reason and writes nothing', async () => {
    let runs = 0;
    const controller = new AbortController();
    const reason = new Error('stopped before the perform');
    const booted = bootInline(
      function* (_input, ctx) {
        controller.abort(reason);
        return yield* ctx.perform(pingDraft);
      },
      async () => {
        runs += 1;
        return { ok: true };
      },
    );
    await expect(
      runDirect({
        registry: booted.registry,
        adapter: booted.adapter,
        action: booted.ref,
        input: {},
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(runs).toBe(0);
    expect(await effectRowsOf(booted.adapter)).toEqual([]);
  });

  test('a run aborted after the begin unit and before the executor starts settles failed, never calls the executor and rejects with the reason', async () => {
    let runs = 0;
    const controller = new AbortController();
    const reason = new Error('stopped before the executor');
    let begun = false;
    let continued = false;
    const booted = bootInline(
      function* (_input, ctx) {
        const outcome = yield* ctx.perform(pingDraft);
        continued = true;
        return outcome;
      },
      async () => {
        runs += 1;
        return { ok: true };
      },
    );
    const adapter: DataAdapter = {
      ...booted.adapter,
      unit: async (ns, scope, fn, options) => {
        const answered = await booted.adapter.unit(ns, scope, fn, options);
        if (options?.readOnly !== true && !begun) {
          begun = true;
          controller.abort(reason);
        }
        return answered;
      },
    };
    await expect(
      runDirect({
        registry: booted.registry,
        adapter,
        action: booted.ref,
        input: {},
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(runs).toBe(0);
    // The perform rejected: prepare did not go on under an aborted signal.
    expect(continued).toBe(false);
    const rows = await effectRowsOf(booted.adapter);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'failed' });
    expect(JSON.stringify(rows[0])).not.toContain('core.effect_outcome_unknown');
  });

  test('an abort inside the begin unit stores nothing, rejects with the reason, and a retry runs the effect', async () => {
    let runs = 0;
    const controller = new AbortController();
    const reason = new Error('stopped inside the begin unit');
    const booted = bootInline(
      function* (_input, ctx) {
        return yield* ctx.perform(pingDraft);
      },
      async () => {
        runs += 1;
        return { ok: true };
      },
    );
    let aborted = false;
    const adapter: DataAdapter = {
      ...booted.adapter,
      unit: (ns, scope, fn, options) =>
        booted.adapter.unit(
          ns,
          scope,
          (unit) =>
            fn({
              ...unit,
              rows: {
                ...unit.rows,
                findOne: async (descriptor, query) => {
                  const found = await unit.rows.findOne(descriptor, query);
                  if (options?.readOnly !== true && !aborted) {
                    aborted = true;
                    controller.abort(reason);
                  }
                  return found;
                },
              },
            }),
          options,
        ),
    };
    const run = (signal?: AbortSignal) =>
      runDirect({
        registry: booted.registry,
        adapter,
        action: booted.ref,
        input: {},
        commandId: 'c-abort-begin',
        ...(signal === undefined ? {} : { signal }),
      });
    await expect(run(controller.signal)).rejects.toBe(reason);
    expect(aborted).toBe(true);
    expect(runs).toBe(0);
    expect(await effectRowsOf(booted.adapter)).toEqual([]);
    const id = deriveEffectId(tenant, 'prepare:c-abort-begin', 0);
    expect(await inlineAttemptsOf(booted.adapter, id)).toEqual([]);
    expect(
      await booted.adapter.unit(namespace, tenant, (unit) => unit.jobs.keyed('effects', id)),
    ).toBe(false);
    const result = await run(new AbortController().signal);
    expect(result).toBeDefined();
    expect(runs).toBe(1);
    expect(await effectRowsOf(booted.adapter)).toMatchObject([{ status: 'succeeded' }]);
  });
});

describe('inline effects: a row answers only the run that wrote it', () => {
  const principalOf = namedPrincipal;
  const prepareOf = (draft: unknown, seen: unknown[]) =>
    function* (_input: unknown, ctx: InlinePrepareContext) {
      const outcome = yield* ctx.perform(draft);
      seen.push(outcome);
      return outcome;
    } as never;
  const pongDraft = { kind: 'external', type: 'library.pong', input: { to: 'ada@example.org' } };

  test('another principal with the same command id is refused before its prepare is answered or its executor runs', async () => {
    let runs = 0;
    const seen: unknown[] = [];
    const booted = bootInline(prepareOf(pingDraft, seen) as never, async () => {
      runs += 1;
      return { ok: true };
    });
    const run = (principal: Principal) =>
      runDirect({
        registry: booted.registry,
        adapter: booted.adapter,
        action: booted.ref,
        input: {},
        commandId: 'c-shared-id',
        principal,
      });
    await run(principalOf('ada'));
    const error = await run(principalOf('bea')).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'core.idempotency_mismatch' });
    expect(runs).toBe(1);
    expect(seen).toHaveLength(1);
  });

  test('another effect type at the same id is refused and its executor never runs', async () => {
    let pongs = 0;
    const seen: unknown[] = [];
    const ping = externalEffect('ping', async () => ({ ok: true }), { inline: true });
    const pong = externalEffect(
      'pong',
      async () => {
        pongs += 1;
        return { ok: true };
      },
      { inline: true },
    );
    const registry = registryWith({
      effects: [ping.effect, pong.effect],
      executors: [ping.executor, pong.executor],
      actions: [
        command('probe', (() => []) as never, { prepare: prepareOf(pingDraft, seen) }),
        command('probeOther', (() => []) as never, { prepare: prepareOf(pongDraft, seen) }),
      ],
    });
    const { adapter } = effectsKit(registry);
    const run = (action: string) =>
      runDirect({ registry, adapter, action, input: {}, commandId: 'c-same-id' });
    await run('library.probe');
    const error = await run('library.probeOther').catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'core.idempotency_mismatch' });
    expect(pongs).toBe(0);
    expect(seen).toHaveLength(1);
  });

  test('an id reused after the receipt window is refused, inside the window it is answered again', async () => {
    let runs = 0;
    const seen: unknown[] = [];
    const booted = bootInline(prepareOf(pingDraft, seen) as never, async () => {
      runs += 1;
      return { ok: true };
    });
    const at = (hours: number) => ({ now: () => stamp.add({ hours }) });
    const run = (hours: number) =>
      runDirect({
        registry: booted.registry,
        adapter: booted.adapter,
        action: booted.ref,
        input: {},
        commandId: 'c-window-id',
        clock: at(hours),
      });
    await run(0);
    await run(23);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual(seen[0]);
    const error = await run(25).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'core.idempotency_mismatch' });
    expect(runs).toBe(1);
    expect(seen).toHaveLength(2);
  });
});
