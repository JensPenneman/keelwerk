import { expect, test, vi } from 'vitest';
import { makePassWorld } from '../../test/support/make-pass-world.ts';

vi.mock('../effects/seal-job-input.ts', () => ({
  sealJobInput: async (
    _unit: unknown,
    _registry: unknown,
    _id: string,
    _action: unknown,
    input: unknown,
  ) => input,
}));

const T0 = Temporal.Instant.from('2026-01-01T00:05:00Z');
const ref = 'ticker.everyTenant';
const dueRows = (w: ReturnType<typeof makePassWorld>, ids: readonly string[]): void => {
  for (const id of ids) {
    w.rows.set(`${id}\u0000${ref}`, { scopeId: id, scheduleId: ref, nextTick: T0 });
  }
};

test('a backend whose units are slow gives its slot back after its budget and leaves its rows due', async () => {
  const ids = Array.from({ length: 20 }, (_, index) => `a${String(index).padStart(2, '0')}`);
  const w = makePassWorld({ one: ids });
  dueRows(w, ids);
  w.slow.ms = 20;
  await w.pass({ backendBudgetMs: 50, perBackend: 100 });
  await w.settle();
  expect(w.jobs.length).toBeGreaterThan(0);
  expect(w.jobs.length).toBeLessThan(20);
  expect(w.state.remaining).toBe(true);
  expect(w.state.busy.size).toBe(0);
  // The rows it left are still due: nothing was claimed or lost.
  expect(
    [...w.rows.values()].filter((row) => row.nextTick.epochMilliseconds === T0.epochMilliseconds),
  ).toHaveLength(20 - w.jobs.length);
});

test('a unit that passes unitTimeoutMs is abandoned: the task goes on and the row is tried again later', async () => {
  // The limit is fired by hand when a unit begins: the unit never ends, and no time passes.
  const limits: AbortController[] = [];
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
    const limit = new AbortController();
    limits.push(limit);
    return limit.signal;
  });
  try {
    const w = makePassWorld({ one: ['a1', 'a2'] });
    dueRows(w, ['a1', 'a2']);
    w.slow.hang = () => {
      for (const limit of limits) {
        limit.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
      }
    };
    // No budget the real clock can reach: the second row is never left due by a slow machine.
    await w.pass({ unitTimeoutMs: 30, backendBudgetMs: Number.POSITIVE_INFINITY });
    await w.settle();
    expect(w.jobs).toHaveLength(0);
    expect(w.logs.filter((line) => line.message.includes('failed in its unit'))).toHaveLength(2);
  } finally {
    vi.restoreAllMocks();
  }
});
