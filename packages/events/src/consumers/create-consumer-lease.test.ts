import type { Logger, QueueSource } from '@keelwerk/core';
import { expect, test } from 'vitest';
import { createConsumerLease } from './create-consumer-lease.ts';

const start = Temporal.Instant.from('2026-01-01T00:00:00Z');
const never = () => undefined;
const log: Logger = { info: never, warn: never, error: never, debug: never, child: () => log };

/**
 * A lease over a store whose unit answers as `answers` say, one per call: an error, or a result.
 */
function leaseOver(answers: (Error | boolean)[]) {
  let now = start;
  const source = {
    namespace: { id: 'ns' },
    handle: {
      adapter: {
        unit: async () => {
          const answer = answers.shift();
          if (answer instanceof Error) throw answer;
          return answer;
        },
      },
    },
  } as unknown as QueueSource;
  const lease = createConsumerLease({
    consumer: 'c',
    source,
    owner: 'o',
    leaseMs: 30_000,
    clock: { now: () => now },
    log,
    random: () => 0.5,
  });
  return {
    lease,
    at: () => now.since(start).total('milliseconds'),
    move: (to: number) => (now = start.add({ milliseconds: to })),
  };
}

test('a lease call that fails is tried again by the policy, not after a third of the lease, and an answer starts it again', async () => {
  const away = new Error('the database is away');
  const { lease, move } = leaseOver([away, away, away, true, away]);
  const due = () => lease.dueAt().since(start).total('milliseconds');
  // The first failure: one second; the second: two; the third: four.
  expect(await lease.acquire()).toBe(false);
  expect(due()).toBe(1000);
  move(1000);
  expect(await lease.acquire()).toBe(false);
  expect(due()).toBe(3000);
  move(3000);
  expect(await lease.acquire()).toBe(false);
  expect(due()).toBe(7000);
  // An answer is paced by a third of the lease and forgets the failures: the next failure waits a
  // second.
  move(7000);
  expect(await lease.acquire()).toBe(true);
  expect(due()).toBe(17_000);
  move(17_000);
  expect(await lease.renew()).toBe(false);
  expect(due()).toBe(18_000);
});

test('a lease the store answers no to is paced by a third of the lease and counts no failure', async () => {
  const { lease } = leaseOver([false, false]);
  expect(await lease.acquire()).toBe(false);
  expect(lease.dueAt().since(start).total('milliseconds')).toBe(10_000);
});
