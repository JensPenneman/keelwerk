import { readFileSync } from 'node:fs';
import { scheduleCommandId, scheduleJitter } from '@keelwerk/core';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { gate } from './support/job-spy.ts';
import { tickerControl } from './support/ticker-control.ts';
import type { TickerKit } from './support/ticker-kit.ts';
import { bootTicker, tickerStart } from './support/ticker-kit.ts';
import { lines } from './support/worker-kit.ts';

const T0 = tickerStart;
const at = (minutes: number, milliseconds = 0) => T0.add({ minutes, milliseconds });
const adapters = ['memory', 'pglite'] as const;

describe.each(adapters)('schedules on %s', (adapter) => {
  const kits: TickerKit[] = [];
  const boot = async (options: Parameters<typeof bootTicker>[0] = {}) => {
    const kit = await bootTicker({ adapter, ...options });
    kits.push(kit);
    return kit;
  };
  afterAll(async () => {
    for (const kit of kits) await kit.stop();
  });
  /** The jobs of a queue the workers took, in the order they took them. */
  const tookFrom = (kit: TickerKit, queue: string) =>
    kit.spy.takes.filter((take) => take.queue === queue).flatMap((take) => take.jobs);

  test('an each-tenant schedule enqueues one job per tenant per tick with two tickers', {
    timeout: 30_000,
  }, async () => {
    const kit = await boot({ secondTicker: true });
    await kit.advanceTo(at(5));
    expect(await kit.rows('acme', 'ticker.tick')).toHaveLength(0);
    await kit.advanceTo(at(5, 31_000));
    for (const tenant of ['acme', 'globex'] as const) {
      const rows = await kit.rows(tenant, 'ticker.tick');
      expect(rows.map((row) => [row.schedule, row.at])).toEqual([
        ['everyTenant', at(5).toString()],
      ]);
    }
    const scheduled = kit.spy.enqueued.filter((entry) => entry.job.queue === 'schedules');
    expect(scheduled.filter((entry) => entry.job.scope.level === 'tenant')).toHaveLength(2);
    // Two tickers, one job per scope: the two tenants and the backend, each taken once.
    expect(tookFrom(kit, 'schedules')).toHaveLength(3);
  });

  test('a backend schedule runs once per tick in the backend scope', {
    timeout: 30_000,
  }, async () => {
    const kit = await boot({ secondTicker: true });
    await kit.advanceTo(at(5, 31_000));
    const beats = await kit.rows('backend', 'ticker.beat');
    expect(beats.map((row) => [row.source, row.at])).toEqual([['everyBackend', at(5).toString()]]);
    await kit.advanceTo(at(10, 31_000));
    expect(await kit.rows('backend', 'ticker.beat')).toHaveLength(2);
  });

  test('a missed tick after downtime runs once', { timeout: 30_000 }, async () => {
    const kit = await boot();
    await kit.advanceTo(at(30));
    await kit.advanceTo(at(31));
    for (const tenant of ['acme', 'globex'] as const) {
      expect(await kit.rows(tenant, 'ticker.tick')).toHaveLength(1);
    }
    expect(await kit.rows('backend', 'ticker.beat')).toHaveLength(1);
  });

  test("the job runs as ticker.system under the tick's command id", {
    timeout: 30_000,
  }, async () => {
    const kit = await boot();
    await kit.advanceTo(at(5, 31_000));
    const page = await kit.runtime.adapter.unit(
      kit.runtime.namespace,
      kit.scopeOf('acme'),
      (unit) => unit.events.readAll(null, { limit: 100 }),
      { readOnly: true },
    );
    const written = page.events.filter((event) => event.type === 'ticker.tick.created');
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      actor: { kind: 'service', id: 'ticker.system', via: 'core.module' },
      action: 'ticker.recordTick',
    });
    expect(written[0]?.commandId).toBe(
      scheduleCommandId('ticker.everyTenant', kit.runtime.tenants.acme.id, 300_000, at(5)),
    );
  });

  test('the job waits for its jitter', { timeout: 30_000 }, async () => {
    const kit = await boot();
    const acme = kit.runtime.tenants.acme.id;
    const delay = scheduleJitter('ticker.everyTenant', acme, at(5), '30s');
    expect(delay).toBeGreaterThan(0);
    await kit.advanceTo(at(5, delay - 1));
    expect(await kit.rows('acme', 'ticker.tick')).toHaveLength(0);
    await kit.advanceTo(at(5, delay));
    expect(await kit.rows('acme', 'ticker.tick')).toHaveLength(1);
  });

  test("the tick job's stored form", { timeout: 30_000 }, async () => {
    const kit = await boot();
    await kit.advanceTo(at(5));
    const job = kit.spy.enqueued
      .map((entry) => entry.job)
      .find((spec) => spec.queue === 'schedules' && spec.scope.level === 'tenant');
    if (job === undefined) throw new Error('no tick job was enqueued');
    const acme = kit.runtime.tenants.acme.id;
    // The jitter follows from the tenant's id, which is random: the job's run time is checked against it, not stored.
    expect(job.runAt?.toString()).toBe(
      at(5)
        .add({ milliseconds: scheduleJitter('ticker.everyTenant', acme, at(5), '30s') })
        .toString(),
    );
    const ids = new Map([
      [kit.runtime.backendId, '<backend id>'],
      [acme, '<acme id>'],
      [job.build.id, '<build id>'],
    ]);
    const text = JSON.stringify(
      { ...job, runAt: '<tick plus its jitter>' },
      (_key, member: unknown) => {
        if (typeof member === 'bigint') return `${member}n`;
        if (typeof member === 'string') {
          let out = member;
          for (const [id, label] of ids) out = out.replaceAll(id, label);
          return out;
        }
        return member;
      },
    );
    const expected: unknown = JSON.parse(
      readFileSync(new URL('./golden/schedule-tick-job.json', import.meta.url), 'utf8'),
    );
    expect(JSON.parse(text)).toEqual(expected);
  });

  test('a tick held past the stop deadline is abandoned once and writes nothing', {
    timeout: 30_000,
  }, async () => {
    const log = lines();
    const kit = await boot({ logger: log.logger, drainSeconds: 1 });
    const door = gate();
    kit.spy.beforeEnqueue = async (job) => {
      if (job.queue !== 'schedules') return;
      door.enter();
      await door.open;
    };
    const advancing = kit.advanceTo(at(5, 31_000)).catch(() => undefined);
    await door.entered;
    await kit.runtime.stop(10_000);
    const abandoned = 'a schedule tick was abandoned at the stop deadline';
    await vi.waitFor(() =>
      expect(log.warnings.filter((line) => line === abandoned)).toHaveLength(1),
    );
    door.release();
    await advancing;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(log.warnings.filter((line) => line === abandoned)).toHaveLength(1);
    expect(log.errors.filter((line) => line === 'a schedule task failed')).toEqual([]);
    expect(kit.spy.enqueued.filter((entry) => entry.job.queue === 'schedules')).toEqual([]);
  });

  test('a failing scheduled command records the closed projection', {
    timeout: 30_000,
  }, async () => {
    tickerControl.refuse = true;
    try {
      const kit = await boot();
      await kit.advanceTo(at(5, 1));
      const failed = kit.spy.completions.filter(
        (entry) => entry.outcome.kind === 'failed' || entry.outcome.kind === 'dead',
      );
      const messages = failed.map((entry) =>
        'error' in entry.outcome ? entry.outcome.error.message : '',
      );
      expect(messages).toContain('The schedule failed with ticker.refused.');
    } finally {
      tickerControl.refuse = false;
    }
  });
});
