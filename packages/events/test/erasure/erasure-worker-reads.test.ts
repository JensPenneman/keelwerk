import { afterEach, describe, expect, test, vi } from 'vitest';
import { finish, seed } from './support/erasure-helpers.ts';
import { bootProbe, type Probe } from './support/erasure-kit.ts';

let probe: Probe | undefined;
afterEach(async () => {
  await probe?.runtime.stop();
  probe = undefined;
});

/** A runtime whose one erasure is finished: the control ledger holds its record, a tombstone and its completion. */
async function finishedErasure(): Promise<Probe> {
  const booted = await bootProbe('memory');
  probe = booted;
  const ids = await seed(booted);
  await booted.eraseAsOperator(ids.adaId);
  await finish(booted);
  return booted;
}

const farOff = () => Temporal.Now.instant().add({ hours: 1 });

describe('what the worker reads of the ledgers after its start pass (14.7.5)', () => {
  test('a sink that cannot be read at the start does not send the poll back to the head of the ledger', async () => {
    const booted = await finishedErasure();
    const second = await booted.startWorker({
      pollMs: 5,
      ledger: { limit: 1, sinksUnreadable: true },
    });
    const afterStart = second.reads.after.length;
    await vi.waitFor(() => expect(second.reads.empty).toBeGreaterThan(1));
    await second.worker.stop(farOff());
    // The last read of the start pass found nothing after the head.
    const head = second.reads.after[afterStart - 1] ?? 0n;
    expect(head).toBeGreaterThan(0n);
    // Every poll read starts at the head the start pass found, never again at 0.
    expect(second.reads.after.slice(afterStart).every((after) => after >= head)).toBe(true);
    expect(second.steps).toEqual([]);
  });

  test('a start pass that failed after it read the completions leaves the poll no erasure to run again', async () => {
    const booted = await finishedErasure();
    // The record, the tombstone and the completion are three pages of one record; the fourth read fails.
    const second = await booted.startWorker({ pollMs: 5, ledger: { limit: 1, failRead: 4 } });
    await vi.waitFor(() => expect(second.reads.empty).toBeGreaterThan(1));
    await second.worker.stop(farOff());
    // The poll walked the ledger from its start, and the record and its completion were on
    // different pages of it: the completion the pass had read still counted.
    expect(second.reads.after[4]).toBe(0n);
    expect(second.steps).toEqual([]);
  });

  test('a start pass that failed on the ledger leaves the poll no erasure whose completion lies on a later page', async () => {
    const booted = await finishedErasure();
    // The record and its completion are on different pages; the second read of the pass fails, so
    // the poll walks the ledger from its start and must read every page before it finishes a record.
    const second = await booted.startWorker({ pollMs: 5, ledger: { limit: 1, failRead: 2 } });
    await vi.waitFor(() => expect(second.reads.empty).toBeGreaterThan(1));
    await second.worker.stop(farOff());
    expect(second.reads.after[2]).toBe(0n);
    expect(second.steps).toEqual([]);
  });

  test('an erasure in retry whose completion another process appended is not run again', async () => {
    probe = await bootProbe('memory');
    const ids = await seed(probe);
    await probe.eraseAsOperator(ids.adaId);
    await probe.runtime.drainJobs();
    // The worker's streams step fails on a transient error: the erasure goes into its retry.
    const second = await probe.startWorker({ pollMs: 5, failOnce: 'streams' });
    expect(second.steps).not.toContain('completed');
    const before = [...second.steps];
    // Another process runs the erasure to the end and appends its completion to the control ledger.
    await probe.worker.pass();
    const emptyBefore = second.reads.empty;
    // The first poll reads the completion and finishes the retry; the second empty read proves it ran.
    await vi.waitFor(() => expect(second.reads.empty).toBeGreaterThan(emptyBefore + 1));
    await second.worker.stop(farOff());
    expect(second.steps).toEqual(before);
  });
});
