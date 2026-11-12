import { afterEach, describe, expect, test } from 'vitest';
import { erasedEvents, seed } from './support/erasure-helpers.ts';
import { bootProbe, type Probe } from './support/erasure-kit.ts';

let probe: Probe | undefined;
afterEach(async () => {
  await probe?.runtime.stop();
  probe = undefined;
});

describe('a stop at the deadline', () => {
  test('between units writes nothing late: the stream that was not reached is not erased', {
    timeout: 60_000,
  }, async () => {
    probe = await bootProbe();
    const ids = await seed(probe);
    probe.hold.at = 'streams';
    const { commandId } = await probe.eraseAsOperator(ids.adaId);
    await probe.runtime.drainJobs();
    const running = probe.worker.pass();
    await probe.hold.reached;
    expect((await erasedEvents(probe)).length).toBe(1);
    await probe.worker.stop(Temporal.Now.instant().add({ milliseconds: 50 }));
    probe.hold.release();
    await running.catch(() => undefined);
    await probe.worker.settled();
    // Only the stream erased before the stop; the rest is left to the next start pass.
    expect((await erasedEvents(probe)).length).toBe(1);
    const receipt = await probe.inTenant((unit) => unit.receipts.get(commandId));
    expect(receipt?.status).toBe('accepted');
  });

  test('inside a writing unit commits nothing: the unit rolls back and refuses what it still sends', {
    timeout: 60_000,
  }, async () => {
    probe = await bootProbe();
    const ids = await seed(probe);
    probe.inside.armed = true;
    const { commandId } = await probe.eraseAsOperator(ids.adaId);
    await probe.runtime.drainJobs();
    const running = probe.worker.pass();
    // The worker is inside the writing unit of its first stream, which has not written yet.
    await probe.inside.reached;
    await probe.worker.stop(Temporal.Now.instant().add({ milliseconds: 50 }));
    // The abandoned work resumes and tries to write into a unit that has ended.
    probe.inside.release();
    await running.catch(() => undefined);
    await probe.worker.settled();
    expect(await erasedEvents(probe)).toEqual([]);
    expect((await probe.rowsOf('probe.person')).map((row) => row.id).sort()).toEqual(
      [ids.adaId, ids.beaId].sort(),
    );
    const receipt = await probe.inTenant((unit) => unit.receipts.get(commandId));
    expect(receipt?.status).toBe('accepted');
  });
});
