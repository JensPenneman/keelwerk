import { errors } from '@keelwerk/core';
import { describe, expect, test, vi } from 'vitest';
import { createRetention } from '../../src/retention/create-retention.ts';
import { retention } from '../../src/retention/retention.ts';
import { fakeRetentionContext } from './support/fake-retention-context.ts';

/** The pass the worker began at its start has ended: `pass()` runs after it, in order. */
const afterStartPass = (worker: ReturnType<typeof retention>) =>
  worker.pass().then(
    () => undefined,
    () => undefined,
  );

describe('the retention worker in a process that leaves service', () => {
  test('runs no pass when its signal aborted before the start', async () => {
    const kit = fakeRetentionContext(AbortSignal.abort());
    const worker = retention({ intervalMs: 5 });
    await worker.start(kit.context);
    await afterStartPass(worker);
    expect(kit.opened).not.toHaveBeenCalled();
    expect(kit.reached()).toBe(false);
    // The aborted worker waits for nothing.
    expect(kit.timers.pending()).toBe(0);
    await worker.stop(Temporal.Now.instant());
  });

  test('ends a unit held at the abort and visits no further scope', async () => {
    const leaving = new AbortController();
    const kit = fakeRetentionContext(leaving.signal, undefined, true);
    const worker = retention({ intervalMs: 5 });
    const starting = worker.start(kit.context);
    await vi.waitFor(() => expect(kit.purged).toHaveBeenCalledTimes(1));
    leaving.abort();
    await starting;
    expect(kit.reached()).toBe(false);
    expect(kit.opened).toHaveBeenCalledTimes(1);
    kit.release();
    await worker.settled();
    await afterStartPass(worker);
    expect(kit.opened).toHaveBeenCalledTimes(1);
    expect(kit.timers.pending()).toBe(0);
    await worker.stop(Temporal.Now.instant());
  });
});

describe('the retention worker waits on the timers of the runtime', () => {
  test('a scheduled pass runs when the clock reaches the interval, not before', async () => {
    const kit = fakeRetentionContext(new AbortController().signal);
    const worker = retention({ intervalMs: 60_000 });
    await worker.start(kit.context);
    await afterStartPass(worker);
    const baseline = kit.opened.mock.calls.length;
    expect(baseline).toBeGreaterThan(0);
    // One wait is pending, for the clock to reach one interval from the start.
    expect(kit.timers.pending()).toBe(1);
    expect(await kit.advance(59_999)).toBe(0);
    expect(kit.opened.mock.calls.length).toBe(baseline);
    expect(await kit.advance(1)).toBe(1);
    await vi.waitFor(() => expect(kit.opened.mock.calls.length).toBeGreaterThan(baseline));
    // The loop waits again for the next interval.
    expect(kit.timers.pending()).toBe(1);
    await worker.stop(Temporal.Now.instant());
    expect(kit.timers.pending()).toBe(0);
  });

  test('passes outside the window do not run, pass() does', async () => {
    const kit = fakeRetentionContext(new AbortController().signal);
    const worker = retention({ intervalMs: 5, window: { start: '01:00', end: '02:00' } });
    await worker.start(kit.context);
    await kit.advance(5);
    await kit.advance(5);
    expect(kit.opened).not.toHaveBeenCalled();
    expect(await worker.pass()).toEqual([]);
    expect(kit.opened).toHaveBeenCalled();
    await worker.stop(Temporal.Now.instant());
  });

  test('passes inside a window that crosses midnight run on their own', async () => {
    const kit = fakeRetentionContext(new AbortController().signal, '2026-11-18T23:30:00Z');
    const worker = retention({ window: { start: '23:00', end: '01:00' } });
    await worker.start(kit.context);
    await vi.waitFor(() => expect(kit.opened).toHaveBeenCalled());
    await worker.stop(Temporal.Now.instant());
  });

  test('stop gives a pass that is held until the deadline on the same timers, then abandons it', async () => {
    const kit = fakeRetentionContext(new AbortController().signal, undefined, true);
    const worker = retention({ intervalMs: 60_000 });
    await worker.start(kit.context);
    await vi.waitFor(() => expect(kit.purged).toHaveBeenCalledTimes(1));
    const deadline = kit.context.clock.now().add({ seconds: 30 });
    const stopping = worker.stop(deadline);
    // Not yet: the pass holds its unit and the deadline has not come on the runtime's clock.
    await kit.advance(29_000);
    await expect(Promise.race([stopping, Promise.resolve('waiting')])).resolves.toBe('waiting');
    await kit.advance(1_000);
    await stopping;
    kit.release();
    await worker.settled();
  });

  test('a worker that is stopping begins no unit, the renewal of its lease included', async () => {
    let stopping: Promise<void> | undefined;
    const kit = fakeRetentionContext(new AbortController().signal, undefined, false, {
      transient: () => ({ removed: 10, more: true }),
      // The stop comes while the first batch is in its unit, after the lease has fallen due.
      afterTransient: (calls) => {
        if (calls !== 1) return;
        kit.setNow('2026-11-18T12:05:00Z');
        stopping = worker.stop(kit.context.clock.now().add({ hours: 1 }));
      },
    });
    const worker = retention({ batchSize: 10, intervalMs: 3_600_000 });
    await worker.start(kit.context);
    await vi.waitFor(() => expect(stopping).toBeDefined());
    await stopping;
    await worker.settled();
    // A second batch was due, and so was the renewal: neither began.
    expect(kit.transientCalls).toHaveBeenCalledTimes(1);
    expect(kit.renewed).not.toHaveBeenCalled();
    expect(kit.timers.pending()).toBe(0);
  });

  test('refuses a window whose start equals its end', () => {
    expect(() => retention({ window: { start: '02:00', end: '02:00' } })).toThrow('window.start');
  });

  test('refuses a transient window shorter than the feed horizon the re-decide counts', () => {
    expect(() => retention({ transientRecords: '0s' })).toThrow('feed horizon');
    expect(() => retention({ transientRecords: 'PT0S' })).toThrow('feed horizon');
    expect(() => retention({ transientRecords: 'P6D' })).toThrow('feed horizon');
    expect(() => retention({ transientRecords: 'P7D' })).not.toThrow();
    expect(() => retention({ transientRecords: 'P30D' })).not.toThrow();
  });

  test('refuses options that are no whole numbers, times or durations', () => {
    expect(() => retention({ batchSize: 0 })).toThrow('batchSize');
    expect(() => retention({ batchSize: 100_001 })).toThrow('batchSize');
    expect(() => retention({ intervalMs: 0 })).toThrow('intervalMs');
    expect(() => retention({ window: { start: '25:00', end: '01:00' } })).toThrow('window.start');
    expect(() => retention({ jobHistory: 'soon' })).toThrow('not a duration');
  });
});

describe('a scope whose run the control store cannot take', () => {
  test('the failure of its buffer is logged before the run is recorded', async () => {
    const kit = fakeRetentionContext(new AbortController().signal);
    const lines: { message: string; fields: Record<string, unknown> }[] = [];
    const log = (message: string, fields: Record<string, unknown>): void => {
      lines.push({ message, fields });
    };
    const unit = kit.opened.getMockImplementation();
    if (unit === undefined) throw new Error('the fake control store has no unit');
    // The control database is unreachable when the run is to be stored.
    const adapter = kit.context.control.adapter as unknown as { unit: typeof unit };
    adapter.unit = (namespace, scope, fn) =>
      unit(namespace, scope, (inner) =>
        fn({
          ...(inner as object),
          retentionRuns: {
            append: async () => {
              throw errors.unavailable('The control database is unreachable.');
            },
          },
        }),
      );
    (kit.context.log as unknown as { error: typeof log }).error = log;
    const worker = createRetention({ intervalMs: 60_000 }, async (_scope, buffer) => {
      if (buffer === 'transientRecords') throw new Error('the transient buffer fails');
    });
    await worker.start(kit.context);
    await afterStartPass(worker);
    await worker.stop(Temporal.Now.instant());
    const buffer = lines.filter((line) => line.message.includes('buffer failed'));
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer[0]?.fields).toMatchObject({ buffer: 'transientRecords' });
    expect(lines.some((line) => line.message.includes('scope failed'))).toBe(true);
  });
});
