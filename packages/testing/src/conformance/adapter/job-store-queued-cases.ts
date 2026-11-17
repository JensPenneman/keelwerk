import type { JobOutcome, Unit, WireError } from '@keelwerk/core';
import { conformanceScopes } from '@keelwerk/data/conformance';
import { expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { jobStoreHelpers } from './job-store-helpers.ts';

const { tenantA, tenantB } = conformanceScopes;
const namespaceScope = { level: 'namespace', reason: 'conformance' } as const;
const unavailable: WireError = {
  kind: 'unavailable',
  code: 'core.unavailable',
  message: 'down',
  retryable: true,
  requestId: 'r',
};
const dead: JobOutcome = { kind: 'dead', error: unavailable };

/**
 * The bounded count of the jobs that wait to run, `JobStore.queued` (9.5.5): the states it counts,
 * that it reads no further than one job past the limit, the queue and the scope it reaches, and
 * the limits it refuses, against the job store of every adapter.
 */
export function jobStoreQueuedCases(subject: Pick<ConformanceSubject, 'run' | 'clock'>): void {
  const now = (): Temporal.Instant => subject.clock?.now() ?? Temporal.Now.instant();
  const { take, enqueue, finish, only, numbered } = jobStoreHelpers(subject);
  const appended = (n: number) =>
    numbered(n, { key: { value: 'chain', onConflict: 'append' }, ordering: 'fifo-per-key' });
  const queuedIn = (
    scope: Parameters<ConformanceSubject['run']>[0],
    queue: string,
    limit: number,
  ) => subject.run(scope, (unit: Unit) => unit.jobs.queued(queue, limit));
  /** The jobs of the stats case: one available, one scheduled, two waiting, and one running that then dies. */
  const fill = async () => {
    await enqueue([numbered(1)]);
    const running = only(await take('w1', { limit: 1 }));
    await enqueue([
      numbered(2),
      numbered(3, { runAt: now().add({ hours: 1 }) }),
      appended(4),
      appended(5),
    ]);
    return running;
  };

  test('queued counts the available, scheduled and waiting jobs of the queue, and no running or dead one', async () => {
    const running = await fill();
    expect(await queuedIn(namespaceScope, 'commands', 100)).toBe(4);
    expect(await finish(running, 'w1', dead)).toBe(true);
    expect(await queuedIn(namespaceScope, 'commands', 100)).toBe(4);
  });

  test('queued stops at limit + 1', async () => {
    await fill();
    expect(await queuedIn(namespaceScope, 'commands', 0)).toBe(1);
    expect(await queuedIn(namespaceScope, 'commands', 2)).toBe(3);
    expect(await queuedIn(namespaceScope, 'commands', 10)).toBe(4);
    expect(await queuedIn(namespaceScope, 'commands', 3)).toBe(4);
    expect(await queuedIn(namespaceScope, 'timers', 10)).toBe(0);
  });

  test('another queue is not counted', async () => {
    await fill();
    await enqueue([numbered(6, { queue: 'timers' }), numbered(7, { queue: 'timers' })]);
    expect(await queuedIn(namespaceScope, 'commands', 100)).toBe(4);
    expect(await queuedIn(namespaceScope, 'timers', 100)).toBe(2);
    expect(await queuedIn(namespaceScope, 'nobody', 100)).toBe(0);
  });

  test('a tenant unit counts its own scope only', async () => {
    await fill();
    await enqueue([numbered(8), numbered(9)], tenantB);
    expect(await queuedIn(tenantA, 'commands', 100)).toBe(4);
    expect(await queuedIn(tenantB, 'commands', 100)).toBe(2);
    expect(await queuedIn(namespaceScope, 'commands', 100)).toBe(6);
    expect(await queuedIn(tenantB, 'commands', 1)).toBe(2);
  });

  test.each([
    ['negative', -1],
    ['fractional', 1.5],
    ['past 2,147,483,646', 2_147_483_647],
    ['not a number', Number.NaN],
  ])('a limit that is %s is refused with core.malformed_request', async (_name, limit) => {
    await expect(queuedIn(namespaceScope, 'commands', limit)).rejects.toMatchObject({
      kind: 'validation',
      code: 'core.malformed_request',
    });
    expect(await queuedIn(namespaceScope, 'commands', 2_147_483_646)).toBe(0);
  });
}
