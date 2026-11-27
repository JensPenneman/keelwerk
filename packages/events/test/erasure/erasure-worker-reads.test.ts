import { createControlLedger } from '@keelwerk/core';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { erasedEvents, finish, seed } from './support/erasure-helpers.ts';
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

describe('what the worker reads of the ledgers (14.7.5, 14.7.6)', () => {
  test('the start pass reads only the unfinished erasures: a completed one is not looked at, and no sink is read', async () => {
    const booted = await finishedErasure();
    const second = await booted.startWorker({ ledger: { sinksUnreadable: true } });
    // One read of the unfinished records, which answered none: nothing was looked up or run.
    expect(second.reads.unfinished).toBe(1);
    expect(second.reads.finds).toBe(0);
    expect(second.reads.sinkReads).toBe(0);
    expect(second.steps).toEqual([]);
  });

  test('a completion at the old epoch does not finish an erasure after a bump', async () => {
    const booted = await finishedErasure();
    await booted.bumpEpoch();
    const second = await booted.startWorker();
    expect(second.reads.unfinished).toBe(1);
    expect(second.steps).toContain('shred');
    expect(second.steps.at(-1)).toBe('completed');
    // A third start finds the completion at the new epoch and runs nothing.
    const third = await booted.startWorker();
    expect(third.steps).toEqual([]);
  });

  test('the poll starts at the head the start pass read, never again at 0', async () => {
    const booted = await finishedErasure();
    const second = await booted.startWorker({ pollMs: 5, ledger: { limit: 1 } });
    const afterStart = second.reads.after.length;
    await vi.waitFor(() => expect(second.reads.empty).toBeGreaterThan(1));
    await second.worker.stop(farOff());
    const head = second.reads.after[afterStart] ?? 0n;
    expect(head).toBeGreaterThan(0n);
    expect(second.reads.after.slice(afterStart).every((after) => after >= head)).toBe(true);
    expect(second.steps).toEqual([]);
  });

  test('a start pass that failed on the ledger runs nothing and leaves the poll from the start of the ledger', async () => {
    const booted = await finishedErasure();
    // The first read of the pass fails: no head is known, the poll walks the ledger from 0, finds
    // the record, asks for its completions and finds one at the current epoch.
    const second = await booted.startWorker({ pollMs: 5, ledger: { failRead: 1 } });
    await vi.waitFor(() => expect(second.reads.empty).toBeGreaterThan(0));
    await second.worker.stop(farOff());
    expect(second.reads.after[1]).toBe(0n);
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

  test('a second copy of the record, appended after the erasure completed, does not run it again', async () => {
    const booted = await finishedErasure();
    const ledger = createControlLedger(
      booted.runtime.control.adapter,
      booted.runtime.control.namespace,
    );
    const first = (await ledger.since(0n, 1000)).find(({ record }) => record.type === 'erasure');
    if (first === undefined) throw new Error('no erasure record');
    // An attempt that outlived its lease appends the record again, after the completion.
    await ledger.append(first.record);
    const second = await booted.startWorker();
    expect(second.steps).toEqual([]);
    expect(second.reads.finds).toBeGreaterThan(0);
  });

  test('a bump leaves one erased event per stream: the rerun adds none', async () => {
    const booted = await finishedErasure();
    const before = (await erasedEvents(booted)).length;
    await booted.bumpEpoch();
    await booted.startWorker();
    expect((await erasedEvents(booted)).length).toBe(before);
  });
});
