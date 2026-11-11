import { expect, test, vi } from 'vitest';
import { makePassWorld } from '../../test/support/make-pass-world.ts';
import { defaultScheduleLimits } from './default-schedule-limits.ts';
import { nextTick } from './next-tick.ts';
import { scheduleCommandId } from './schedule-command-id.ts';

vi.mock('../effects/seal-job-input.ts', () => ({
  sealJobInput: async (_unit: unknown, _id: string, _action: unknown, input: unknown) => input,
}));

const T0 = Temporal.Instant.from('2026-01-01T00:05:00Z');
const ref = 'ticker.everyTenant';
const key = `a1\u0000${ref}`;
const retryAt = T0.add({ milliseconds: defaultScheduleLimits.retryMs });

function dueOnce(w: ReturnType<typeof makePassWorld>): void {
  w.rows.set(key, { scopeId: 'a1', scheduleId: ref, nextTick: T0 });
}

test('a tick whose unit failed is retried under its command id and its at, never the retry time', async () => {
  const w = makePassWorld({ one: ['a1'] });
  dueOnce(w);
  w.failing.backends.add('one');
  await w.pass();
  await w.settle();
  expect(w.jobs).toHaveLength(0);
  // The retry lies off the grid, a minute after the tick.
  expect(w.rows.get(key)?.nextTick.toString()).toBe(retryAt.toString());
  w.failing.backends.clear();
  w.clock.now = retryAt.add({ seconds: 2 });
  await w.pass();
  await w.settle();
  expect(w.jobs).toHaveLength(1);
  const [job] = w.jobs;
  const commandId = scheduleCommandId(ref, 'a1', 300_000, T0);
  expect(job?.key).toEqual({ value: commandId, onConflict: 'keep' });
  expect(job?.run).toEqual({
    action: 'ticker.recordTick',
    input: { at: T0.toString() },
    commandId,
  });
  expect(job?.runAt?.toString()).toBe(T0.toString());
  expect(w.rows.get(key)?.nextTick.toString()).toBe(nextTick('5m', w.clock.now).toString());
});

test('a unit that failed after its job was enqueued and committed elsewhere: the retry enqueues nothing new', async () => {
  const w = makePassWorld({ one: ['a1'] });
  dueOnce(w);
  w.failing.afterEnqueue = true;
  await w.pass();
  await w.settle();
  expect(w.jobs).toHaveLength(1);
  // The claim rolled back with the unit: the row waits for the retry off the grid.
  expect(w.rows.get(key)?.nextTick.toString()).toBe(retryAt.toString());
  w.failing.afterEnqueue = false;
  w.clock.now = retryAt.add({ seconds: 2 });
  await w.pass();
  await w.settle();
  expect(w.jobs).toHaveLength(1);
  expect(w.rows.get(key)?.nextTick.toString()).toBe(nextTick('5m', w.clock.now).toString());
  expect(w.rows.get(key)?.nextTick.epochMilliseconds).toBeGreaterThan(retryAt.epochMilliseconds);
});

test('a period that changed between builds names the floored tick under the new period', async () => {
  const midnight = Temporal.Instant.from('2026-01-01T00:00:00Z');
  const w = makePassWorld({ one: ['a1'] }, { every: '1d' });
  // The hourly build ran the midnight tick and left the row on 01:00; this build ticks daily.
  const hourlyRow = midnight.add({ hours: 1 });
  w.rows.set(key, { scopeId: 'a1', scheduleId: ref, nextTick: hourlyRow });
  w.clock.now = hourlyRow;
  await w.pass();
  await w.settle();
  expect(w.jobs).toHaveLength(1);
  const [job] = w.jobs;
  const hourlyId = scheduleCommandId(ref, 'a1', 3_600_000, midnight);
  expect(job?.key?.value).toBe(scheduleCommandId(ref, 'a1', 86_400_000, midnight));
  expect(job?.key?.value).not.toBe(hourlyId);
});
