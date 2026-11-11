import { errors } from '@keelwerk/core';
import { testPrincipal } from '@keelwerk/testing';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { revalidateSessions } from '../../src/hub/revalidate-sessions.ts';
import { fullLive } from '../support/full-live.ts';
import { gated } from '../support/gated-module.ts';
import { startLiveApp } from '../support/live-app-kit.ts';
import {
  movingClock,
  quietLogger,
  settleTimers,
  startedAt,
  subscriptionOf,
} from '../support/revalidation-kit.ts';

vi.setConfig({ testTimeout: 60_000 });

describe('revalidateSessions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('renews a session due by the interval, counted from when it was first seen', async () => {
    const { clock, to } = movingClock();
    const { subscription, events } = subscriptionOf();
    const revalidator = revalidateSessions({
      clock,
      log: quietLogger,
      intervalMs: 60_000,
      tickMs: 5,
      subscriptions: () => [subscription],
    });
    revalidator.attached(1);
    await vi.advanceTimersByTimeAsync(20);
    expect(events).toEqual([]);
    to(61);
    await vi.advanceTimersByTimeAsync(10);
    expect(events).toEqual(['revalidate', 'renew']);
    // Not again before another interval has passed.
    await vi.advanceTimersByTimeAsync(30);
    expect(events).toEqual(['revalidate', 'renew']);
    revalidator.close();
  });

  test('revalidates at expiresAt', async () => {
    const { clock, to } = movingClock();
    const { subscription, events } = subscriptionOf({ expiresAt: startedAt.add({ seconds: 10 }) });
    const revalidator = revalidateSessions({
      clock,
      log: quietLogger,
      intervalMs: 60_000,
      tickMs: 5,
      subscriptions: () => [subscription],
    });
    revalidator.attached(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(events).toEqual([]);
    to(11);
    await vi.advanceTimersByTimeAsync(10);
    expect(events[0]).toBe('revalidate');
    revalidator.close();
  });

  test('a revoked principal ends the stream unauthenticated, and a reopen that throws fails closed', async () => {
    const { clock } = movingClock();
    const revoked = subscriptionOf({
      reopen: async () => ({ ok: false, error: errors.unauthenticated('Gone.') }),
    });
    const broken = subscriptionOf({
      reopen: async () => {
        throw new Error('the store is down');
      },
    });
    const revalidator = revalidateSessions({
      clock,
      log: quietLogger,
      intervalMs: 60_000,
      tickMs: 5,
      subscriptions: () => [],
    });
    await revalidator.revalidate(revoked.subscription);
    await revalidator.revalidate(broken.subscription);
    expect(revoked.events).toEqual(['revalidate', 'fail:unauthenticated']);
    expect(broken.events).toEqual(['revalidate', 'fail:unavailable']);
  });

  test('one revalidation per subscription runs at a time, and one asked for meanwhile runs once more after it', async () => {
    const { clock } = movingClock();
    const releases: Array<() => void> = [];
    let running = 0;
    let overlap = 0;
    const { subscription, events } = subscriptionOf({
      reopen: () =>
        new Promise((resolve) => {
          running += 1;
          overlap = Math.max(overlap, running);
          releases.push(() => {
            running -= 1;
            resolve({ ok: true, value: subscription.session });
          });
        }),
    });
    const revalidator = revalidateSessions({
      clock,
      log: quietLogger,
      intervalMs: 60_000,
      tickMs: 5,
      subscriptions: () => [],
    });
    const first = revalidator.revalidate(subscription);
    const second = revalidator.revalidate(subscription);
    const third = revalidator.revalidate(subscription);
    await settleTimers();
    expect(releases).toHaveLength(1);
    releases[0]?.();
    await settleTimers();
    // The two requests that came while the first ran share one run that starts after it.
    expect(releases).toHaveLength(2);
    releases[1]?.();
    await Promise.all([first, second, third]);
    expect(events.filter((event) => event === 'revalidate')).toHaveLength(2);
    expect(overlap).toBe(1);
  });

  test('a request waiting behind a run that failed the subscription starts no run of its own', async () => {
    const { clock } = movingClock();
    const releases: Array<() => void> = [];
    const { subscription, events } = subscriptionOf({
      reopen: () =>
        new Promise((resolve) => {
          releases.push(() =>
            resolve({ ok: false, error: errors.forbidden('No longer allowed.') }),
          );
        }),
    });
    const revalidator = revalidateSessions({
      clock,
      log: quietLogger,
      intervalMs: 60_000,
      tickMs: 5,
      subscriptions: () => [],
    });
    const first = revalidator.revalidate(subscription);
    const second = revalidator.revalidate(subscription);
    await settleTimers();
    expect(releases).toHaveLength(1);
    releases[0]?.();
    await Promise.all([first, second]);
    expect(releases).toHaveLength(1);
    expect(events).toEqual(['revalidate', 'fail:forbidden']);
  });

  test('a revocation that arrives while a timer revalidation is in flight still ends the stream before any item', async () => {
    const { clock, to } = movingClock();
    let release: (() => void) | undefined;
    let reads = 0;
    const { subscription, events } = subscriptionOf({
      reopen: async () => {
        reads += 1;
        if (reads === 1) {
          // The first run read the pass before it was revoked and is held until the test says so.
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return { ok: true, value: subscription.session };
        }
        return { ok: false, error: errors.unauthenticated('Revoked.') };
      },
    });
    const revalidator = revalidateSessions({
      clock,
      log: quietLogger,
      intervalMs: 60_000,
      tickMs: 5,
      subscriptions: () => [subscription],
    });
    revalidator.attached(1);
    await vi.advanceTimersByTimeAsync(10);
    to(61);
    await vi.advanceTimersByTimeAsync(10);
    expect(events).toEqual(['revalidate']);
    // The batch that carries the revocation asks for a revalidation of its own; no item is delivered until it answers.
    const delivered: string[] = [];
    const forBatch = revalidator.revalidate(subscription).then(() => {
      if (!events.includes('fail:unauthenticated')) delivered.push('item');
    });
    release?.();
    await forBatch;
    expect(events).toEqual(['revalidate', 'renew', 'revalidate', 'fail:unauthenticated']);
    expect(delivered).toEqual([]);
    revalidator.close();
  });

  test('after close no revalidation runs and a late result renews nothing', async () => {
    const { clock, to } = movingClock();
    let release: (() => void) | undefined;
    const { subscription, events } = subscriptionOf({
      reopen: () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, value: subscription.session });
        }),
    });
    const revalidator = revalidateSessions({
      clock,
      log: quietLogger,
      intervalMs: 1000,
      tickMs: 5,
      subscriptions: () => [subscription],
    });
    const pending = revalidator.revalidate(subscription);
    await settleTimers();
    revalidator.close();
    release?.();
    await pending;
    expect(events).toEqual(['revalidate']);
    to(5000);
    await vi.advanceTimersByTimeAsync(10);
    await revalidator.revalidate(subscription);
    expect(events).toEqual(['revalidate']);
  });
});

describe.each(['memory', 'pglite'] as const)('the hub revalidates sessions on %s', (adapter) => {
  test('a ticket session whose principal lost the rule’s role ends forbidden', async () => {
    const hubs = fullLive({ revalidateMs: 60_000, revalidateTickMs: 20 });
    const kit = await startLiveApp(adapter, hubs.module, { extra: [gated] });
    try {
      const viewer = testPrincipal('vic', { roles: ['viewer'] });
      const issued = await kit.call<{ ticket: string }>(kit.acme, viewer, 'live.ticket', {});
      const followed = kit.follow(kit.ticket(kit.acme, issued.ticket), { action: 'gated.watch' });
      await followed.until((frames) => frames.some((frame) => 'control' in frame));
      // The principal's roles are gone now: the next resolution of the reference answers without them.
      await kit.call(kit.acme, testPrincipal('vic'), 'live.ticket', {});
      // The first move of the clock may come before the hub has seen the subscription on a tick (the
      // interval counts from then), so the clock moves a minute at a time until the stream has ended.
      let at = Temporal.Now.instant();
      await vi.waitFor(
        async () => {
          at = at.add({ seconds: 61 });
          await kit.runtime.advanceTo(at);
          expect(followed.ended()).toBe(true);
        },
        { timeout: 20_000, interval: 20 },
      );
      expect(followed.failure()).toMatchObject({ kind: 'forbidden' });
    } finally {
      await kit.stop();
    }
  });

  test('a stream of a principal that stays valid renews and goes on', async () => {
    const hubs = fullLive({ revalidateMs: 60_000, revalidateTickMs: 20 });
    const kit = await startLiveApp(adapter, hubs.module, { extra: [gated] });
    try {
      const viewer = testPrincipal('vic', { roles: ['viewer'] });
      const followed = kit.follow(
        {
          transport: 'test',
          headers: { 'x-tenant': kit.acme.id, 'x-test-principal': JSON.stringify(viewer) },
        },
        { action: 'gated.watch' },
      );
      await followed.until((frames) => frames.some((frame) => 'control' in frame));
      const [hub] = hubs.opened;
      const before = hub?.subscriptions()[0]?.session;
      let at = Temporal.Now.instant();
      await vi.waitFor(
        async () => {
          at = at.add({ seconds: 61 });
          await kit.runtime.advanceTo(at);
          expect(hub?.subscriptions()[0]?.session).not.toBe(before);
        },
        { timeout: 20_000, interval: 20 },
      );
      expect(followed.ended()).toBe(false);
      await followed.stop();
    } finally {
      await kit.stop();
    }
  });
});
