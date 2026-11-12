import type { LedgerRecord, LedgerSink } from '@keelwerk/core';
import { afterEach, describe, expect, test } from 'vitest';
import {
  erasedEvents,
  finish,
  flagRow,
  markers,
  seed,
  targetFlag,
} from './support/erasure-helpers.ts';
import { bootProbe, type Probe } from './support/erasure-kit.ts';

let probe: Probe | undefined;
afterEach(async () => {
  await probe?.runtime.stop();
  probe = undefined;
});

describe('erasing a subject end to end (14.7.5)', () => {
  test.each(['memory', 'pglite'] as const)(
    'clears the subject everywhere it lives and keeps the others, on %s',
    {
      timeout: 60_000,
    },
    async (kind) => {
      probe = await bootProbe(kind);
      const ids = await seed(probe);
      const flagId = await targetFlag(probe, [ids.adaId, ids.beaId], 'first');
      await targetFlag(probe, [ids.adaId], 'second');
      const { commandId } = await probe.eraseAsOperator(ids.adaId);
      await finish(probe);

      // The flag rules no longer name the subject, in the targeting or in the rule set it replaced.
      const flag = await flagRow(probe, flagId);
      expect(JSON.stringify(flag?.targeting)).not.toContain(ids.adaId);
      expect(JSON.stringify(flag?.previous)).not.toContain(ids.adaId);
      expect(JSON.stringify(flag?.previous)).toContain(ids.beaId);

      // The owned rows are erased tombstones: invisible even to a read that includes archived rows.
      const people = await probe.rowsOf('probe.person');
      expect(people.map((row) => row.id)).toEqual([ids.beaId]);
      expect(people[0]?.email).toBe(markers.beaEmail);
      const threads = await probe.rowsOf('probe.thread');
      expect(threads.map((row) => row.id)).toEqual([ids.beaThreadId]);
      // Ada's reply on Bea's living thread is cleared; the row stays visible.
      expect(threads[0]?.reply).toBeUndefined();
      expect(threads[0]?.title).toBe('b');

      // Bea's own value on Ada's (erased) thread is still sealed under Bea's key; Bea is untouched.
      const events = await erasedEvents(probe);
      expect(events.map((event) => event.stream.type).sort()).toEqual([
        'probe.person',
        'probe.thread',
        'probe.thread',
      ]);
      expect(new Set(events.map((event) => event.commandId))).toEqual(new Set([commandId]));
      for (const event of events) {
        expect(event.data).toMatchObject({ subjectId: ids.adaId });
        expect(JSON.stringify(event.data)).not.toContain('marker');
      }

      // The receipt is completed once, with the stream count.
      const receipt = await probe.inTenant((unit) => unit.receipts.get(commandId));
      expect(receipt?.status).toBe('completed');
      expect(receipt?.outcome).toMatchObject({ ok: true, value: { streams: 3 } });

      // The ledger holds the erasure record, a tombstone and the completion, and no personal value.
      const ledger = await probe.runtime.control.adapter.unit(
        probe.runtime.control.namespace,
        { level: 'deployment' },
        (unit) => unit.ledger?.since(0n, 100) ?? Promise.resolve([]),
        { readOnly: true },
      );
      expect(ledger.map((entry) => entry.record.type)).toEqual([
        'erasure',
        'keyTombstone',
        'erasureCompleted',
      ]);
      expect(JSON.stringify(ledger.map((entry) => entry.record))).not.toContain('marker');
      expect(ledger[0]?.record).toMatchObject({
        subjectId: ids.adaId,
        reason: 'subjectRequest',
        commandId,
      });
      expect(ledger[2]?.record).toEqual({
        type: 'erasureCompleted',
        tenantId: probe.runtime.tenants.acme.id,
        commandId,
        subjectId: ids.adaId,
        epoch: 0,
        recordedAt: expect.any(String),
      });
    },
  );

  test('a second pass changes nothing: one erased event per stream, the receipt completed once', {
    timeout: 60_000,
  }, async () => {
    probe = await bootProbe();
    const ids = await seed(probe);
    await probe.eraseAsOperator(ids.adaId);
    await finish(probe);
    const before = await erasedEvents(probe);
    await probe.worker.pass();
    await probe.worker.pass();
    expect((await erasedEvents(probe)).length).toBe(before.length);
    expect(before.length).toBe(3);
  });

  test('a subject unknown in the tenant is refused with not_found and nothing reaches the ledger', {
    timeout: 60_000,
  }, async () => {
    probe = await bootProbe();
    await seed(probe);
    const { commandId } = await probe.eraseAsOperator('00000000-0000-4000-8000-0000000000ff');
    await probe.runtime.drainJobs();
    await probe.worker.pass();
    const receipt = await probe.inTenant((unit) => unit.receipts.get(commandId));
    expect(receipt?.status).toBe('failed');
    expect(receipt?.outcome).toMatchObject({ ok: false, error: { code: 'core.not_found' } });
    const ledger = await probe.runtime.control.adapter.unit(
      probe.runtime.control.namespace,
      { level: 'deployment' },
      (unit) => unit.ledger?.since(0n, 100) ?? Promise.resolve([]),
      { readOnly: true },
    );
    expect(ledger).toEqual([]);
  });
});

describe('a crash after any step is repaired by replaying the ledger', () => {
  for (const step of [
    'ledger',
    'shred',
    'tombstones',
    'streams',
    'principals',
    'flags',
    'receipt',
    'completed',
  ] as const) {
    test(`after ${step}`, { timeout: 60_000 }, async () => {
      probe = await bootProbe();
      const ids = await seed(probe);
      probe.crash.at = step;
      const { commandId } = await probe.eraseAsOperator(ids.adaId);
      await probe.runtime.drainJobs();
      await probe.worker.pass();
      // The crash left the record unfinished; the replay from the ledger finishes it.
      await probe.worker.pass();
      expect(probe.crash.at).toBeUndefined();
      const receipt = await probe.inTenant((unit) => unit.receipts.get(commandId));
      expect(receipt?.status).toBe('completed');
      expect((await probe.rowsOf('probe.person')).map((row) => row.id)).toEqual([ids.beaId]);
      const events = await erasedEvents(probe);
      expect(events.length).toBe(3);
      expect((await probe.rowsOf('probe.thread'))[0]?.reply).toBeUndefined();
    });
  }
});

describe('a sink that refuses the erasure record fails the attempt of the job, which runs again', () => {
  test('one erasure completes; the record appended twice is tolerated', {
    timeout: 120_000,
  }, async () => {
    const recorded: LedgerRecord[] = [];
    let refused = 0;
    const sink: LedgerSink = {
      id: 'flaky',
      append: async (records) => {
        if (refused === 0 && records.some((record) => record.type === 'erasure')) {
          refused += 1;
          throw new Error('the sink is full');
        }
        recorded.push(...records);
      },
      // Read from memory: the union sees what the sink took.
      read: async function* () {
        yield* recorded;
      },
    };
    probe = await bootProbe('pglite', { ledgers: [sink] });
    const ids = await seed(probe);
    const { commandId } = await probe.eraseAsOperator(ids.adaId);
    await probe.runtime.drainJobs();
    // The control copy was appended before the sink refused: the record is in the ledger twice at most.
    expect(refused).toBe(1);
    await probe.runtime.advanceTo(Temporal.Now.instant().add({ hours: 1 }));
    await probe.runtime.drainJobs();
    await probe.worker.pass();
    const receipt = await probe.inTenant((unit) => unit.receipts.get(commandId));
    expect(receipt?.status).toBe('completed');
    expect((await erasedEvents(probe)).length).toBe(3);
    const ledger = await probe.runtime.control.adapter.unit(
      probe.runtime.control.namespace,
      { level: 'deployment' },
      (unit) => unit.ledger?.since(0n, 100) ?? Promise.resolve([]),
      { readOnly: true },
    );
    const erasures = ledger.filter((entry) => entry.record.type === 'erasure');
    expect(erasures.length).toBeGreaterThanOrEqual(1);
    // The retry finds its record in the control ledger and only completes the job; the erasure run
    // then sends the record to the sink that refused the first append, so it holds exactly one.
    expect(recorded.filter((record) => record.type === 'erasure')).toHaveLength(1);
    expect(recorded.filter((record) => record.type === 'erasureCompleted')).toHaveLength(0);
  });
});

describe('a write for the subject after the shred cannot bring a value back', () => {
  test('sealing under the destroyed key is forbidden and leaves no value', {
    timeout: 60_000,
  }, async () => {
    probe = await bootProbe();
    const ids = await seed(probe);
    await probe.eraseAsOperator(ids.adaId);
    await finish(probe);
    const answer = probe.invokeAs.attempt('probe.answer', {
      threadId: ids.beaThreadId as never,
      replierId: ids.adaId as never,
      reply: 'a value that must not come back marker',
    });
    const outcome = await answer;
    expect(outcome.ok).toBe(false);
    expect((await probe.rowsOf('probe.thread'))[0]?.reply).toBeUndefined();
  });
});
