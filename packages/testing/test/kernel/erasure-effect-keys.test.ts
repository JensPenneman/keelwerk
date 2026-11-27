import { parseSealedValueText } from '@keelwerk/core';
import { afterEach, expect, test } from 'vitest';
import { bootCourier } from './support/erasure-courier-kit.ts';

let current: Awaited<ReturnType<typeof bootCourier>> | undefined;
afterEach(async () => {
  await current?.runtime.stop();
  current = undefined;
});

test("the secrets of the subject's external effects, input and output, no longer open and their keys are tombstoned; another subject's effect is left alone", {
  timeout: 120_000,
}, async () => {
  const booted = await bootCourier();
  current = booted;
  const requested = await booted.send({ parcel: 'requested' });
  const reported = await booted.send({ parcel: 'reported' });
  await booted.report(reported.id, 'seal marker');
  const stranger = await booted.send({
    owner: '0198a2c4-7e10-7a3b-8c5d-3f2a1b9d4e62',
    parcel: 'stranger',
    waybill: 'stranger waybill',
  });
  const texts = async () => ({
    requestedWaybill: ((await booted.effectRow(requested.id)).input as { waybill: string }).waybill,
    reportedWaybill: ((await booted.effectRow(reported.id)).input as { waybill: string }).waybill,
    reportedSeal: ((await booted.effectRow(reported.id)).output as { seal: string }).seal,
    strangerWaybill: ((await booted.effectRow(stranger.id)).input as { waybill: string }).waybill,
  });
  const before = await texts();
  for (const text of Object.values(before)) expect(await booted.opens(text)).toBe(true);

  await booted.ask();
  await booted.worker.pass();
  await booted.runtime.drainJobs();

  const after = await texts();
  expect(after).toEqual(before);
  expect(await booted.opens(after.requestedWaybill)).toBe(false);
  expect(await booted.opens(after.reportedWaybill)).toBe(false);
  expect(await booted.opens(after.reportedSeal)).toBe(false);
  const tombstoned = await booted.tombstones();
  for (const text of [after.requestedWaybill, after.reportedWaybill, after.reportedSeal]) {
    expect(tombstoned).toContain(parseSealedValueText(text)?.keyId);
  }
  // Another subject's effect keeps its key, stays requested and has no tombstone.
  expect(await booted.opens(after.strangerWaybill)).toBe(true);
  expect(await booted.effectRow(stranger.id)).toMatchObject({ status: 'requested' });
  expect(tombstoned).not.toContain(parseSealedValueText(after.strangerWaybill)?.keyId);
  // The settled effect keeps its outcome: only its secrets are gone.
  expect(await booted.effectRow(reported.id)).toMatchObject({ status: 'succeeded' });
});
