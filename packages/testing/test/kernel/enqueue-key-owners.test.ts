import { afterAll, describe, expect, test } from 'vitest';
import type { TickerKit } from './support/ticker-kit.ts';
import { bootTicker, seededAt } from './support/ticker-kit.ts';

const runAt = seededAt.add({ minutes: 2 });
const adapters = ['memory', 'pglite'] as const;

describe.each(adapters)('enqueue key owners on %s', (adapter) => {
  const kits: TickerKit[] = [];
  const boot = async () => {
    const kit = await bootTicker({ adapter });
    kits.push(kit);
    return kit;
  };
  afterAll(async () => {
    for (const kit of kits) await kit.stop();
  });
  const tickerRuns = async (kit: TickerKit) =>
    (await kit.rows('backend', 'ticker.beat')).filter((r) => r.source === 'later').map((r) => r.at);
  const echoRuns = async (kit: TickerKit) => (await kit.rows('acme', 'echo.tick')).map((r) => r.at);
  const keysOf = (kit: TickerKit) =>
    kit.spy.enqueued
      .map((entry) => entry.job)
      .filter((job) => job.queue === 'commands' && job.key !== undefined)
      .map((job) => job.key?.value);

  test('two modules enqueue under one key in one scope: both jobs are stored apart and both run', {
    timeout: 30_000,
  }, async () => {
    const kit = await boot();
    expect(
      (await kit.call('acme', 'ticker.escalateLater', { at: 't', runAt: runAt.toString() })).ok,
    ).toBe(true);
    expect(
      (await kit.call('acme', 'echo.enqueueLater', { at: 'e', runAt: runAt.toString() })).ok,
    ).toBe(true);
    expect(keysOf(kit)).toEqual(['ticker:later', 'echo:later']);
    await kit.advanceTo(runAt);
    expect(await tickerRuns(kit)).toEqual(['t']);
    expect(await echoRuns(kit)).toEqual(['e']);

    const reverse = await boot();
    expect(
      (await reverse.call('acme', 'echo.enqueueLater', { at: 'e', runAt: runAt.toString() })).ok,
    ).toBe(true);
    expect(
      (await reverse.call('acme', 'ticker.escalateLater', { at: 't', runAt: runAt.toString() })).ok,
    ).toBe(true);
    expect(keysOf(reverse)).toEqual(['echo:later', 'ticker:later']);
    await reverse.advanceTo(runAt);
    expect(await tickerRuns(reverse)).toEqual(['t']);
    expect(await echoRuns(reverse)).toEqual(['e']);
  });

  test('a module that enqueues twice under its own key keeps its first job', {
    timeout: 30_000,
  }, async () => {
    const kit = await boot();
    expect(
      (await kit.call('acme', 'echo.enqueueLater', { at: 'a', runAt: runAt.toString() })).ok,
    ).toBe(true);
    expect(
      (await kit.call('acme', 'echo.enqueueLater', { at: 'b', runAt: runAt.toString() })).ok,
    ).toBe(true);
    await kit.advanceTo(runAt);
    expect(await echoRuns(kit)).toEqual(['a']);
  });
});
