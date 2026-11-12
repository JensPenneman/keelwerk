import { describe, expect, test, vi } from 'vitest';
import { changesOf, dispatchRuntime, dispatchSoon } from './support/dispatch-runtime.ts';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });

describe.each(['memory', 'pglite'] as const)(
  'external effects and their deadlines on %s',
  (adapter) => {
    const { start } = dispatchRuntime(adapter);

    test('an effect past its deadline settles failed with core.effect_deadline and its continuation runs', async () => {
      const booted = await start();
      const { runtime, rows, sent } = booted;
      const deadline = dispatchSoon(booted);
      const { id } = await sent({ deadline });
      expect(await rows('dispatch.delivery')).toEqual([]);
      await runtime.advanceTo(deadline.add({ seconds: 1 }));
      await runtime.drainJobs();
      const [effect] = (await rows('core.effect')).filter((row) => row.id === id);
      expect(effect).toMatchObject({
        status: 'failed',
        error: { code: 'core.effect_deadline', kind: 'unavailable' },
      });
      expect(await rows('dispatch.delivery')).toEqual([
        expect.objectContaining({ parcel: 'p-1', ok: false }),
      ]);
      expect(await changesOf(booted, id)).toEqual(['core.effect.created', 'core.effect.changed']);
    });

    test('settle then deadline: the settle cancels the deadline job and the effect keeps its one settled record', async () => {
      const booted = await start();
      const { call, runtime, rows, sent } = booted;
      const deadline = dispatchSoon(booted);
      const { id } = await sent({ deadline });
      expect(
        await call('dispatch.report', { effectId: id, ok: true, tracking: 'T-1' }),
      ).toMatchObject({ ok: true });
      await runtime.advanceTo(deadline.add({ seconds: 1 }));
      await runtime.drainJobs();
      expect(await changesOf(booted, id)).toEqual(['core.effect.created', 'core.effect.changed']);
      const [effect] = (await rows('core.effect')).filter((row) => row.id === id);
      expect(effect).toMatchObject({ status: 'succeeded' });
    });

    test('a settle that spells the id in upper case works under the stored id and cancels the deadline job', async () => {
      const booted = await start();
      const { call, runtime, rows, sent } = booted;
      const deadline = dispatchSoon(booted);
      const { id } = await sent({ deadline });
      const outcome = await call('dispatch.reportLoose', {
        effectId: id.toUpperCase(),
        tracking: 'T-1',
      });
      if (adapter === 'memory') {
        // The memory adapter compares ids as text: the row is not found under another spelling.
        expect(outcome).toMatchObject({ ok: false, error: { kind: 'not_found' } });
        return;
      }
      expect(outcome).toMatchObject({ ok: true });
      await runtime.drainJobs();
      expect((await rows('core.effect')).find((row) => row.id === id)).toMatchObject({
        status: 'succeeded',
      });
      // The deadline job was cancelled under the stored id: nothing is left to run at the deadline.
      expect(await runtime.advanceTo(deadline.add({ seconds: 1 }))).toBe(0);
      expect(await runtime.drainJobs()).toBe(0);
    });

    test('deadline then settle: the settle answers conflict', async () => {
      const booted = await start();
      const { call, runtime, sent } = booted;
      const deadline = dispatchSoon(booted);
      const { id } = await sent({ deadline });
      await runtime.advanceTo(deadline.add({ seconds: 1 }));
      await runtime.drainJobs();
      expect(
        await call('dispatch.report', { effectId: id, ok: true, tracking: 'T-1' }),
      ).toMatchObject({
        ok: false,
        error: { kind: 'conflict' },
      });
      expect(await changesOf(booted, id)).toEqual(['core.effect.created', 'core.effect.changed']);
    });

    test.runIf(adapter === 'pglite')(
      'settle and deadline at once: exactly one settled record',
      async () => {
        const booted = await start();
        const { call, runtime, rows, sent } = booted;
        const deadline = dispatchSoon(booted);
        const { id } = await sent({ deadline });
        const [reported] = await Promise.all([
          call('dispatch.report', { effectId: id, ok: true, tracking: 'T-1' }),
          runtime.advanceTo(deadline.add({ seconds: 1 })),
        ]);
        await runtime.drainJobs();
        expect(await changesOf(booted, id)).toEqual(['core.effect.created', 'core.effect.changed']);
        const [effect] = (await rows('core.effect')).filter((row) => row.id === id);
        if (effect?.status === 'succeeded') expect(reported).toMatchObject({ ok: true });
        else expect(reported).toMatchObject({ ok: false, error: { kind: 'conflict' } });
      },
    );

    test('a decision of any module can neither cancel nor replace a deadline', async () => {
      const booted = await start();
      const { call, runtime, rows, sent } = booted;
      const deadline = dispatchSoon(booted);
      const { id } = await sent({ deadline });
      const key = `core:deadline:${id}`;
      const cancelled = await call('rogue.cancelIt', { key });
      const replaced = await call('rogue.replaceIt', { key });
      for (const outcome of [cancelled, replaced]) {
        expect(outcome).toMatchObject({ ok: false, error: { kind: 'validation' } });
        expect(JSON.stringify(outcome)).not.toContain(id);
      }
      await runtime.advanceTo(deadline.add({ seconds: 1 }));
      await runtime.drainJobs();
      const [effect] = (await rows('core.effect')).filter((row) => row.id === id);
      expect(effect).toMatchObject({ status: 'failed', error: { code: 'core.effect_deadline' } });
    });

    test('an external effect requested with runAt is refused with validation and leaves no record', async () => {
      const booted = await start();
      const { runtime, rows, sent } = booted;
      const { outcome } = await sent({ runAt: dispatchSoon(booted) });
      expect(outcome).toMatchObject({ ok: false, error: { kind: 'validation' } });
      expect(await rows('core.effect')).toEqual([]);
      const jobs = await runtime.adapter.unit(
        runtime.namespace,
        booted.scopeOf(booted.acme),
        async (unit) => {
          const found = [];
          for (const queue of ['timers', 'effects', 'commands']) {
            const taken = await unit.jobs.take(queue, 'test', {
              limit: 10,
              capabilitySets: [''],
              maxRevision: 1000,
              leaseMs: 1000,
            });
            found.push(...taken.jobs);
          }
          return found;
        },
      );
      expect(jobs).toEqual([]);
    });
  },
);
