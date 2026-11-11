import { errors } from '@keelwerk/core';
import { afterAll, describe, expect, test } from 'vitest';
import { acmeScope, askCloseAll, lendBook, startWatched, statsOf } from './support/worker-kit.ts';

const { runtime, spy } = await startWatched({ workers: true });
afterAll(() => runtime.stop());

const lease = 31;

async function openLoans(): Promise<number> {
  return runtime.adapter.unit(runtime.namespace, acmeScope(runtime), async (unit) => {
    const entry = runtime.app.registry.entities.get('loans.loan');
    if (entry === undefined) throw new Error('no loans.loan');
    return (await unit.rows.find(entry.descriptor, {})).rows.filter((row) => row.state === 'open')
      .length;
  });
}

async function receiptStatus(commandId: string): Promise<string | undefined> {
  return runtime.adapter.unit(runtime.namespace, acmeScope(runtime), async (unit) => {
    const receipt = await unit.receipts.get(commandId);
    return receipt?.status;
  });
}

async function closedBy(commandId: string): Promise<number> {
  const page = await runtime.adapter.unit(runtime.namespace, acmeScope(runtime), (unit) =>
    unit.events.readAll(null, { limit: 1000 }),
  );
  return page.events.filter(
    (event) => event.type === 'loans.loan.changed' && event.commandId === commandId,
  ).length;
}

describe('the receipt, the command and the job complete in one unit', () => {
  test('a completion that finds the lease lost rolls the whole unit back, and the next attempt runs once', async () => {
    await lendBook(runtime, 'Dune');
    spy.completions.length = 0;
    let refused = false;
    spy.complete = () => {
      if (refused) return undefined;
      refused = true;
      return false;
    };
    const t0 = runtime.clock.now();
    await askCloseAll(runtime, 'u-1');
    expect(await runtime.drainJobs()).toBe(1);
    expect(spy.completions.map((entry) => entry.granted)).toEqual([false]);
    expect(await openLoans()).toBe(1);
    expect(await receiptStatus('u-1')).toBe('accepted');
    expect(await closedBy('u-1')).toBe(0);
    // The store never finished the attempt: it stays running until the lease runs out.
    expect((await statsOf(runtime, 'commands'))?.running).toBe(1);
    expect(await runtime.advanceTo(t0.add({ seconds: lease }))).toBe(1);
    expect(spy.completions.map((entry) => [entry.attempt.attempt, entry.granted])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(await openLoans()).toBe(0);
    expect(await receiptStatus('u-1')).toBe('completed');
    expect(await closedBy('u-1')).toBe(1);
    spy.complete = undefined;
  });

  test('a failure after the receipt was completed commits neither the receipt nor the job', async () => {
    await lendBook(runtime, 'Emma');
    spy.completions.length = 0;
    let crashed = false;
    spy.afterReceiptComplete = () => {
      if (crashed) return;
      crashed = true;
      throw errors.unavailable('the process went down between the receipt and the commit');
    };
    const t0 = runtime.clock.now();
    await askCloseAll(runtime, 'u-2');
    expect(await runtime.drainJobs()).toBe(1);
    expect(await receiptStatus('u-2')).toBe('accepted');
    expect(await openLoans()).toBe(1);
    expect(await closedBy('u-2')).toBe(0);
    expect(spy.completions.filter((entry) => entry.outcome.kind === 'succeeded')).toEqual([]);
    // The retry is scheduled within one second; it then runs once and commits everything together.
    expect(await runtime.advanceTo(t0.add({ seconds: 2 }))).toBe(1);
    expect(await receiptStatus('u-2')).toBe('completed');
    expect(await closedBy('u-2')).toBe(1);
    spy.afterReceiptComplete = undefined;
  });
});
