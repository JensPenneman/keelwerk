import { parseSealedValueText } from '@keelwerk/core';
import { afterEach, describe, expect, test } from 'vitest';
import { pgliteQuery } from './support/dump-sections.ts';
import { bootCourier as boot } from './support/erasure-courier-kit.ts';
import { watchedSink } from './support/watched-sink.ts';

type Booted = Awaited<ReturnType<typeof boot>>;
let current: Booted | undefined;
afterEach(async () => {
  await current?.runtime.stop();
  current = undefined;
});
const start = async (options?: Parameters<typeof boot>[0]): Promise<Booted> => {
  current = await boot(options);
  return current;
};

/** The erasure runs to its end: the worker's pass, then the jobs it left (the continuations). */
async function erase(booted: Booted): Promise<void> {
  await booted.ask();
  await booted.worker.pass();
  await booted.runtime.drainJobs();
}

/** The value keys the database holds: counted on PGlite, where the tables can be read; 0 on memory. */
async function valueKeyCount(booted: Booted, adapter: 'memory' | 'pglite'): Promise<number> {
  if (adapter === 'memory') return 0;
  const query = pgliteQuery(booted.runtime.adapter);
  let count = 0;
  for (const { schemaname } of await query(
    "select schemaname from pg_tables where tablename = 'kw_value_keys'",
  )) {
    const [row] = await query(
      `select count(*)::int as n from "${String(schemaname)}".kw_value_keys`,
    );
    count += Number(row?.n);
  }
  return count;
}

const logged = async (booted: Booted) =>
  (await booted.rows('courier.logbook')).map((row) => ({ ok: row.ok, code: row.code ?? null }));

describe('an erasure settles the requested external effects of the subject (14.7.5, WP-138)', () => {
  test('a requested effect settles failed with core.key_destroyed, its continuation runs once and the performer is no longer handed it', {
    timeout: 120_000,
  }, async () => {
    const booted = await start();
    const { id } = await booted.send({ deadline: booted.runtime.clock.now().add({ hours: 1 }) });
    const pendingFrames = async () => {
      const stream = await booted.follow();
      try {
        expect((await stream.next())?.event).toBe('welcome');
        const frames = await stream.until((frame) => frame.event === 'head');
        return frames.filter((frame) => frame.event === 'data');
      } finally {
        await stream.close();
      }
    };
    expect(await pendingFrames()).toHaveLength(1);

    await erase(booted);

    expect(await booted.effectRow(id)).toMatchObject({
      status: 'failed',
      error: { code: 'core.key_destroyed' },
    });
    expect(await logged(booted)).toEqual([{ ok: false, code: 'core.key_destroyed' }]);
    // The performer that follows its pending effects again is no longer handed it.
    expect(await pendingFrames()).toEqual([]);
  });

  test('the deadline timer of the effect is cancelled with it', { timeout: 120_000 }, async () => {
    const booted = await start();
    await booted.send({ deadline: booted.runtime.clock.now().add({ hours: 1 }) });
    const timers = async () =>
      (
        await booted.runtime.adapter.unit(booted.runtime.namespace, booted.scope, (unit) =>
          unit.jobs.stats('timers'),
        )
      ).reduce((sum, row) => sum + row.queued, 0);
    expect(await timers()).toBe(1);
    await erase(booted);
    expect(await timers()).toBe(0);
  });

  test('the performer settles first: the effect stays succeeded, the continuation ran once and no secret of it opens', {
    timeout: 120_000,
  }, async () => {
    // The performer's settle commits after the erasure read the keys of the effect and before its
    // unit opens: the sink that takes the tombstone of the waybill is called at that moment, with
    // no unit open, so the unit finds a key (the seal) that has no tombstone yet and starts again.
    const hook: { key?: string; run?: () => Promise<void> } = {};
    const sink = watchedSink(async (records) => {
      if (!records.some((record) => record.type === 'keyTombstone' && record.keyId === hook.key)) {
        return;
      }
      const { run } = hook;
      delete hook.run;
      await run?.();
    });
    const booted = await start({ ledgers: [sink] });
    const { id } = await booted.send();
    const input = (await booted.effectRow(id)).input as { waybill: string };
    const waybill = parseSealedValueText(input.waybill);
    hook.key = String(waybill?.keyId);
    hook.run = () => booted.report(id);
    await erase(booted);
    expect(hook.run).toBeUndefined();
    const row = await booted.effectRow(id);
    expect(row).toMatchObject({ status: 'succeeded' });
    expect(await logged(booted)).toEqual([{ ok: true, code: null }]);
    const seal = String((row.output as { seal: string }).seal);
    expect(await booted.opens(seal)).toBe(false);
    expect(await booted.tombstones()).toContain(parseSealedValueText(seal)?.keyId);
  });

  test('the erasure settles first: the performer then meets a conflict and nothing runs twice', {
    timeout: 120_000,
  }, async () => {
    const booted = await start();
    const { id } = await booted.send();
    await erase(booted);
    const late = await booted.call('courier.report', { effectId: id, seal: 'late seal' });
    expect(late).toMatchObject({ ok: false, error: { kind: 'conflict' } });
    await booted.runtime.drainJobs();
    expect(await booted.effectRow(id)).toMatchObject({ status: 'failed' });
    expect(await logged(booted)).toEqual([{ ok: false, code: 'core.key_destroyed' }]);
  });

  test('a crash between two effects: the rerun settles the rest and each continuation runs once', {
    timeout: 120_000,
  }, async () => {
    const booted = await start();
    await booted.send({ parcel: 'p-1' });
    await booted.send({ parcel: 'p-2' });
    let crashed = false;
    booted.seams.after = (step) => {
      if (step !== 'streams' || crashed) return Promise.resolve();
      crashed = true;
      return Promise.reject(new Error('crash after the first effect'));
    };
    await booted.ask();
    await booted.worker.pass();
    const settled = async () =>
      (await booted.rows('core.effect')).filter((row) => row.status === 'failed').length;
    expect(crashed).toBe(true);
    expect(await settled()).toBe(1);
    await booted.worker.pass();
    await booted.runtime.drainJobs();
    expect(await settled()).toBe(2);
    expect(await logged(booted)).toEqual([
      { ok: false, code: 'core.key_destroyed' },
      { ok: false, code: 'core.key_destroyed' },
    ]);
  });

  test('a second erasure of the same subject changes nothing', { timeout: 120_000 }, async () => {
    const booted = await start();
    const { id } = await booted.send();
    await erase(booted);
    const eventsOf = () =>
      booted.runtime.adapter.unit(booted.runtime.namespace, booted.scope, (unit) =>
        unit.events.readStream({ type: 'core.effect', id }),
      );
    const before = (await eventsOf()).map((event) => event.eventId);
    const keys = await booted.tombstones();
    await erase(booted);
    expect((await eventsOf()).map((event) => event.eventId)).toEqual(before);
    expect(await logged(booted)).toHaveLength(1);
    expect(await booted.tombstones()).toEqual(keys);
  });
});

describe.each(['memory', 'pglite'] as const)(
  'an erasure settles the requested executor effects of the subject (%s)',
  (adapter) => {
    test('an attempt that has begun ends abandoned and seals nothing, one that has not fails key_destroyed, and no secret opens', {
      timeout: 120_000,
    }, async () => {
      const booted = await start({ adapter });
      const done = await booted.dispatch('first');
      await booted.runtime.drainJobs();
      expect(await booted.effectRow(done)).toMatchObject({ status: 'succeeded' });
      await booted.ask();
      // The erasure is recorded, its worker has not run. The next effect's attempt is in flight when
      // the worker's pass runs, and another effect is requested meanwhile.
      const running = await booted.dispatch('running');
      const queued: { id?: string } = {};
      let keysAtPass = 0;
      booted.attempt.during = async () => {
        queued.id = await booted.dispatch('queued');
        await booted.worker.pass();
        keysAtPass = await valueKeyCount(booted, adapter);
      };
      await booted.runtime.drainJobs();

      expect(queued.id).toBeDefined();
      expect(await booted.effectRow(running)).toMatchObject({
        status: 'abandoned',
        // The erasure writes the attempts that started: the one that was in flight.
        attempts: 1,
        error: { code: 'core.effect_outcome_unknown' },
      });
      expect((await booted.effectRow(running)).output ?? null).toBeNull();
      // The attempt ended after the erasure: it wrote its end record, and no value key was made for an output.
      const records = await booted.attemptRecords(running);
      expect(records.at(-1)?.endedAt).toBeDefined();
      expect(await valueKeyCount(booted, adapter)).toBe(keysAtPass);
      expect(await booted.effectRow(String(queued.id))).toMatchObject({
        status: 'failed',
        error: { code: 'core.key_destroyed' },
      });
      for (const id of [done, running, String(queued.id)]) {
        const row = await booted.effectRow(id);
        const texts = [(row.input as { waybill: string }).waybill];
        if (row.output !== undefined && row.output !== null) {
          texts.push((row.output as { seal: string }).seal);
        }
        for (const text of texts) expect(await booted.opens(text)).toBe(false);
      }
    });
  },
);
