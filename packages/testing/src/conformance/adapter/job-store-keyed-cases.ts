import type { JobOutcome, Unit, WireError } from '@keelwerk/core';
import { conformanceScopes } from '@keelwerk/data/conformance';
import { expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { jobStoreHelpers } from './job-store-helpers.ts';

const { tenantA, tenantB } = conformanceScopes;
const namespaceScope = { level: 'namespace', reason: 'conformance' } as const;
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const unavailable: WireError = {
  kind: 'unavailable',
  code: 'core.unavailable',
  message: 'down',
  retryable: true,
  requestId: 'r',
};
const dead: JobOutcome = { kind: 'dead', error: unavailable };

/**
 * `JobStore.keyed`, which the restore check asks before it enqueues an effect's job again: a job
 * with the key counts while it is scheduled, available, waiting or running, and no more once it has
 * ended or died; another queue and another scope do not match. And the uncounted retry of a job a
 * held tenant refused, which gives its attempt back; against the job store of every adapter.
 */
export function jobStoreKeyedCases(subject: Pick<ConformanceSubject, 'run' | 'clock'>): void {
  const now = (): Temporal.Instant => subject.clock?.now() ?? Temporal.Now.instant();
  const wait = async (ms: number): Promise<void> => {
    if (subject.clock === undefined) await pause(ms);
    else subject.clock.advance(ms);
  };
  const { take, enqueue, finish, only, numbered } = jobStoreHelpers(subject);
  const keyedIn = (
    scope: Parameters<ConformanceSubject['run']>[0],
    queue: string,
    key: string,
  ): Promise<boolean> => subject.run(scope, (unit: Unit) => unit.jobs.keyed(queue, key));
  const keyed = (value: string) => ({ value, onConflict: 'keep' as const });

  test('keyed finds a job in every live state, running included, and none once it ended or died', async () => {
    await enqueue([
      numbered(1, { key: keyed('k-available') }),
      numbered(2, { key: keyed('k-later'), runAt: now().add({ hours: 1 }) }),
    ]);
    expect(await keyedIn(tenantA, 'commands', 'k-available')).toBe(true);
    expect(await keyedIn(tenantA, 'commands', 'k-later')).toBe(true);
    expect(await keyedIn(tenantA, 'commands', 'k-none')).toBe(false);
    const running = only(await take('w1', { limit: 1 }));
    expect(await keyedIn(tenantA, 'commands', 'k-available')).toBe(true);
    expect(await finish(running, 'w1', { kind: 'succeeded' })).toBe(true);
    expect(await keyedIn(tenantA, 'commands', 'k-available')).toBe(false);
    await enqueue([numbered(3, { key: keyed('k-dead') })]);
    const doomed = only(await take('w1', { limit: 1 }));
    expect(await finish(doomed, 'w1', dead)).toBe(true);
    expect(await keyedIn(tenantA, 'commands', 'k-dead')).toBe(false);
  });

  test('keyed matches the queue and the unit scope, and a namespace unit reaches every scope', async () => {
    await enqueue([numbered(1, { key: keyed('k1'), queue: 'timers' })]);
    expect(await keyedIn(tenantA, 'timers', 'k1')).toBe(true);
    expect(await keyedIn(tenantA, 'commands', 'k1')).toBe(false);
    expect(await keyedIn(tenantB, 'timers', 'k1')).toBe(false);
    expect(await keyedIn(namespaceScope, 'timers', 'k1')).toBe(true);
  });

  test('an uncounted retry gives the attempt back and a counted one does not', async () => {
    await enqueue([numbered(1)]);
    const first = only(await take('w1'));
    expect(first.attempt.attempt).toBe(1);
    const at = now().add({ milliseconds: 1000 });
    const uncounted: JobOutcome = { kind: 'retry', at, error: unavailable, uncounted: true };
    expect(await finish(first, 'w1', uncounted)).toBe(true);
    await wait(1100);
    await subject.run(namespaceScope, (unit) => unit.jobs.promote('commands', 10));
    const second = only(await take('w2'));
    expect(second.attempt.attempt).toBe(1);
    const counted: JobOutcome = {
      kind: 'retry',
      at: now().add({ milliseconds: 1000 }),
      error: unavailable,
    };
    expect(await finish(second, 'w2', counted)).toBe(true);
    await wait(1100);
    await subject.run(namespaceScope, (unit) => unit.jobs.promote('commands', 10));
    expect(only(await take('w3')).attempt.attempt).toBe(2);
  });
}
