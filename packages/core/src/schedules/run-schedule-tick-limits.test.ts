import { describe, expect, test, vi } from 'vitest';
import { backendValuesOf, quotaRig, storedQuotaRow } from '../../test/quota-cache-kit.ts';
import { makePassWorld } from '../../test/support/make-pass-world.ts';

vi.mock('../effects/seal-job-input.ts', () => ({
  sealJobInput: async (_unit: unknown, _id: string, _action: unknown, input: unknown) => input,
}));

// A tick takes its lane's cap and weight from the limits the process's cache answers when the tick
// asks, just before its unit, and carries no queued cap: the app's own schedule must not be lost.
// What decides each case: the stored job and the number of reads of the control store; the clock is
// pinned, so only the age the case sets lets the cache read again.

const ref = 'ticker.everyTenant';
const dueAt = Temporal.Instant.from('2026-01-01T00:05:00Z');
/** The backend's values lift the ceiling a tenant's row is clamped to. */
const ceilings = backendValuesOf({
  'queue:schedules.running': '50',
  'queue:schedules.weight': '50',
  'queue:schedules.queued': '1',
});
const limitRows = (running: string, weight: string, version = 1) => [
  storedQuotaRow('queue:schedules.running', running, { version }),
  storedQuotaRow('queue:schedules.weight', weight, { version }),
];

describe('the lane of a schedule tick', () => {
  test('takes the tenant limits of its queue and carries no queued cap, though the cap is full', async () => {
    const rig = quotaRig(limitRows('7', '3'), undefined, ceilings);
    const w = makePassWorld({ b1: ['t1'] }, {}, rig.cache);
    w.rows.set(`t1\u0000${ref}`, { scopeId: 't1', scheduleId: ref, nextTick: dueAt });
    await w.pass();
    await w.settle();
    expect(w.jobs).toHaveLength(1);
    expect(w.jobs[0]).toMatchObject({ queue: 'schedules', laneCap: 7, laneWeight: 3 });
    expect('queuedCap' in (w.jobs[0] ?? {})).toBe(false);
    rig.stop();
  });

  test('asks the cache before its unit: limits changed and aged out reach the next tick with no command in between', async () => {
    const rig = quotaRig(limitRows('7', '3'), undefined, ceilings);
    const w = makePassWorld({ b1: ['t1'] }, {}, rig.cache);
    const due = (at: Temporal.Instant) =>
      w.rows.set(`t1\u0000${ref}`, { scopeId: 't1', scheduleId: ref, nextTick: at });
    due(dueAt);
    await w.pass();
    await w.settle();
    expect(rig.loads()).toBe(1);
    rig.set(limitRows('9', '5', 2));
    // Younger than the age the cache allows: the rows of the first read still serve.
    rig.advance(999);
    due(dueAt.add({ minutes: 5 }));
    w.clock.now = dueAt.add({ minutes: 5 });
    await w.pass();
    await w.settle();
    expect(rig.loads()).toBe(1);
    expect(w.jobs[1]).toMatchObject({ laneCap: 7, laneWeight: 3 });
    // Past that age the tick's own ask reads again.
    rig.advance(1);
    due(dueAt.add({ minutes: 10 }));
    w.clock.now = dueAt.add({ minutes: 10 });
    await w.pass();
    await w.settle();
    expect(rig.loads()).toBe(2);
    expect(w.jobs[2]).toMatchObject({ laneCap: 9, laneWeight: 5 });
    rig.stop();
  });

  test('reads that fail keep the last rows and the next read that succeeds brings the new ones', async () => {
    const rig = quotaRig(limitRows('7', '3'), undefined, ceilings);
    const w = makePassWorld({ b1: ['t1'] }, {}, rig.cache);
    const tick = async (minutes: number) => {
      w.rows.set(`t1\u0000${ref}`, {
        scopeId: 't1',
        scheduleId: ref,
        nextTick: dueAt.add({ minutes }),
      });
      w.clock.now = dueAt.add({ minutes });
      await w.pass();
      await w.settle();
    };
    await tick(0);
    rig.set(limitRows('9', '5', 2));
    rig.fail(true);
    rig.advance(1000);
    await tick(5);
    expect(rig.loads()).toBe(2);
    expect(w.jobs[1]).toMatchObject({ laneCap: 7, laneWeight: 3 });
    rig.fail(false);
    rig.advance(1000);
    await tick(10);
    expect(w.jobs[2]).toMatchObject({ laneCap: 9, laneWeight: 5 });
    rig.stop();
  });
});
