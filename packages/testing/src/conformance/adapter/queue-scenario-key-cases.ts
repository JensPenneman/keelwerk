import { expect, test } from 'vitest';
import type { QueueScenarioKit } from './queue-scenario-kit.ts';

const key = (value: string, onConflict: 'keep' | 'replace' | 'coalesce' | 'append') => ({
  value,
  onConflict,
});

/** The key policies and the order per key of 14.3.9 and 14.10 case 10, through the kernel queue. */
export function queueScenarioKeyCases(kit: () => QueueScenarioKit): void {
  test('keep answers the pending job, and the queue runs it once', {
    timeout: 60_000,
  }, async () => {
    const k = kit();
    const [first] = await k.enqueue([k.job(1, { key: key('same', 'keep') })]);
    const [second] = await k.enqueue([k.job(2, { key: key('same', 'keep') })]);
    expect(second).toBe(first);
    await k.worker('w1');
    await k.until(() => k.runs.length === 1 && k.runs.every((run) => run.end === 'completed'));
    await k.until(async () => (await k.stats())?.queued === 0);
    expect(k.runs.map((run) => run.input)).toEqual([1]);
    expect(await k.written()).toEqual(['1/1']);
  });

  test('replace drops the pending job: only the newer input runs', {
    timeout: 60_000,
  }, async () => {
    const k = kit();
    const [first] = await k.enqueue([k.job(1, { key: key('same', 'replace') })]);
    const [second] = await k.enqueue([k.job(2, { key: key('same', 'replace') })]);
    expect(second).not.toBe(first);
    expect((await k.stats())?.due).toBe(1);
    await k.worker('w1');
    await k.until(() => k.runs.length === 1 && k.runs.every((run) => run.end === 'completed'));
    await k.until(async () => (await k.stats())?.queued === 0);
    expect(k.runs.map((run) => run.input)).toEqual([2]);
    expect(await k.written()).toEqual(['2/1']);
  });

  test('coalesce moves runAt to the earlier time and the job runs once', {
    timeout: 60_000,
  }, async () => {
    const k = kit();
    const clock = k.clock();
    const [first] = await k.enqueue([
      k.job(1, { key: key('same', 'coalesce'), runAt: clock.now().add({ seconds: 60 }) }),
    ]);
    const [second] = await k.enqueue([
      k.job(2, { key: key('same', 'coalesce'), runAt: clock.now().add({ seconds: 5 }) }),
    ]);
    expect(second).toBe(first);
    await k.worker('w1');
    // Four seconds in, the job is still scheduled: a sweep that began after the move promotes and
    // takes nothing, and the store's own take after a promotion agrees.
    clock.advance(4_000);
    await k.swept();
    expect(await k.probeTake()).toEqual([]);
    expect(k.runs).toEqual([]);
    clock.advance(2_000);
    await k.until(() => k.runs.length === 1 && k.runs.every((run) => run.end === 'completed'));
    expect(k.runs.map((run) => run.input)).toEqual([1]);
    clock.advance(60_000);
    expect(await k.probeTake()).toEqual([]);
    expect((await k.stats())?.queued).toBe(0);
    expect(k.runs).toHaveLength(1);
  });

  test('FIFO per key holds under four concurrent takers: each key runs in enqueue order, one attempt at a time', {
    timeout: 60_000,
  }, async () => {
    const k = kit();
    const keys = [1, 2, 3];
    const numbers = (index: number): number[] => [1, 2, 3, 4, 5].map((i) => index * 10 + i);
    await k.enqueue(
      keys.flatMap((index) =>
        numbers(index).map((n) =>
          k.job(n, { key: key(`key-${index}`, 'append'), ordering: 'fifo-per-key' }),
        ),
      ),
    );
    // The first two jobs of each key wait for the test, so a follower that overtook would show.
    for (const index of keys) {
      k.script(index * 10 + 1, ['hold']);
      k.script(index * 10 + 2, ['hold']);
    }
    for (const id of ['w1', 'w2', 'w3', 'w4']) await k.worker(id);
    await k.until(() => k.runs.length === 3);
    expect(k.runs.map((run) => run.input).sort()).toEqual([11, 21, 31]);
    expect(await k.probeTake()).toEqual([]);
    for (const index of keys) k.resume(index * 10 + 1);
    await k.until(() => k.runs.length === 6);
    expect(
      k.runs
        .slice(3)
        .map((run) => run.input)
        .sort(),
    ).toEqual([12, 22, 32]);
    expect(await k.probeTake()).toEqual([]);
    for (const index of keys) k.resume(index * 10 + 2);
    await k.until(() => k.runs.length === 15 && k.runs.every((run) => run.end === 'completed'));
    for (const index of keys) {
      expect(
        k.runs.filter((run) => Math.floor(run.input / 10) === index).map((run) => run.input),
      ).toEqual(numbers(index));
    }
    expect(await k.written()).toHaveLength(15);
  });
}
