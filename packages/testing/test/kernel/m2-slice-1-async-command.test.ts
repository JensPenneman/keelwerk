import type { Scope } from '@keelwerk/core';
import { commandReceiptId, commandReceiptUuid } from '@keelwerk/core';
import { afterAll, describe, expect, test } from 'vitest';
import { conformanceApp } from '../../src/fixtures/index.ts';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import type { TestPrincipal } from '../../src/harness/test-principal.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';

const runtime = await startTestRuntime(conformanceApp, { operators: true, workers: true });
afterAll(() => runtime.stop());

const operator = testOperator('olive');
const bea = createLocalClient(runtime, { principal: testPrincipal('bea') });
const { acme } = runtime.tenants;
const tenantScope: Scope = { level: 'tenant', backendId: runtime.backendId, tenantId: acme.id };

async function lendBook(title: string): Promise<void> {
  await bea.invoke('loans.lend', {
    bookTitle: title,
    dueAt: Temporal.Instant.from('2027-01-01T00:00:00Z'),
  });
}

/** The receipt of a command as the owner of the command reads it: through `core.commandReceipt.get`. */
async function receiptOf(commandId: string, as = operator) {
  const outcome = await runtime.invoker.invoke<unknown, unknown>({
    action: 'core.commandReceipt.get',
    input: { ids: [commandReceiptUuid(acme.id, commandId)] },
    carrier: testCarrier(acme, as),
    requestId: crypto.randomUUID(),
    signal: new AbortController().signal,
  });
  if (!outcome.ok) throw outcome.error;
  return (outcome.value as { list: readonly Record<string, unknown>[] }).list[0];
}

/** Asks the operator's `loans.closeAll` to run asynchronously: the answer is the accepted receipt. */
function askCloseAll(commandId: string, as: TestPrincipal) {
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

async function openLoans(): Promise<number> {
  const rows = await runtime.adapter.unit(runtime.namespace, tenantScope, async (unit) => {
    const entry = conformanceApp.registry.entities.get('loans.loan');
    if (entry === undefined) throw new Error('no loans.loan');
    return (await unit.rows.find(entry.descriptor, {})).rows;
  });
  return rows.filter((row) => row.state === 'open').length;
}

describe('SLICE M2-1: an async command runs in a worker of the test runtime', () => {
  test('accepted, taken, run as the re-resolved principal and completed with its value', async () => {
    await lendBook('Dune');
    await lendBook('Emma');
    const accepted = await askCloseAll('close-1', operator);
    expect(accepted).toMatchObject({
      ok: true,
      receipt: { commandId: 'close-1', status: 'accepted' },
      receiptId: commandReceiptId(acme.id, 'close-1'),
    });

    expect(await runtime.drainJobs()).toBe(1);

    expect(await receiptOf('close-1')).toMatchObject({
      status: 'completed',
      outcome: { ok: true, value: { closed: 2 } },
    });
    expect(await openLoans()).toBe(0);
    const events = await runtime.adapter.unit(runtime.namespace, tenantScope, (unit) =>
      unit.events.readAll(null, { limit: 100 }),
    );
    const closed = events.events.filter((event) => event.type === 'loans.loan.changed');
    expect(closed).toHaveLength(2);
    expect(
      closed.every((event) => event.actor.id === 'olive' && event.actor.via === 'test.principal'),
    ).toBe(true);
    expect(closed.every((event) => event.commandId === 'close-1')).toBe(true);
  });

  test('a principal revoked before the drain fails the job closed: unauthenticated, nothing ran', async () => {
    await lendBook('Ulysses');
    const second = testOperator('pat');
    await askCloseAll('close-2', second);
    runtime.revoke('pat');
    expect(await runtime.drainJobs()).toBe(1);
    const receipt = await receiptOf('close-2', second);
    expect(receipt).toMatchObject({
      status: 'failed',
      outcome: { ok: false, error: { kind: 'unauthenticated' } },
    });
    expect(await openLoans()).toBe(1);
    expect(await runtime.drainJobs()).toBe(0);
  });
});
