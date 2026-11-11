import type { StoredJobSpec } from '@keelwerk/core';
import { expect } from 'vitest';
import type { ReactionsKit } from './reactions-kit.ts';
import { tenantEventsOf } from './reactions-kit.ts';
import { relayControl } from './relay-control.ts';

const flakyOf = async (kit: ReactionsKit, tenant: 'acme' | 'globex') =>
  (await kit.rows(tenant, 'relay.echo')).filter((row) => row.reaction === 'relay.flaky');

/**
 * SLICE M2-3 (criterion 2): tenant A's async reaction fails three times with `unavailable` and is
 * retried by its policy with back-off, while tenant B's reactions to the same event type complete in
 * the first take after their enqueue, whatever A is waiting for. Times are the pinned clock's, read
 * from the rows the reactions wrote, never wall time. `relay.forward` maps the invoked command's
 * declared error to its own.
 */
export async function runSliceThree(kit: ReactionsKit): Promise<void> {
  const t0 = kit.now();
  for (let index = 0; index < 10; index += 1) {
    const sent = await kit.send('acme', { channel: 'down', text: `n${String(index)}` });
    expect(sent.ok).toBe(true);
  }
  await kit.settle();
  const downEvents = (await tenantEventsOf(kit, 'acme')).filter(
    (event) => event.type === 'relay.signal.created',
  );
  expect(downEvents).toHaveLength(10);
  // Attempt 1 of every A job failed with unavailable: no echo yet, and each job waits in back-off.
  expect(await flakyOf(kit, 'acme')).toEqual([]);
  for (const event of downEvents) expect(relayControl.attempts.get(event.eventId)).toBe(1);

  // A's ten retries become due at t0 + 11 s. B's three events are written at that instant, so B's jobs
  // are due while A's are, and the worker's take has to share between the tenants: the first take that
  // claims anything holds a job of B (an unfair take would claim A's ten first), and all of B's
  // reactions are answered at that instant, whatever A retries. No take is let through until B's
  // three reaction jobs are queued, so what the first take claims never depends on how fast the
  // adapter commits against the workers' polling.
  const later = t0.add({ seconds: 11 });
  kit.pin(later);
  const spy = kit.spy;
  if (spy === undefined) throw new Error('the slice needs a kit booted with the job store watched');
  spy.takes.length = 0;
  spy.enqueued.length = 0;
  spy.refuseTake = () => true;
  try {
    for (const text of ['b1', 'b2', 'b3']) {
      const sent = await kit.send('globex', { channel: 'up', text });
      expect(sent.ok).toBe(true);
    }
    while ((await kit.dispatcher.settled()) > 0) {
      // The dispatcher enqueues the reaction jobs of the events written so far.
    }
  } finally {
    spy.refuseTake = undefined;
  }
  const isGlobex = (job: StoredJobSpec) =>
    job.scope.level === 'tenant' && job.scope.tenantId === kit.runtime.tenants.globex.id;
  const queued = spy.enqueued.filter(
    (entry) => entry.job.queue === 'reactions' && isGlobex(entry.job),
  );
  expect(queued.length).toBeGreaterThanOrEqual(3);
  expect(spy.takes.filter((take) => take.jobs.length > 0)).toEqual([]);
  await kit.settle();
  for (const event of downEvents) expect(relayControl.attempts.get(event.eventId)).toBe(2);
  // The first take that claims anything holds a job of B.
  const firstTake = spy.takes.find((take) => take.queue === 'reactions' && take.jobs.length > 0);
  expect(firstTake?.jobs.some(isGlobex)).toBe(true);
  const globex = await kit.rows('globex', 'relay.echo');
  expect(globex.map((row) => row.reaction).filter((name) => name === 'relay.flaky')).toHaveLength(
    3,
  );
  for (const row of globex) expect(row.createdAt).toEqual(later);
  expect(await flakyOf(kit, 'acme')).toEqual([]);

  // The retries follow the policy's delays (10 s, 20 s, 40 s, each at most): A succeeds at the fourth attempt.
  await kit.advanceTo(t0.add({ seconds: 32 }));
  for (const event of downEvents) expect(relayControl.attempts.get(event.eventId)).toBe(3);
  expect(await flakyOf(kit, 'acme')).toEqual([]);
  await kit.advanceTo(t0.add({ seconds: 74 }));
  const done = await flakyOf(kit, 'acme');
  expect(done).toHaveLength(10);
  for (const row of done) {
    expect(row.count).toBe(4);
    expect(Temporal.Instant.compare(row.createdAt as Temporal.Instant, t0)).toBeGreaterThan(0);
  }

  // The invoked command's declared error becomes the caller's own.
  const forwarded = await kit.call('acme', 'relay.forward', {});
  expect(forwarded.ok).toBe(false);
  if (!forwarded.ok) {
    expect(forwarded.error).toMatchObject({
      kind: 'validation',
      code: 'relay.forward_refused',
      message: 'The relay could not forward it.',
    });
  }
}
