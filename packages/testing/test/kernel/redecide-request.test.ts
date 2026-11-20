import { createComputePool, entityBehavioursOf, normalizeRule } from '@keelwerk/core';
import { redecide } from '@keelwerk/core/replay';
import { afterEach, describe, expect, test } from 'vitest';
import { tenantAddress } from '../../src/replay/tenant-address.ts';
import { runDirect } from './support/command-kit.ts';
import { command, effectsKit, registryWith } from './support/effects-kit.ts';
import { redecideDirect } from './support/redecide-kit.ts';
import { type BootedKeep, bootKeep } from './support/replay-kit.ts';

interface WriteContext {
  readonly request: { readonly userAgent?: string; readonly transport: string };
  readonly write: {
    readonly library: { readonly book: { create(values: Record<string, unknown>): unknown } };
  };
  newId(entity: string): Generator<never, string, unknown>;
}

/** A command that writes a book titled with the user agent it read; `reading` false reads no request at all. */
function booted(reading: boolean) {
  const registry = registryWith({
    actions: [
      command('agent', function* (_input: unknown, ctx: WriteContext) {
        const id = yield* ctx.newId('library.book');
        return [
          ctx.write.library.book.create({
            id,
            title: reading
              ? `${ctx.request.transport} ${ctx.request.userAgent ?? 'none'}`
              : 'fixed',
            isbn: 'i-1',
            addedBy: 'ada',
          }),
        ];
      } as never),
    ],
  });
  return { registry, adapter: effectsKit(registry).adapter, ref: 'library.agent' };
}

/**
 * A command whose title is the user agent; with `both` it also branches on the transport being
 * `local` (never true for a recorded `rest` or a replayed request), so the events never differ.
 */
function branching(reads: 'agent' | 'both') {
  const registry = registryWith({
    actions: [
      command('branch', function* (_input: unknown, ctx: WriteContext) {
        const id = yield* ctx.newId('library.book');
        const local = reads === 'both' && ctx.request.transport === 'local';
        return [
          ctx.write.library.book.create({
            id,
            title: `${ctx.request.userAgent ?? 'none'}${local ? ' local' : ''}`,
            isbn: 'i-1',
            addedBy: 'ada',
          }),
        ];
      } as never),
    ],
  });
  return { registry, adapter: effectsKit(registry).adapter, ref: 'library.branch' };
}

const unrecorded =
  ' (a record without a request member was written before request recording, or by a decision that read none)';

const curl = { transport: 'rest', userAgent: 'curl/8.7.1', requestId: 'req-1' } as const;

describe('the request information a decision read (S-126)', () => {
  test('a decision that read the user agent re-decides from the recorded, sealed envelope without RedecideInput.request', async () => {
    const { registry, adapter, ref } = booted(true);
    await runDirect({
      registry,
      adapter,
      action: ref,
      input: {},
      commandId: 'c-req-1',
      request: curl,
    });
    const result = await redecideDirect({ registry, adapter, commandId: 'c-req-1', input: {} });
    expect(result.differences).toEqual([]);
    expect(result.reproduced).toBe(true);
    const request = result.recorded.decision?.request;
    // The command ran as a user in a tenant: the record is a $kwe envelope under the subject's data key.
    expect(request).toMatchObject({
      $kwe: 2,
      k: expect.any(String),
      n: expect.any(String),
      c: expect.any(String),
    });
    expect(JSON.stringify(result.recorded.decision)).not.toContain('curl');
    expect(result.recorded.events[0]?.data).toMatchObject({ values: { title: 'rest curl/8.7.1' } });
  });

  test('a decision that read no request has no request member', async () => {
    const { registry, adapter, ref } = booted(false);
    await runDirect({
      registry,
      adapter,
      action: ref,
      input: {},
      commandId: 'c-req-2',
      request: curl,
    });
    const result = await redecideDirect({ registry, adapter, commandId: 'c-req-2', input: {} });
    expect(result.reproduced).toBe(true);
    expect(result.recorded.decision).not.toHaveProperty('request');
  });

  test('a given user agent does not override the recorded one', async () => {
    const { registry, adapter, ref } = booted(true);
    await runDirect({
      registry,
      adapter,
      action: ref,
      input: {},
      commandId: 'c-req-3',
      request: curl,
    });
    const result = await redecideDirect({
      registry,
      adapter,
      commandId: 'c-req-3',
      input: {},
      request: { userAgent: 'something-else/1.0' },
    });
    expect(result.differences).toEqual([]);
    expect(result.reproduced).toBe(true);
  });

  test('a record without a request member takes the given user agent, as before', async () => {
    const { registry, adapter, ref } = booted(false);
    await runDirect({
      registry,
      adapter,
      action: ref,
      input: {},
      commandId: 'c-req-4',
      request: curl,
    });
    const asked = booted(true);
    // The same decision re-decided by a build that now reads the agent: the record has no request,
    // so the given agent is what it reads, and the events differ from the recorded title.
    const result = await redecideDirect({
      registry: asked.registry,
      adapter,
      commandId: 'c-req-4',
      input: {},
      request: { userAgent: 'given/1.0' },
    });
    expect(result.reproduced).toBe(false);
    expect(result.differences).toEqual(
      expect.arrayContaining([
        `the decision now reads request member 'transport', which the record did not keep${unrecorded}`,
        `the decision now reads request member 'userAgent', which the record did not keep${unrecorded}`,
      ]),
    );
  });

  test('a build that also branches on the transport is a difference naming the member', async () => {
    const recorded = branching('agent');
    await runDirect({
      registry: recorded.registry,
      adapter: recorded.adapter,
      action: recorded.ref,
      input: {},
      commandId: 'c-req-5',
      request: curl,
    });
    const same = await redecideDirect({
      registry: recorded.registry,
      adapter: recorded.adapter,
      commandId: 'c-req-5',
      input: {},
    });
    expect(same.differences).toEqual([]);
    const asked = branching('both');
    const result = await redecideDirect({
      registry: asked.registry,
      adapter: recorded.adapter,
      commandId: 'c-req-5',
      input: {},
    });
    expect(result.reproduced).toBe(false);
    expect(result.differences).toEqual([
      "the decision now reads request member 'transport', which the record did not keep",
    ]);
  });

  test('a build that no longer reads a kept member is a difference naming the member', async () => {
    const recorded = branching('both');
    await runDirect({
      registry: recorded.registry,
      adapter: recorded.adapter,
      action: recorded.ref,
      input: {},
      commandId: 'c-req-6',
      request: curl,
    });
    const asked = branching('agent');
    const result = await redecideDirect({
      registry: asked.registry,
      adapter: recorded.adapter,
      commandId: 'c-req-6',
      input: {},
    });
    expect(result.reproduced).toBe(false);
    expect(result.differences).toEqual(["the decision no longer reads request member 'transport'"]);
  });
});

describe('a re-decide outside the feed horizon', () => {
  let keep: BootedKeep | undefined;
  afterEach(async () => {
    await keep?.runtime.stop();
  });

  test('a re-decide outside the feed horizon still refuses with core.replay_outside_horizon', {
    timeout: 60_000,
  }, async () => {
    keep = await bootKeep('memory');
    const issued = (await keep.call<{ token: string }>('keep.issue', {})).value;
    const redeemed = await keep.call('keep.redeem', { token: issued.token });
    keep.clock.advance(24 * 8);
    const { runtime } = keep;
    const address = tenantAddress(runtime);
    const compute = createComputePool({ size: 1 });
    const result = await redecide({
      registry: runtime.app.registry,
      adapter: runtime.sealed,
      namespace: address.namespace,
      scope: address.scope,
      commandId: redeemed.commandId,
      apiVersion: runtime.head,
      behaviours: entityBehavioursOf(runtime.app.modules),
      rules: [...runtime.app.registry.rules.values()].map(normalizeRule),
      keys: runtime.keys,
      compute,
      clock: runtime.clock,
      log: runtime.log,
      trace: runtime.tracer.startSpan('redecide'),
      input: { token: issued.token },
    }).finally(() => compute.close());
    expect(result.refused).toBe('core.replay_outside_horizon');
  });
});
