import { describe, expect, test, vi } from 'vitest';
import { makePassWorld } from '../../test/support/make-pass-world.ts';
import type { PassWorld } from '../../test/support/pass-world.ts';
import type { StoredJobSpec } from '../storage/stored-job-spec.ts';
import { defaultScheduleLimits } from './default-schedule-limits.ts';
import { nextTick } from './next-tick.ts';

vi.mock('../effects/seal-job-input.ts', () => ({
  sealJobInput: async (_unit: unknown, _id: string, _action: unknown, input: unknown) => input,
}));

const T0 = Temporal.Instant.from('2026-01-01T00:05:00Z');
const ref = 'ticker.everyTenant';

const scopeIdOf = (job: StoredJobSpec): string =>
  job.scope.level === 'tenant' ? job.scope.tenantId : '';

function dueRows(w: PassWorld, ids: readonly string[]): void {
  for (const id of ids)
    w.rows.set(`${id}\u0000${ref}`, { scopeId: id, scheduleId: ref, nextTick: T0 });
}

describe('one pass over one namespace', () => {
  test('rows are taken round-robin over backends within perBackend', async () => {
    const w = makePassWorld({ one: ['a1', 'a2', 'a3'], two: ['b1', 'b2', 'b3'] });
    dueRows(w, ['a1', 'a2', 'a3', 'b1', 'b2', 'b3']);
    await w.pass({ perBackend: 2, concurrency: 1 });
    await w.settle();
    expect(w.jobs.map(scopeIdOf)).toEqual(['a1', 'a2']);
    expect(w.state.remaining).toBe(true);
    await w.pass({ perBackend: 2, concurrency: 1 });
    await w.settle();
    expect(w.jobs.map(scopeIdOf)).toEqual(['a1', 'a2', 'b1', 'b2']);
  });

  test('the pass reports remaining work until every due row was dispatched, also after a short read past the cursor', async () => {
    const ids = Array.from({ length: 105 }, (_, index) => `a${String(index).padStart(3, '0')}`);
    const w = makePassWorld({ one: ids });
    dueRows(w, ids);
    const limits = { dueLimit: 100, perBackend: 10, concurrency: 1 };
    await w.pass(limits);
    await w.settle();
    expect(w.jobs).toHaveLength(10);
    expect(w.state.remaining).toBe(true);
    await w.pass(limits);
    await w.settle();
    expect(w.jobs).toHaveLength(15);
    // The short read after the cursor sees only 5 rows, yet 90 rows of the first window are still due.
    expect(w.state.remaining).toBe(true);
    let passes = 2;
    while (w.state.remaining && passes < 40) {
      await w.pass(limits);
      await w.settle();
      passes += 1;
    }
    expect(w.state.remaining).toBe(false);
    expect(w.jobs).toHaveLength(105);
    expect(new Set(w.jobs.map(scopeIdOf)).size).toBe(105);
  });

  test('a backend whose tenants fail does not delay another backend', async () => {
    const w = makePassWorld({ one: ['a1', 'a2'], two: ['b1', 'b2'] });
    dueRows(w, ['a1', 'a2', 'b1', 'b2']);
    w.failing.backends.add('one');
    await w.pass();
    await w.settle();
    expect(w.jobs.map(scopeIdOf)).toEqual(['b1', 'b2']);
    const retry = T0.add({ milliseconds: defaultScheduleLimits.retryMs });
    for (const id of ['a1', 'a2']) {
      expect(w.rows.get(`${id}\u0000${ref}`)?.nextTick.toString()).toBe(retry.toString());
    }
    for (const id of ['b1', 'b2']) {
      expect(w.rows.get(`${id}\u0000${ref}`)?.nextTick.toString()).toBe(
        nextTick('5m', T0).toString(),
      );
    }
  });

  test('a busy backend is skipped, not awaited', async () => {
    const w = makePassWorld({ one: ['a1'], two: ['b1'] });
    dueRows(w, ['a1', 'b1']);
    w.state.busy.add('one');
    await w.pass();
    await w.settle();
    expect(w.jobs.map(scopeIdOf)).toEqual(['b1']);
    expect(w.rows.get(`a1\u0000${ref}`)?.nextTick.toString()).toBe(T0.toString());
  });

  test('a row of a schedule this build does not know is claimed staleMs ahead with no job', async () => {
    const w = makePassWorld({ one: ['a1'] });
    dueRows(w, ['a1']);
    w.rows.set(`a1\u0000ticker.unknown`, {
      scopeId: 'a1',
      scheduleId: 'ticker.unknown',
      nextTick: T0,
    });
    await w.pass();
    await w.settle();
    expect(w.jobs.map(scopeIdOf)).toEqual(['a1']);
    const ahead = T0.add({ milliseconds: defaultScheduleLimits.staleMs }).toString();
    expect(w.rows.get(`a1\u0000ticker.unknown`)?.nextTick.toString()).toBe(ahead);
    expect(w.removed).toEqual([]);
  });

  test('a build failure skips the tick', async () => {
    const w = makePassWorld(
      { one: ['a1'] },
      {
        input: () => {
          throw new Error('no input');
        },
      },
    );
    dueRows(w, ['a1']);
    await w.pass();
    await w.settle();
    expect(w.jobs).toHaveLength(0);
    expect(w.rows.get(`a1\u0000${ref}`)?.nextTick.toString()).toBe(nextTick('5m', T0).toString());
    expect(w.logs.filter((line) => line.level === 'error')).toHaveLength(1);
  });

  test('ticks whose input cannot be built are logged once per schedule and pass, over all backends', async () => {
    const w = makePassWorld(
      { one: ['a1', 'a2', 'a3'], two: ['b1', 'b2'] },
      {
        input: () => {
          throw new Error('no input');
        },
      },
    );
    dueRows(w, ['a1', 'a2', 'a3', 'b1', 'b2']);
    await w.pass();
    await w.settle();
    expect(w.jobs).toHaveLength(0);
    const errors = w.logs.filter((line) => line.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.fields).toMatchObject({ schedule: ref, count: 5, scope: 'a1' });
  });

  test('a failed deferral holds the row in memory', async () => {
    const w = makePassWorld({ one: ['a1'] });
    dueRows(w, ['a1']);
    w.failing.backends.add('one');
    w.failing.claims = true;
    await w.pass();
    await w.settle();
    expect(w.state.held.has(`${ref}\u0000a1`)).toBe(true);
    expect(w.rows.get(`a1\u0000${ref}`)?.nextTick.toString()).toBe(T0.toString());
    w.failing.backends.clear();
    w.failing.claims = false;
    await w.pass();
    await w.settle();
    expect(w.jobs).toHaveLength(0);
    w.clock.now = T0.add({ milliseconds: defaultScheduleLimits.retryMs });
    await w.pass();
    await w.settle();
    expect(w.jobs.map(scopeIdOf)).toEqual(['a1']);
    expect(w.state.held.size).toBe(0);
  });

  test('seeding stops at seedPerPass and resumes', async () => {
    const w = makePassWorld({ one: ['a1', 'a2', 'a3', 'a4', 'a5'] });
    (w.state as { reseedAt: Temporal.Instant | undefined }).reseedAt = undefined;
    await w.pass({ seedPerPass: 2 });
    expect(w.rows.size).toBe(2);
    expect(w.state.remaining).toBe(true);
    await w.pass({ seedPerPass: 2 });
    expect(w.rows.size).toBe(4);
    await w.pass({ seedPerPass: 2 });
    expect(w.rows.size).toBe(5);
    expect(w.state.fanOut).toBeUndefined();
    for (const row of w.rows.values()) {
      expect(row.nextTick.toString()).toBe(nextTick('5m', T0).toString());
    }
  });

  test('a backend with a thousand due rows does not keep another backend waiting', async () => {
    const heavy = Array.from({ length: 1000 }, (_, index) => `a${String(index).padStart(4, '0')}`);
    const w = makePassWorld({ one: heavy, two: ['zz'] });
    dueRows(w, [...heavy, 'zz']);
    const passes = Math.ceil(1000 / 100) + 1;
    let served = 0;
    for (; served < passes && !w.jobs.some((job) => scopeIdOf(job) === 'zz'); served += 1) {
      await w.pass({ dueLimit: 100, perBackend: 10 });
      await w.settle();
    }
    expect(w.jobs.map(scopeIdOf)).toContain('zz');
    expect(served).toBeLessThanOrEqual(passes);
  });

  test('suspended rows are claimed in one namespace unit after the active backend was dispatched', async () => {
    const quiet = Array.from({ length: 50 }, (_, index) => `s${String(index).padStart(2, '0')}`);
    const w = makePassWorld({ one: ['a1'], two: quiet });
    dueRows(w, ['a1', ...quiet]);
    for (const id of quiet) w.suspended.add(id);
    await w.pass();
    await w.settle();
    expect(w.jobs.map(scopeIdOf)).toEqual(['a1']);
    expect(w.counts.claimUnits).toBe(1);
    for (const id of quiet) {
      expect(w.rows.get(`${id}\u0000${ref}`)?.nextTick.toString()).toBe(
        nextTick('5m', T0).toString(),
      );
    }
  });
});
