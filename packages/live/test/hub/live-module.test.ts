import {
  contracts,
  core,
  defineApp,
  defineContribution,
  defineModule,
  defineModuleBase,
  defineRule,
  defineSubscription,
  field,
  shape,
} from '@keelwerk/core';
import { startTestRuntime, testCarrier, testPrincipal } from '@keelwerk/testing';
import { library, loans } from '@keelwerk/testing/fixtures';
import { describe, expect, test } from 'vitest';
import { live } from '../../src/live-module.ts';

const tickerBase = defineModuleBase({ id: 'ticker', version: '0.1.0', optional: [contracts.live] });
const feed = defineSubscription(tickerBase, {
  event: shape({ id: field.string() }),
  principal: 'user',
  source: () => ({ kind: 'liveSource' as const }),
});
const ticker = defineModule(tickerBase, {
  actions: { feed },
  policies: {
    feed: { users: defineRule(tickerBase, feed, { effect: 'allow', principal: 'user' }) },
  },
});

async function firstOf(
  app: Parameters<typeof startTestRuntime>[0],
  action: string,
  who = testPrincipal('ada'),
) {
  const runtime = await startTestRuntime(app, { tenants: ['acme'] });
  try {
    const iterator = runtime.invoker
      .subscribe({
        action,
        input: {},
        carrier: testCarrier(runtime.tenants.acme, who),
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
      })
      [Symbol.asyncIterator]();
    return await iterator.next().then(
      () => undefined,
      (error: unknown) => error as { kind: string; code: string },
    );
  } finally {
    await runtime.stop();
  }
}

describe('the live module', () => {
  test('with live the conformance modules serve loans.loanEvents', async () => {
    const withLive = defineApp({ id: 'loans-live', modules: [live, library, loans] });
    const without = defineApp({ id: 'loans-plain', modules: [library, loans] });
    expect(withLive.registry.actions.has('loans.loanEvents')).toBe(true);
    expect(without.registry.actions.has('loans.loanEvents')).toBe(false);
    // The action is there and reaches the gate: a signed-in user may follow, nobody else.
    expect(await firstOf(withLive, 'loans.loanEvents')).toBeUndefined();
    expect(await firstOf(withLive, 'loans.loanEvents', testPrincipal(null))).toMatchObject({
      kind: 'unauthenticated',
    });
  });

  test('without live subscribe is core.live_unavailable', async () => {
    const app = defineApp({ id: 'ticker-app', modules: [ticker] });
    expect(await firstOf(app, 'ticker.feed')).toMatchObject({
      kind: 'unavailable',
      code: 'core.live_unavailable',
    });
  });

  test('the module provides the live contract and fills the core hub point', () => {
    const app = defineApp({ id: 'ticker-live', modules: [live, ticker] });
    expect(app.registry.fills.get('core.liveHub')?.some((fill) => fill.module === 'live')).toBe(
      true,
    );
    expect(app.registry.modules.map((module) => module.id)).toContain('live');
  });
  test('a liveHub fill not made by defineLiveHub refuses the start with internal', async () => {
    const plainBase = defineModuleBase({
      id: 'live',
      version: '0.1.0',
      provides: [contracts.live],
      contributions: { toCore: defineContribution(core, {}) },
    });
    // A hub as a plain value, which is what the point took before it learnt to open one hub for each runtime.
    const plainHub = {
      entity: () => ({}),
      pokes: () => ({}),
      stream: () => ({}),
      topic: () => ({}),
    };
    const plain = defineModule(plainBase, {
      contributes: { toCore: { extensionPoints: { liveHub: [plainHub as never] } } },
    });
    const app = defineApp({ id: 'plain-hub', modules: [plain as unknown as typeof live, ticker] });
    await expect(startTestRuntime(app, { tenants: ['acme'] })).rejects.toMatchObject({
      kind: 'internal',
      message: 'The liveHub point takes a value made by defineLiveHub.',
    });
  });

  test('a real loans.loanEvents item reaches its subscriber, translated to its event shape', async () => {
    // The conformance modules carry no rule for the subscription yet: this one allows signed-in users.
    const allowEvents = {
      id: 'loans.loanEvents.app',
      module: 'loans',
      effect: 'allow',
      subject: { module: 'loans' },
      actions: ['loanEvents'],
      principal: 'user',
      disabled: false,
    };
    const app = defineApp({
      id: 'loans-events',
      modules: [live, library, loans],
      policies: { add: [allowEvents] },
    });
    const runtime = await startTestRuntime(app, { tenants: ['acme'] });
    try {
      const ada = testPrincipal('ada');
      const carrier = testCarrier(runtime.tenants.acme, ada);
      const iterator = runtime.invoker
        .subscribe<unknown, { loanId: string; kind: string }>({
          action: 'loans.loanEvents',
          input: {},
          carrier,
          requestId: crypto.randomUUID(),
          signal: new AbortController().signal,
        })
        [Symbol.asyncIterator]();
      expect(await iterator.next()).toMatchObject({ value: { control: 'head' } });
      const lent = await runtime.invoker.invoke<unknown, { loanId: string }>({
        action: 'loans.lend',
        input: { bookTitle: 'Dune', dueAt: '2026-12-01T00:00:00Z' },
        carrier,
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
        commandId: crypto.randomUUID(),
      });
      if (!lent.ok) throw lent.error;
      const item = await iterator.next();
      expect(item.value).toMatchObject({
        event: { loanId: lent.value.loanId, kind: 'created' },
        state: expect.stringMatching(/^v2\./),
      });
      await iterator.return?.();
    } finally {
      await runtime.stop();
    }
  });
});
