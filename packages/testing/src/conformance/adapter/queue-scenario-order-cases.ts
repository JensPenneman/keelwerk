import { conformanceScopes } from '@keelwerk/data/conformance';
import { expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import type { QueueScenarioKit } from './queue-scenario-kit.ts';

const { tenantA, tenantB } = conformanceScopes;
const done = (k: QueueScenarioKit, count: number): boolean =>
  k.runs.length === count && k.runs.every((run) => run.end === 'completed');

/** Lanes, the fair order, groups and the schedule tick of 14.3.9 and 14.10 case 10, through the kernel queue. */
export function queueScenarioOrderCases(
  kit: () => QueueScenarioKit,
  subject: Pick<ConformanceSubject, 'run'>,
): void {
  test('a lane never runs more than its cap of four, and the next job starts when one ends', {
    timeout: 60_000,
  }, async () => {
    const k = kit();
    const numbers = [1, 2, 3, 4, 5, 6];
    await k.enqueue(numbers.map((n) => k.job(n)));
    for (const n of numbers) k.script(n, ['hold']);
    await k.worker('w1', 8);
    await k.until(() => k.runs.length === 4);
    expect(await k.probeTake()).toEqual([]);
    const [first] = k.runs;
    if (first === undefined) throw new Error('no run started');
    k.resume(first.input);
    await k.until(() => k.runs.length === 5);
    expect(await k.probeTake()).toEqual([]);
  });

  test('with a lane at its cap, a high job enqueued after low ones is taken before them once a slot frees', {
    timeout: 60_000,
  }, async () => {
    const k = kit();
    const low = [1, 2, 3, 4, 5, 6];
    await k.enqueue(low.map((n) => k.job(n, { priority: 'low' })));
    for (const n of low) k.script(n, ['hold']);
    await k.worker('w1', 4);
    await k.until(() => k.runs.length === 4);
    await k.enqueue([k.job(7, { priority: 'high' })]);
    const [first] = k.runs;
    if (first === undefined) throw new Error('no run started');
    k.resume(first.input);
    // The high job completes at once and frees its slot: a low job may follow it, never precede it.
    await k.until(() => k.runs.length >= 5);
    expect(k.runs[4]?.input).toBe(7);
  });

  test('the fair take serves the tenant with the least running work first', {
    timeout: 60_000,
  }, async () => {
    const k = kit();
    await k.enqueue([k.job(1), k.job(2), k.job(3)], tenantA);
    await k.enqueue([k.job(4)], tenantB);
    await k.worker('w1', 1);
    await k.until(() => done(k, 4));
    expect(k.runs.slice(0, 2).map((run) => run.input)).toContain(4);
    expect(k.runs.filter((run) => run.input === 4).map((run) => run.scopeId)).toEqual([
      tenantB.tenantId,
    ]);
  });

  test('a group admits its concurrency across workers, and a finished job gives the slot back', {
    timeout: 60_000,
  }, async () => {
    const k = kit();
    const numbers = [1, 2, 3];
    await k.enqueue(
      numbers.map((n) => k.job(n, { group: { id: 'one-at-a-time', concurrency: 1 } })),
    );
    for (const n of numbers) k.script(n, ['hold']);
    await k.worker('w1');
    await k.worker('w2');
    for (const [index] of numbers.entries()) {
      await k.until(() => k.runs.length === index + 1);
      expect(k.runs.filter((run) => run.end === 'running')).toHaveLength(1);
      expect(await k.probeTake()).toEqual([]);
      const current = k.runs[index];
      if (current === undefined) throw new Error('no run started');
      k.resume(current.input);
      await k.until(() => current.end === 'completed');
    }
    expect(k.runs).toHaveLength(3);
  });

  test('a group rate admits the tokens it has and holds the rest back', {
    timeout: 60_000,
  }, async () => {
    const k = kit();
    await k.enqueue(
      [1, 2, 3].map((n) => k.job(n, { group: { id: 'two-per-hour', rate: '2/1h' } })),
    );
    await k.worker('w1');
    await k.until(() => done(k, 2));
    await k.until(async () => (await k.stats())?.queued === 1);
    expect(await k.probeTake()).toEqual([]);
    expect(k.runs).toHaveLength(2);
  });

  test('a schedule tick is claimed once per scope by two tickers, and its job runs once per scope', {
    timeout: 60_000,
  }, async () => {
    const k = kit();
    const schedule = 'scenario.nightly';
    const tick = k.clock().now();
    const next = tick.add({ hours: 1 });
    const scopes = [
      { scope: tenantA, n: 1 },
      { scope: tenantB, n: 2 },
    ] as const;
    for (const { scope } of scopes) {
      await subject.run(scope, (unit) => unit.jobs.schedules().upsert(schedule, tick));
    }
    await Promise.all(
      scopes.flatMap(({ scope, n }) =>
        [1, 2].map(async () => {
          const won = await subject.run(scope, (unit) =>
            unit.jobs.schedules().claimTick(schedule, scope.tenantId, tick, next),
          );
          if (won) await k.enqueue([k.job(n)], scope);
        }),
      ),
    );
    await k.worker('w1');
    await k.until(() => done(k, 2));
    expect(k.runs.map((run) => run.scopeId).sort()).toEqual(
      [tenantA.tenantId, tenantB.tenantId].sort(),
    );
    expect(await k.written(tenantA)).toEqual(['1/1']);
    expect(await k.written(tenantB)).toEqual(['2/1']);
    expect(await k.probeTake()).toEqual([]);
  });
}
