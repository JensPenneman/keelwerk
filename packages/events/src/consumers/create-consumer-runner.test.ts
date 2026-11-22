import type { ConsumerSpec, Logger, QueueSource } from '@keelwerk/core';
import { expect, test, vi } from 'vitest';
import { createConsumerRunner } from './create-consumer-runner.ts';

const seam = vi.hoisted(() => ({
  lookups: 0,
  outcome: 'fail' as 'fail' | 'unknown',
  /** What the lease of the runner answers: whether it is held, when it is due, its renewal. */
  held: true,
  due: Temporal.Instant.from('2099-01-01T00:00:00Z'),
  renewal: 'renewed' as 'renewed' | 'refused',
}));
vi.mock('./create-consumer-lease.ts', () => ({
  createConsumerLease: () => ({
    acquire: async () => {
      seam.held = true;
      seam.due = Temporal.Instant.from('2099-01-01T00:00:00Z');
      return true;
    },
    renew: async () => {
      if (seam.renewal === 'renewed') return true;
      seam.held = false;
      return false;
    },
    release: async () => undefined,
    holds: () => seam.held,
    dueAt: () => seam.due,
  }),
}));
vi.mock('./scope-target-of.ts', () => ({
  scopeTargetOf: async () => {
    seam.lookups += 1;
    if (seam.outcome === 'fail') throw new Error('the database is away');
    return undefined;
  },
}));
vi.mock('./moved-scopes-of.ts', () => ({ movedScopesOf: async () => [] }));
vi.mock('./replay-parked-streams.ts', () => ({ replayParkedStreams: async () => true }));

const start = Temporal.Instant.from('2026-01-01T00:00:00Z');

const never = () => undefined;
const log: Logger = { info: never, warn: never, error: never, debug: never, child: () => log };

/** A runner on a clock the test moves, a lease it controls and a random draw of one half. */
function runnerOnPinnedClock(): {
  readonly runner: ReturnType<typeof createConsumerRunner>;
  /** Moves the clock to `milliseconds` after the start and wakes the scope; the lookups so far. */
  readonly passAt: (milliseconds: number, options?: { readonly wake: boolean }) => Promise<number>;
} {
  seam.lookups = 0;
  seam.outcome = 'fail';
  seam.held = true;
  seam.due = Temporal.Instant.from('2099-01-01T00:00:00Z');
  seam.renewal = 'renewed';
  let now = start;
  const runner = createConsumerRunner({
    spec: { id: 'c', start: 'beginning' } as unknown as ConsumerSpec,
    source: { namespace: { id: 'ns' }, handle: { adapter: {} } } as unknown as QueueSource,
    directory: {} as never,
    deploymentId: 'd',
    owner: 'o',
    leaseMs: 30_000,
    batchSize: 10,
    clock: { now: () => now },
    log,
    ready: async () => true,
    random: () => 0.5,
  });
  const passAt = async (
    milliseconds: number,
    options: { readonly wake: boolean } = { wake: true },
  ): Promise<number> => {
    now = start.add({ milliseconds });
    if (options.wake) runner.wake(['s1']);
    await runner.pass();
    return seam.lookups;
  };
  return { runner, passAt };
}

test('a scope whose turn keeps failing waits by the policy, and a turn that succeeds starts the pauses again', async () => {
  const { passAt } = runnerOnPinnedClock();
  // The first failure holds the scope for a second.
  expect(await passAt(0)).toBe(1);
  expect(await passAt(999)).toBe(1);
  expect(await passAt(1000)).toBe(2);
  // The second failure in a row holds it for two.
  expect(await passAt(2999)).toBe(2);
  expect(await passAt(3000)).toBe(3);
  // A turn that ends without failing forgets the failures: the next one waits a second again.
  seam.outcome = 'unknown';
  expect(await passAt(7000)).toBe(4);
  seam.outcome = 'fail';
  expect(await passAt(7001)).toBe(5);
  expect(await passAt(8000)).toBe(5);
  expect(await passAt(8001)).toBe(6);
});

test('a lease lost and acquired again starts the pauses of a failing scope again', async () => {
  const { passAt } = runnerOnPinnedClock();
  // The first failure holds the scope for a second.
  expect(await passAt(0)).toBe(1);
  // The renewal is refused: the lease is lost and with it what the runner knew of the scope.
  seam.due = start.add({ milliseconds: 500 });
  seam.renewal = 'refused';
  expect(await passAt(500, { wake: false })).toBe(1);
  expect(seam.held).toBe(false);
  // The lease is acquired again; the scope fails once more, which is its first failure now.
  seam.renewal = 'renewed';
  expect(await passAt(600, { wake: false })).toBe(1);
  expect(seam.held).toBe(true);
  expect(await passAt(700)).toBe(2);
  // A second failure in a row would hold it for two seconds, the first holds it for one.
  expect(await passAt(1699)).toBe(2);
  expect(await passAt(1700)).toBe(3);
});
