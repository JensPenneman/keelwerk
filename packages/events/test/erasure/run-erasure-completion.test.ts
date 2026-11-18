import type { LedgerRecord, LedgerSink } from '@keelwerk/core';
import { commandReceiptUuid } from '@keelwerk/core';
import { afterEach, describe, expect, test } from 'vitest';
import { erasedEvents, finish, flagRow, seed, targetFlag } from './support/erasure-helpers.ts';
import { bootProbe, type Probe } from './support/erasure-kit.ts';

let probe: Probe | undefined;
afterEach(async () => {
  await probe?.runtime.stop();
  probe = undefined;
});

/** A sink in memory: what it took, and a switch that makes it refuse every append. */
function memorySink(): LedgerSink & { readonly taken: LedgerRecord[]; refusing: boolean } {
  const taken: LedgerRecord[] = [];
  const sink = {
    id: 'memory',
    taken,
    refusing: false,
    append: async (records: readonly LedgerRecord[]) => {
      if (sink.refusing) throw new Error('the sink is full');
      taken.push(...records);
    },
    read: async function* () {
      yield* taken;
    },
  };
  return sink;
}

async function controlLedger(p: Probe) {
  return p.runtime.control.adapter.unit(
    p.runtime.control.namespace,
    { level: 'deployment' },
    (unit) => unit.ledger?.since(0n, 1000) ?? Promise.resolve([]),
    { readOnly: true },
  );
}

const completionsOf = async (p: Probe) =>
  (await controlLedger(p)).filter((entry) => entry.record.type === 'erasureCompleted');

describe('the completion of an erasure (14.7.5)', () => {
  test('the control ledger ends with one completion of epoch 0 and no sink holds it', async () => {
    const sink = memorySink();
    probe = await bootProbe('memory', { ledgers: [sink] });
    const ids = await seed(probe);
    const { commandId } = await probe.eraseAsOperator(ids.adaId);
    await finish(probe);
    const ledger = await controlLedger(probe);
    expect(ledger.map((entry) => entry.record.type)).toEqual([
      'erasure',
      'keyTombstone',
      'erasureCompleted',
    ]);
    expect(ledger[2]?.record).toMatchObject({
      type: 'erasureCompleted',
      commandId,
      subjectId: ids.adaId,
      epoch: 0,
    });
    const types = sink.taken.map((record) => record.type);
    expect(types).toContain('erasure');
    expect(types).toContain('keyTombstone');
    expect(types).not.toContain('erasureCompleted');
  });

  test('a new worker finds the erasure finished by its completion and runs no step, whatever the receipt', async () => {
    probe = await bootProbe('memory');
    const ids = await seed(probe);
    const { commandId } = await probe.eraseAsOperator(ids.adaId);
    await finish(probe);
    // The receipt is gone (it expired): the receipt-based check would run the erasure again.
    const entry = probe.runtime.app.registry.entities.get('core.commandReceipt');
    if (entry === undefined) throw new Error('no receipt entity');
    await probe.inTenant((unit) =>
      unit.rows.purge(entry.descriptor, [
        commandReceiptUuid(probe?.runtime.tenants.acme.id ?? '', commandId),
      ]),
    );
    const second = await probe.startWorker();
    expect(second.steps).toEqual([]);
    expect(await completionsOf(probe)).toHaveLength(1);
  });

  for (const step of ['receipt', 'completed'] as const) {
    test(`a throw after ${step} is finished by the next start pass with one completion`, async () => {
      probe = await bootProbe('memory');
      const ids = await seed(probe);
      probe.crash.at = step;
      const { commandId } = await probe.eraseAsOperator(ids.adaId);
      await probe.runtime.drainJobs();
      await probe.worker.pass();
      expect(await completionsOf(probe)).toHaveLength(step === 'completed' ? 1 : 0);
      const second = await probe.startWorker();
      expect(second.steps).toEqual(
        step === 'completed' ? [] : expect.arrayContaining(['completed']),
      );
      expect(await completionsOf(probe)).toHaveLength(1);
      const receipt = await probe.inTenant((unit) => unit.receipts.get(commandId));
      expect(receipt?.status).toBe('completed');
    });
  }

  test('a bump of the tenant epoch to 1 runs the erasure again and appends a completion of epoch 1', async () => {
    probe = await bootProbe('memory');
    const ids = await seed(probe);
    await probe.eraseAsOperator(ids.adaId);
    await finish(probe);
    await probe.bumpEpoch();
    const second = await probe.startWorker();
    expect(second.steps).toContain('shred');
    const epochs = (await completionsOf(probe)).map((entry) =>
      entry.record.type === 'erasureCompleted' ? entry.record.epoch : -1,
    );
    expect(epochs).toEqual([0, 1]);
    // The rerun leaves one erased event per stream.
    expect((await erasedEvents(probe)).length).toBe(3);
  });
});

describe('a pass reads the control ledger once, however many erasures it finishes', () => {
  test('three unfinished erasures cost the pages of one read', async () => {
    probe = await bootProbe('memory');
    const acme = probe.as('acme');
    const globex = probe.as('globex');
    const people = [
      await acme.invokeAs.invoke('probe.enrol', { name: 'A', email: 'a@example.test' }),
      await acme.invokeAs.invoke('probe.enrol', { name: 'B', email: 'b@example.test' }),
      await globex.invokeAs.invoke('probe.enrol', { name: 'C', email: 'c@example.test' }),
    ].map((made) => String((made as { personId: string }).personId));
    await acme.eraseAsOperator(people[0] ?? '');
    await acme.eraseAsOperator(people[1] ?? '');
    await globex.eraseAsOperator(people[2] ?? '');
    await probe.runtime.drainJobs();
    // Three records stand in the ledger and the first worker has not run: the start pass of a
    // second worker finishes all three, and the unfinished records are read once (one page).
    const second = await probe.startWorker();
    expect(second.steps.filter((step) => step === 'completed')).toHaveLength(3);
    expect(second.ledgerReads()).toBe(1);
  });
});

describe('the tombstones of step 2 survive a crash between the shred and the ledger append', () => {
  test('a crash after the shred leaves one tombstone per data key id in the control ledger and the sink', async () => {
    const sink = memorySink();
    probe = await bootProbe('memory', { ledgers: [sink] });
    const ids = await seed(probe);
    probe.crash.at = 'shred';
    await probe.eraseAsOperator(ids.adaId);
    await probe.runtime.drainJobs();
    await probe.worker.pass();
    // The keys are destroyed and committed, and nothing is recorded yet.
    const shredded = await probe.inTenant((unit) => unit.keys.shreddedKeys(ids.adaId));
    expect(shredded.length).toBeGreaterThan(0);
    expect((await controlLedger(probe)).some((entry) => entry.record.type === 'keyTombstone')).toBe(
      false,
    );
    await probe.startWorker();
    const wanted = shredded.map((key) => key.keyId).sort();
    const tombstones = (record: LedgerRecord): string[] =>
      record.type === 'keyTombstone' && record.reason === 'erasure' ? [record.keyId] : [];
    const inControl = (await controlLedger(probe)).flatMap((entry) => tombstones(entry.record));
    const inSink = sink.taken.flatMap(tombstones);
    for (const key of wanted) {
      expect(inControl.filter((id) => id === key)).toHaveLength(1);
      expect(inSink.filter((id) => id === key)).toHaveLength(1);
    }
  });

  test('a crash after the control append, before the sinks, gives the sink every tombstone again', async () => {
    const sink = memorySink();
    probe = await bootProbe('memory', { ledgers: [sink] });
    const ids = await seed(probe);
    // The sink refuses from the shred on: the control ledger has the tombstones, the sink none.
    probe.hold.at = 'shred';
    await probe.eraseAsOperator(ids.adaId);
    await probe.runtime.drainJobs();
    const running = probe.worker.pass();
    await probe.hold.reached;
    sink.refusing = true;
    probe.hold.release();
    await running;
    expect(sink.taken.some((record) => record.type === 'keyTombstone')).toBe(false);
    sink.refusing = false;
    await probe.worker.pass();
    expect(sink.taken.some((record) => record.type === 'keyTombstone')).toBe(true);
    expect(
      (await controlLedger(probe)).filter((entry) => entry.record.type === 'keyTombstone').length,
    ).toBe(sink.taken.filter((record) => record.type === 'keyTombstone').length);
  });
});

describe('a sink that took the erasure record once and refuses it later', () => {
  test('the run fails before the shred until the sink accepts the record again', async () => {
    const sink = memorySink();
    probe = await bootProbe('memory', { ledgers: [sink] });
    const ids = await seed(probe);
    const { commandId } = await probe.eraseAsOperator(ids.adaId);
    await probe.runtime.drainJobs();
    sink.refusing = true;
    await probe.worker.pass();
    // Nothing was shredded or erased: the run failed at step 1.
    expect(probe.steps).toEqual([]);
    expect(await probe.inTenant((unit) => unit.keys.shreddedKeys(ids.adaId))).toEqual([]);
    expect(await erasedEvents(probe)).toEqual([]);
    expect((await probe.inTenant((unit) => unit.receipts.get(commandId)))?.status).toBe('accepted');
    sink.refusing = false;
    await probe.worker.pass();
    expect((await probe.inTenant((unit) => unit.receipts.get(commandId)))?.status).toBe(
      'completed',
    );
    expect((await erasedEvents(probe)).length).toBe(3);
  });

  test('a receipt that failed with core.unavailable at step 1 is completed by the worker; another failure is left', async () => {
    probe = await bootProbe('memory');
    const ids = await seed(probe);
    const other = await probe.eraseAsOperator(ids.beaId);
    const { commandId } = await probe.eraseAsOperator(ids.adaId);
    await probe.runtime.drainJobs();
    const failWith = (id: string, code: string, kind: 'unavailable' | 'not_found') =>
      probe?.inTenant((unit) =>
        unit.receipts.complete(id, {
          ok: false,
          error: { kind, code, message: 'failed', retryable: false, requestId: 'r1' },
        }),
      );
    await failWith(commandId, 'core.unavailable', 'unavailable');
    await failWith(other.commandId, 'core.not_found', 'not_found');
    await probe.worker.pass();
    const done = await probe.inTenant((unit) => unit.receipts.get(commandId));
    expect(done?.status).toBe('completed');
    // Bea's erasure ran first and erased her thread, so Ada's reply on it is gone: two streams.
    expect(done?.outcome).toMatchObject({ ok: true, value: { streams: 2 } });
    expect((await probe.inTenant((unit) => unit.receipts.get(other.commandId)))?.status).toBe(
      'failed',
    );
  });
});

describe('what the receipt reports', () => {
  test('the streams count is the same after a repair as after a run without a crash', async () => {
    probe = await bootProbe('memory');
    const ids = await seed(probe);
    // The first stream is erased and the run crashes: the repair erases the other two and reports all three.
    probe.crash.at = 'streams';
    const { commandId } = await probe.eraseAsOperator(ids.adaId);
    await probe.runtime.drainJobs();
    await probe.worker.pass();
    await probe.worker.pass();
    const receipt = await probe.inTenant((unit) => unit.receipts.get(commandId));
    expect(receipt?.outcome).toMatchObject({ ok: true, value: { streams: 3 } });
  });
});

describe('a flag scrub in flight at the stop deadline (14.7.5 step 5b)', () => {
  test('is abandoned, changes nothing, and the next start pass does the whole scrub', {
    timeout: 60_000,
  }, async () => {
    probe = await bootProbe('memory');
    const ids = await seed(probe);
    const flagId = await targetFlag(probe, [ids.adaId, ids.beaId], 'first');
    probe.inside.step = 'flags';
    probe.inside.armed = true;
    const { commandId } = await probe.eraseAsOperator(ids.adaId);
    await probe.runtime.drainJobs();
    const running = probe.worker.pass();
    // The worker is inside the unit of the scrub, which has not written yet.
    await probe.inside.reached;
    await probe.worker.stop(Temporal.Now.instant().add({ milliseconds: 50 }));
    probe.inside.release();
    await running.catch(() => undefined);
    await probe.worker.settled();
    expect(JSON.stringify((await flagRow(probe, flagId))?.targeting)).toContain(ids.adaId);
    expect((await probe.inTenant((unit) => unit.receipts.get(commandId)))?.status).toBe('accepted');
    // The next start finishes it with the same result as a run that was never stopped.
    await probe.startWorker();
    const flag = await flagRow(probe, flagId);
    expect(JSON.stringify(flag?.targeting)).not.toContain(ids.adaId);
    expect(JSON.stringify(flag?.targeting)).toContain(ids.beaId);
    expect((await probe.inTenant((unit) => unit.receipts.get(commandId)))?.status).toBe(
      'completed',
    );
    expect(await completionsOf(probe)).toHaveLength(1);
  });
});
