import { describe, expect, test } from 'vitest';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { expectReproduces } from '../../src/replay/expect-reproduces.ts';
import { runDirect } from './support/command-kit.ts';
import { command, effectEntity, externalEffect, registryWith } from './support/effects-kit.ts';
import { startHookEndpoint } from './support/hook-endpoint.ts';
import { hooksApp } from './support/hooks-kit.ts';
import {
  bootInline,
  type InlinePrepareContext,
  type InlineWriteContext,
  pingDraft,
} from './support/inline-kit.ts';
import { redecideDirect } from './support/redecide-kit.ts';
import { namespace, tenant } from './support/run-read-kit.ts';

const decide = function* (_input: unknown, ctx: InlineWriteContext & InlineIdContext) {
  const id = yield* ctx.newId('library.book');
  return [ctx.write.library.book.create({ id, title: 'T', isbn: 'i-1', addedBy: 'ada' })];
} as never;

function* preparing(_input: unknown, ctx: InlinePrepareContext) {
  const count = yield* ctx.load.library.book.count();
  const answer = yield* ctx.perform(pingDraft);
  return { count, ok: answer.ok };
}

/** A command that loads, performs an inline effect and writes a book; `executed` counts the executor runs. */
function booted() {
  const state = { executed: 0 };
  const inline = bootInline(
    preparing as never,
    async () => {
      state.executed += 1;
      return { ok: true };
    },
    {},
    decide,
  );
  return { ...inline, state };
}

interface InlineIdContext {
  newId(entity: string): Generator<never, string, unknown>;
}

describe('re-deciding a command whose prepare loads and performs an inline effect (7.9.6, S-126)', () => {
  test('a prepare that loads and performs an inline effect re-decides: reads, answers and effect ids as recorded, the executor not run again', async () => {
    const { registry, adapter, ref, state } = booted();
    await runDirect({ registry, adapter, action: ref, input: {}, commandId: 'c-prepare-1' });
    expect(state.executed).toBe(1);
    const result = await redecideDirect({ registry, adapter, commandId: 'c-prepare-1', input: {} });
    expect(result.differences).toEqual([]);
    expect(result.reproduced).toBe(true);
    expect(state.executed).toBe(1);
    const { prepare } = result.recorded.decision ?? {};
    expect(prepare).toMatchObject({
      reads: [{ at: expect.any(String) }],
      effects: [expect.any(String)],
    });
    expect(result.redecided.decision?.prepare).toEqual(prepare);
  });

  test("prepare reading another row now differs: the record's prepare reads differ", async () => {
    const { registry, adapter, ref } = booted();
    await runDirect({ registry, adapter, action: ref, input: {}, commandId: 'c-prepare-2' });
    const changed = registryWith({
      effects: [...registry.effects.values()],
      executors: [...registry.executors.values()],
      actions: [
        command('probe', decide, {
          prepare: function* (_input: unknown, ctx: InlinePrepareContext) {
            const answer = yield* ctx.perform(pingDraft);
            return { count: 0, ok: answer.ok };
          } as never,
        }),
      ],
    });
    const result = await redecideDirect({
      registry: changed,
      adapter,
      commandId: 'c-prepare-2',
      input: {},
    });
    expect(result.reproduced).toBe(false);
    expect(result.differences).toContain("the decision record's prepare differs");
  });

  /** The booted command's registry with `prepare` replaced and a second inline effect, `library.pong`, declared. */
  function rebuilt(registry: ReturnType<typeof booted>['registry'], draft: unknown) {
    const pong = externalEffect('pong', async () => ({ ok: true }), { inline: true });
    return registryWith({
      effects: [...registry.effects.values(), pong.effect],
      executors: [...registry.executors.values(), pong.executor],
      actions: [
        command('probe', decide, {
          prepare: function* (_input: unknown, ctx: InlinePrepareContext) {
            const count = yield* ctx.load.library.book.count();
            const answer = yield* ctx.perform(draft);
            return { count, ok: answer.ok };
          } as never,
        }),
      ],
    });
  }

  test('a prepare that now performs an effect of another type differs although the effect id is the same', async () => {
    const { registry, adapter, ref } = booted();
    await runDirect({ registry, adapter, action: ref, input: {}, commandId: 'c-prepare-4' });
    const result = await redecideDirect({
      registry: rebuilt(registry, { ...pingDraft, type: 'library.pong' }),
      adapter,
      commandId: 'c-prepare-4',
      input: {},
    });
    expect(result.reproduced).toBe(false);
    expect(result.differences).toEqual([
      expect.stringContaining('was requested as library.ping and is now library.pong'),
    ]);
  });

  test('a prepare that now performs the same effect with another input differs', async () => {
    const { registry, adapter, ref } = booted();
    await runDirect({ registry, adapter, action: ref, input: {}, commandId: 'c-prepare-5' });
    const result = await redecideDirect({
      registry: rebuilt(registry, { ...pingDraft, input: { to: 'bea@example.org' } }),
      adapter,
      commandId: 'c-prepare-5',
      input: {},
    });
    expect(result.reproduced).toBe(false);
    expect(result.differences).toEqual([expect.stringContaining('the input of the effect')]);
    expect(result.differences[0]).toContain('differs in "to"');
  });

  test('the same effect with the same input still reproduces', async () => {
    const { registry, adapter, ref } = booted();
    await runDirect({ registry, adapter, action: ref, input: {}, commandId: 'c-prepare-6' });
    const result = await redecideDirect({
      registry: rebuilt(registry, pingDraft),
      adapter,
      commandId: 'c-prepare-6',
      input: {},
    });
    expect(result.differences).toEqual([]);
  });

  test('a prepare that hands ctx.clock.now() to decide re-decides as reproducing although an inline effect takes longer than a millisecond', async () => {
    const stamped = function* (
      _input: unknown,
      ctx: InlineWriteContext & InlineIdContext & { readonly prepared: { readonly at: string } },
    ) {
      const id = yield* ctx.newId('library.book');
      return [
        ctx.write.library.book.create({
          id,
          title: ctx.prepared.at,
          isbn: 'i-clock',
          addedBy: 'ada',
        }),
      ];
    } as never;
    const stamping = function* (
      _input: unknown,
      ctx: InlinePrepareContext & { readonly clock: { now(): Temporal.Instant } },
    ) {
      const at = ctx.clock.now().toString();
      const answer = yield* ctx.perform(pingDraft);
      return { at, ok: answer.ok };
    };
    const inline = bootInline(
      stamping as never,
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return { ok: true };
      },
      {},
      stamped,
    );
    await runDirect({
      registry: inline.registry,
      adapter: inline.adapter,
      action: inline.ref,
      input: {},
      commandId: 'c-prepare-clock',
    });
    const result = await redecideDirect({
      registry: inline.registry,
      adapter: inline.adapter,
      commandId: 'c-prepare-clock',
      input: {},
    });
    expect(result.differences).toEqual([]);
    expect(result.reproduced).toBe(true);
    // The instant the prepare read is the one the decision recorded, written into the row.
    expect(result.recorded.events[0]?.data).toMatchObject({
      values: { title: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) },
    });
  });

  test('an inline effect row still requested refuses: cannot re-decide', async () => {
    const { registry, adapter, ref } = booted();
    await runDirect({ registry, adapter, action: ref, input: {}, commandId: 'c-prepare-3' });
    await adapter.unit(namespace, tenant, async (unit) => {
      const [row] = (await unit.rows.find(effectEntity, {})).rows;
      if (row === undefined) throw new Error('the inline effect left no row');
      await unit.rows.update(effectEntity, [
        {
          id: String(row.id),
          expectedVersion: Number(row.version),
          values: { ...row, version: Number(row.version) + 1, status: 'requested' },
        },
      ]);
    });
    const result = await redecideDirect({ registry, adapter, commandId: 'c-prepare-3', input: {} });
    expect(result.reproduced).toBe(false);
    expect(result.differences).toEqual([
      expect.stringMatching(/^cannot re-decide: .*has not settled/),
    ]);
  });

  test('a decision that wrote only inline effect records (hooks.testEndpoint) answers validation: no decision record', {
    timeout: 90_000,
  }, async () => {
    const endpoint = await startHookEndpoint();
    const runtime = await startTestRuntime(hooksApp, {
      tenants: ['acme'],
      operators: true,
      config: { hooks: { endpoint: endpoint.url, signingKey: 'hook-signing-key' } },
      workers: { queues: ['posts', 'probes', 'commands'], egress: { allow: ['127.0.0.0/8'] } },
    });
    try {
      const commandId = crypto.randomUUID();
      const outcome = await runtime.invoker.invoke({
        action: 'hooks.testEndpoint',
        input: {},
        carrier: testCarrier(runtime.tenants.acme, testOperator()),
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
        commandId,
      });
      expect(outcome.ok).toBe(true);
      await expect(expectReproduces(runtime, { commandId, input: {} })).rejects.toMatchObject({
        kind: 'validation',
        message: expect.stringContaining('wrote no events with a decision record'),
      });
    } finally {
      await runtime.stop();
      await endpoint.close();
    }
  });
});
