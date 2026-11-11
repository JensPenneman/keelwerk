import type { DataAdapter } from '@keelwerk/core';
import type { PgliteAdapter } from '@keelwerk/data/pglite';
import { afterAll, describe, expect, test } from 'vitest';
import type { TickerKit } from './support/ticker-kit.ts';
import { bootTicker, seededAt } from './support/ticker-kit.ts';

const later = (seconds: number, milliseconds = 0) => seededAt.add({ seconds, milliseconds });
const adapters = ['memory', 'pglite'] as const;

describe.each(adapters)('timers on %s', (adapter) => {
  const kits: TickerKit[] = [];
  const boot = async () => {
    const kit = await bootTicker({ adapter });
    kits.push(kit);
    return kit;
  };
  afterAll(async () => {
    for (const kit of kits) await kit.stop();
  });
  const fired = async (kit: TickerKit) =>
    (await kit.rows('acme', 'ticker.tick')).filter((row) => row.schedule === 'timer');

  test("a timer fires after its delay on the fixed clock as the module's service principal", {
    timeout: 30_000,
  }, async () => {
    const kit = await boot();
    const set = await kit.call('acme', 'ticker.armTimer', { at: 'first' });
    expect(set.ok).toBe(true);
    await kit.advanceTo(later(44, 999));
    expect(await fired(kit)).toHaveLength(0);
    await kit.advanceTo(later(45));
    expect((await fired(kit)).map((row) => row.at)).toEqual(['first']);
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
      action: 'ticker.fire',
    });
    expect(String(written[0]?.commandId).startsWith('kernel:timer:')).toBe(true);
  });

  test('cancelTimer prevents it', { timeout: 30_000 }, async () => {
    const kit = await boot();
    await kit.call('acme', 'ticker.armTimer', { at: 'first' });
    expect((await kit.call('acme', 'ticker.disarm', {})).ok).toBe(true);
    await kit.advanceTo(later(120));
    expect(await fired(kit)).toHaveLength(0);
  });

  test('a timer replaced by key fires once', { timeout: 30_000 }, async () => {
    const kit = await boot();
    await kit.call('acme', 'ticker.armTimer', { at: 'first' });
    await kit.advanceTo(later(10));
    await kit.call('acme', 'ticker.armTimer', { at: 'second' });
    await kit.advanceTo(later(120));
    expect((await fired(kit)).map((row) => row.at)).toEqual(['second']);
  });

  test('a timer of a backend command set in a tenant is refused: a timer does not cross scopes', {
    timeout: 30_000,
  }, async () => {
    const kit = await boot();
    const outcome = await kit.call('acme', 'ticker.armBackendTimer', { at: 'up' });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? undefined : outcome.error.code).toBe('core.request_not_allowed');
    expect(kit.spy.enqueued.filter((entry) => entry.job.queue === 'timers')).toHaveLength(0);
    await kit.advanceTo(later(46));
    expect(
      (await kit.rows('backend', 'ticker.beat')).filter((row) => row.source === 'timer'),
    ).toHaveLength(0);
  });

  test("a timer's command id has the reserved form and its secret input is sealed", {
    timeout: 30_000,
  }, async () => {
    const kit = await boot();
    await kit.call('acme', 'ticker.armTimer', { at: 'first', token: 'hunter2-secret' });
    const job = kit.spy.enqueued.map((entry) => entry.job).find((spec) => spec.queue === 'timers');
    if (job === undefined || !('action' in job.run)) throw new Error('no timer job was enqueued');
    expect(job.run.commandId?.startsWith('kernel:timer:')).toBe(true);
    expect(JSON.stringify(job.run.input)).not.toContain('hunter2-secret');
    await kit.advanceTo(later(46));
    expect(await fired(kit)).toHaveLength(1);
  });

  test.runIf(adapter === 'pglite')(
    'the stored row of a timer holds the secret input only sealed',
    {
      timeout: 30_000,
    },
    async () => {
      let adapterOfKit: DataAdapter | undefined;
      const kit = await bootTicker({
        adapter: 'pglite',
        onAdapter: (opened) => {
          adapterOfKit = opened;
        },
      });
      kits.push(kit);
      await kit.call('acme', 'ticker.armTimer', { at: 'first', token: 'hunter2-secret' });
      const owner = adapterOfKit as unknown as PgliteAdapter | undefined;
      if (owner === undefined) throw new Error('the PGlite adapter was not opened');
      const stored = await owner.asOwner(
        async (database) =>
          (
            await database.query<{ text: string }>(
              `select row_to_json(job)::text as text from "${kit.runtime.namespace.root}".kw_jobs job where queue = 'timers'`,
            )
          ).rows,
      );
      expect(stored).toHaveLength(1);
      expect(stored[0]?.text).toContain('kwv1.');
      expect(stored[0]?.text).not.toContain('hunter2-secret');
    },
  );
});
