import { splitTimerKey } from '@keelwerk/core';
import { afterAll, describe, expect, test } from 'vitest';
import { tickerKeyDigest } from './support/ticker-key-digest.ts';
import type { TickerKit } from './support/ticker-kit.ts';
import { bootTicker, seededAt } from './support/ticker-kit.ts';

const later = (seconds: number) => seededAt.add({ seconds });
const adapters = ['memory', 'pglite'] as const;

describe.each(adapters)('timer owners on %s', (adapter) => {
  const kits: TickerKit[] = [];
  const boot = async (workers?: false) => {
    const kit = await bootTicker({ adapter, ...(workers === false ? { workers } : {}) });
    kits.push(kit);
    return kit;
  };
  afterAll(async () => {
    for (const kit of kits) await kit.stop();
  });
  const tickerFired = async (kit: TickerKit) =>
    (await kit.rows('acme', 'ticker.tick'))
      .filter((row) => row.schedule === 'timer')
      .map((row) => row.at);
  const echoFired = async (kit: TickerKit) =>
    (await kit.rows('acme', 'echo.tick')).map((row) => row.at);
  const armBoth = async (kit: TickerKit) => {
    expect((await kit.call('acme', 'ticker.armTimer', { at: 't' })).ok).toBe(true);
    expect((await kit.call('acme', 'echo.armTimer', { at: 'e' })).ok).toBe(true);
  };

  test('two modules set a timer under one key: both are stored apart and both fire', {
    timeout: 30_000,
  }, async () => {
    const kit = await boot();
    await armBoth(kit);
    const timers = kit.spy.enqueued
      .map((entry) => entry.job)
      .filter((job) => job.queue === 'timers');
    const tickerPulse = await tickerKeyDigest(kit, 'ticker', 'pulse');
    const echoPulse = await tickerKeyDigest(kit, 'echo', 'pulse');
    expect(tickerPulse).not.toBe(echoPulse);
    expect(timers.map((job) => job.key?.value)).toEqual([
      `ticker:${tickerPulse}`,
      `echo:${echoPulse}`,
    ]);
    expect(
      timers.map((job) =>
        splitTimerKey(job.key?.value ?? '', {
          kind: job.kind,
          principalId: job.principal.principalId,
        }),
      ),
    ).toEqual([
      { module: 'ticker', key: tickerPulse },
      { module: 'echo', key: echoPulse },
    ]);
    await kit.advanceTo(later(46));
    expect(await tickerFired(kit)).toEqual(['t']);
    expect(await echoFired(kit)).toEqual(['e']);
  });

  test('a timer key is stored as the module id and a digest, and cancelTimer of the same key reaches it', {
    timeout: 30_000,
  }, async () => {
    const kit = await boot();
    expect((await kit.call('acme', 'ticker.armTimer', { at: 't' })).ok).toBe(true);
    const [timer] = kit.spy.enqueued
      .map((entry) => entry.job)
      .filter((job) => job.queue === 'timers');
    expect(timer?.key?.value).toBe(`ticker:${await tickerKeyDigest(kit, 'ticker', 'pulse')}`);
    expect((await kit.call('acme', 'ticker.disarm', {})).ok).toBe(true);
    await kit.advanceTo(later(46));
    expect(await tickerFired(kit)).toEqual([]);
  });

  test('a timer and an enqueue of two modules with one key text store two digests', {
    timeout: 30_000,
  }, async () => {
    const kit = await boot();
    await armBoth(kit);
    const runAt = seededAt.add({ minutes: 2 }).toString();
    expect((await kit.call('acme', 'ticker.escalateLater', { at: 't', runAt })).ok).toBe(true);
    expect((await kit.call('acme', 'echo.enqueueLater', { at: 'e', runAt })).ok).toBe(true);
    const digestsOf = (queue: string) =>
      kit.spy.enqueued
        .map((entry) => entry.job)
        .filter((job) => job.queue === queue && job.key !== undefined)
        .map((job) => job.key?.value.split(':')[1]);
    const [tickerTimer, echoTimer] = digestsOf('timers');
    const [tickerJob, echoJob] = digestsOf('commands');
    expect(tickerTimer).toBeDefined();
    expect(tickerTimer).not.toBe(echoTimer);
    expect(tickerJob).toBeDefined();
    expect(tickerJob).not.toBe(echoJob);
  });

  test('the stored key never holds the key text', {
    timeout: 30_000,
  }, async () => {
    const kit = await boot();
    await armBoth(kit);
    const keys = kit.spy.enqueued
      .map((entry) => entry.job)
      .filter((job) => job.queue === 'timers')
      .map((job) => job.key?.value ?? '');
    expect(keys).toHaveLength(2);
    for (const key of keys) expect(key).not.toContain('pulse');
  });

  test("a module's cancelTimer leaves another module's timer of the same key", {
    timeout: 30_000,
  }, async () => {
    const kit = await boot();
    await armBoth(kit);
    expect((await kit.call('acme', 'echo.disarm', {})).ok).toBe(true);
    await kit.advanceTo(later(46));
    expect(await tickerFired(kit)).toEqual(['t']);
    expect(await echoFired(kit)).toEqual([]);

    const reverse = await boot();
    await armBoth(reverse);
    expect((await reverse.call('acme', 'ticker.disarm', {})).ok).toBe(true);
    await reverse.advanceTo(later(46));
    expect(await tickerFired(reverse)).toEqual([]);
    expect(await echoFired(reverse)).toEqual(['e']);
  });

  test("a module cannot end a running attempt of another module's timer", {
    timeout: 30_000,
  }, async () => {
    const kit = await boot(false);
    expect((await kit.call('acme', 'ticker.armTimer', { at: 't' })).ok).toBe(true);
    await kit.advanceTo(later(45));
    const { runtime } = kit;
    // The lane counters of a promotion commit with its unit, so the take is a unit of its own.
    await runtime.adapter.unit(runtime.namespace, kit.scopeOf('acme'), (unit) =>
      unit.jobs.promote('timers', 10),
    );
    const [attempt] = await runtime.adapter.unit(
      runtime.namespace,
      kit.scopeOf('acme'),
      async (unit) => {
        const taken = await unit.jobs.take('timers', 'test', {
          limit: 10,
          capabilitySets: [''],
          maxRevision: 1000,
          leaseMs: 60_000,
        });
        return taken.jobs.map((job) => job.attempt);
      },
    );
    if (attempt === undefined) throw new Error('no timer job was taken');
    const beat = () =>
      runtime.adapter.unit(runtime.namespace, kit.scopeOf('acme'), (unit) =>
        unit.jobs.heartbeat([attempt], 'test', 60_000),
      );
    expect((await kit.call('acme', 'echo.disarm', {})).ok).toBe(true);
    expect(await beat()).toEqual([attempt]);
    expect((await kit.call('acme', 'ticker.disarm', {})).ok).toBe(true);
    expect(await beat()).toEqual([]);
  });
});
