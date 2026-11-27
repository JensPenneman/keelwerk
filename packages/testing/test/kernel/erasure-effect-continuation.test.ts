import { errors, parseSealedValueText } from '@keelwerk/core';
import { afterEach, expect, test } from 'vitest';
import { courierApp } from './support/erasure-courier-app.ts';
import { bootCourier } from './support/erasure-courier-kit.ts';
import { jobSpy } from './support/job-spy.ts';

let current: Awaited<ReturnType<typeof bootCourier>> | undefined;
afterEach(async () => {
  await current?.runtime.stop();
  current = undefined;
});

test('the erasure of a subject settles its effect without the continuation when the continuation cannot be enqueued, and destroys its keys, tombstoned', {
  timeout: 120_000,
}, async () => {
  const descriptors = new Map(
    [...courierApp.registry.entities].map(([ref, entry]) => [ref, entry.descriptor] as const),
  );
  const watched = jobSpy((ref) => descriptors.get(ref));
  const booted = await bootCourier({
    external: { factory: watched.factory, url: 'memory://watched' },
  });
  current = booted;
  const requested = await booted.send({ parcel: 'requested' });
  let refusals = 0;
  watched.spy.beforeEnqueue = (job) => {
    if (job.key?.value.startsWith('core.continuation:') !== true) return;
    refusals += 1;
    throw errors.validation('the continuation input no longer seals');
  };
  const waybill = ((await booted.effectRow(requested.id)).input as { waybill: string }).waybill;
  await booted.ask();
  await booted.worker.pass();
  await booted.runtime.drainJobs();
  expect(refusals).toBeGreaterThan(0);
  expect(await booted.effectRow(requested.id)).toMatchObject({
    status: 'failed',
    error: { code: 'core.key_destroyed' },
  });
  expect(await booted.opens(waybill)).toBe(false);
  expect(await booted.tombstones()).toContain(parseSealedValueText(waybill)?.keyId);
  // No continuation ran: the logbook it writes stays empty.
  expect(await booted.rows('courier.logbook')).toHaveLength(0);
});
