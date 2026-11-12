import type { LiveFrame } from '@keelwerk/core';
import { commandReceiptUuid, defineApp } from '@keelwerk/core';
import {
  createLocalClient,
  startTestRuntime,
  testCarrier,
  testOperator,
  testPrincipal,
} from '@keelwerk/testing';
import { library, loans } from '@keelwerk/testing/fixtures';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { live } from '../../src/live-module.ts';
import { attachPokes, pokes, pokesNaming } from '../support/attach-pokes.ts';
import { collectFrames } from '../support/collect-frames.ts';

vi.setConfig({ testTimeout: 60_000 });

const app = defineApp({ id: 'receipts', modules: [live, library, loans] });
const runtime = await startTestRuntime(app, { operators: true, workers: true });
afterAll(() => runtime.stop());

const { acme } = runtime.tenants;
const olive = testOperator('olive');
const operator = createLocalClient(runtime, { principal: olive });
const bea = createLocalClient(runtime, { principal: testPrincipal('bea') });

type Receipt = { readonly row?: { readonly status?: string; readonly outcome?: unknown } };
const itemsOf = (frames: readonly LiveFrame<unknown>[]): { readonly id?: string }[] =>
  frames.flatMap((frame) => ('event' in frame ? [frame.event as { readonly id?: string }] : []));
const statuses = (frames: readonly LiveFrame<unknown>[]): (string | undefined)[] =>
  frames.flatMap((frame) => ('event' in frame ? [(frame.event as Receipt).row?.status] : []));

function askCloseAll(commandId: string, as = olive) {
  return runtime.invoker.invoke({
    action: 'loans.closeAll',
    input: { borrower: 'bea' },
    carrier: testCarrier(acme, as),
    requestId: crypto.randomUUID(),
    commandId,
    prefer: 'async',
    signal: new AbortController().signal,
  });
}

const beaCarrier = testCarrier(acme, testPrincipal('bea'));

/** Lends a book as bea in the background: the command is accepted and a worker completes it later. */
function askLend(commandId: string) {
  return runtime.invoker.invoke({
    action: 'loans.lend',
    input: {
      bookTitle: `Book ${commandId}`,
      dueAt: Temporal.Instant.from('2027-01-01T00:00:00Z'),
    },
    carrier: beaCarrier,
    requestId: crypto.randomUUID(),
    commandId,
    prefer: 'async',
    signal: new AbortController().signal,
  });
}

const receiptStream = (commandId: string, as = operator) =>
  collectFrames(
    as.subscribe('core.commandReceipt.watch', {
      ids: [commandReceiptUuid(acme.id, commandId)],
      from: 'beginning',
    } as never),
  );

describe('core.commandReceipt.watch', () => {
  test('an asynchronous command reaches completed after drainJobs', async () => {
    const commandId = `watch-${crypto.randomUUID()}`;
    await askCloseAll(commandId);
    const stream = receiptStream(commandId);
    try {
      await stream.ready();
      expect(statuses(stream.frames)).toEqual(['accepted']);
      expect(await runtime.drainJobs()).toBeGreaterThanOrEqual(1);
      await stream.until((frames) => statuses(frames).includes('completed'));
      expect(statuses(stream.frames).at(-1)).toBe('completed');
    } finally {
      await stream.stop();
    }
  });

  test('a command that fails in the worker reaches failed', async () => {
    const commandId = `fail-${crypto.randomUUID()}`;
    const second = testOperator('pat');
    // The receipt id follows from the command id, so the submitter can follow it before it exists.
    // Its own stream is not revalidated before the worker runs.
    const stream = receiptStream(commandId, createLocalClient(runtime, { principal: second }));
    try {
      await stream.ready();
      await askCloseAll(commandId, second);
      runtime.revoke('pat');
      await runtime.drainJobs();
      await stream.until((frames) => statuses(frames).includes('failed'));
      const last = stream.frames.flatMap((frame) => ('event' in frame ? [frame.event] : [])).at(-1);
      expect(last).toMatchObject({
        row: { status: 'failed', outcome: { ok: false, error: { kind: 'unauthenticated' } } },
      });
    } finally {
      await stream.stop();
    }
  });

  test('another principal sees no item of the receipt', async () => {
    const commandId = `private-${crypto.randomUUID()}`;
    const markerId = `marker-${crypto.randomUUID()}`;
    // Bea follows the receipt of the operator and one of her own, which is written after it.
    const other = collectFrames(
      bea.subscribe('core.commandReceipt.watch', {
        ids: [commandReceiptUuid(acme.id, commandId), commandReceiptUuid(acme.id, markerId)],
        from: 'beginning',
      } as never),
    );
    const owner = receiptStream(commandId);
    try {
      await other.ready();
      await owner.ready();
      await askCloseAll(commandId);
      await runtime.drainJobs();
      await askLend(markerId);
      await runtime.drainJobs();
      await owner.until((frames) => statuses(frames).includes('completed'));
      await other.until((frames) => statuses(frames).includes('completed'));
      // Her own receipt came after the operator's: nothing of the operator's came before it.
      const marker = commandReceiptUuid(acme.id, markerId);
      expect(itemsOf(other.frames).every((item) => item.id === marker)).toBe(true);
    } finally {
      await other.stop();
      await owner.stop();
    }
  });

  test('the submitter watches its own receipt', async () => {
    const commandId = `own-${crypto.randomUUID()}`;
    await askLend(commandId);
    const stream = collectFrames(
      bea.subscribe('core.commandReceipt.watch', {
        ids: [commandReceiptUuid(acme.id, commandId)],
        from: 'beginning',
      } as never),
    );
    try {
      await stream.ready();
      expect(statuses(stream.frames)).toEqual(['accepted']);
    } finally {
      await stream.stop();
    }
  });

  test('the receipts of a submitter are followed by id and never listed', async () => {
    await askLend(`listed-${crypto.randomUUID()}`);
    const stream = collectFrames(
      bea.subscribe('core.commandReceipt.watch', { from: 'beginning' } as never),
    );
    await expect(stream.until(() => false, 5000)).rejects.toThrow(/core.validation/);
    expect(stream.failure()).toMatchObject({ kind: 'validation' });
  });

  test("the receipts of other users' commands are never poked", async () => {
    const stream = collectFrames(bea.subscribe('live.pokes' as never, {} as never));
    const lendAndRun = async () => {
      await askLend(`poked-${crypto.randomUUID()}`);
      await runtime.drainJobs();
    };
    try {
      // Bea is poked for her loans only; every receipt written on the way is written in her scope too.
      const base = await attachPokes(stream, 'loans.loan', lendAndRun);
      await askCloseAll(`others-${crypto.randomUUID()}`);
      await runtime.drainJobs();
      await lendAndRun();
      await stream.until((frames) => pokesNaming(frames, 'loans.loan').length > base);
      const types = pokes(stream.frames).flatMap((poke) => Object.keys(poke.changed));
      expect(types).toContain('loans.loan');
      expect(types).not.toContain('core.commandReceipt');
    } finally {
      await stream.stop();
    }
  });

  test('core.effect.watch is registered once live is selected and refused forbidden without a rule', async () => {
    expect(app.registry.actions.get('core.effect.watch')).toMatchObject({ kind: 'subscription' });
    const stream = collectFrames(
      bea.subscribe('core.effect.watch', { from: 'beginning' } as never),
    );
    await expect(stream.until(() => false, 5000)).rejects.toThrow(/forbidden/);
    expect(stream.failure()).toMatchObject({ kind: 'forbidden' });
  });
});
