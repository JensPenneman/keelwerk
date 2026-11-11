import type { RuleEntry } from '@keelwerk/core';
import { afterAll, describe, expect, test } from 'vitest';
import { conformanceApp } from '../../src/fixtures/index.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { acmeScope, askCloseAll, jobOf, lendBook, startWatched } from './support/worker-kit.ts';

const olive = { resolver: 'test.principal', principalId: 'olive' } as const;
const input = { borrower: 'bea' };

/** The conformance app with a deny rule on a transport no test uses (the tests' own is `test`). */
const guarded: typeof conformanceApp = {
  ...conformanceApp,
  registry: {
    ...conformanceApp.registry,
    rules: new Map<string, RuleEntry>([
      ...conformanceApp.registry.rules,
      [
        'loans.noOtherTransport',
        {
          id: 'loans.noOtherTransport',
          module: 'loans',
          effect: 'deny',
          subject: { kinds: ['command'], transports: ['other'] },
          actions: ['loans.closeAll'],
          reason: 'Not over the other transport.',
          disabled: false,
        },
      ],
    ]),
  },
};

// Only a queue nobody else names is worked: each job is put in `held` by hand.
const { runtime, spy } = await startWatched({ workers: { queues: ['held'] }, app: guarded });
afterAll(() => runtime.stop());

async function enqueue(over: Omit<Parameters<typeof jobOf>[1], 'queue'>) {
  await runtime.adapter.unit(runtime.namespace, acmeScope(runtime), (unit) =>
    unit.jobs.enqueue(jobOf(runtime, { queue: 'held', ...over })),
  );
}

async function receiptStatus(commandId: string) {
  return runtime.adapter.unit(
    runtime.namespace,
    acmeScope(runtime),
    async (unit) => (await unit.receipts.get(commandId))?.status,
  );
}

async function openLoans(): Promise<number> {
  return runtime.adapter.unit(runtime.namespace, acmeScope(runtime), async (unit) => {
    const entry = runtime.app.registry.entities.get('loans.loan');
    if (entry === undefined) throw new Error('no loans.loan');
    return (await unit.rows.find(entry.descriptor, {})).rows.filter((row) => row.state === 'open')
      .length;
  });
}

const outcomes = () => spy.completions.map((entry) => entry.outcome);

describe('a job is gated under the transport of its receipt, else an unknown one', () => {
  test('a job with no receipt of its own meets a deny rule on a transport, as an invoke does', async () => {
    // Olive's principal must resolve again, so the request is made once.
    await askCloseAll(runtime, 'tr-0', testOperator('olive'));
    const before = await openLoans();
    spy.completions.length = 0;
    await enqueue({
      run: { action: 'loans.closeAll', input, commandId: 'tr-1' },
      principal: olive,
      causation: { commandId: 'a-decision' },
    });
    expect(await runtime.drainJobs()).toBe(1);
    expect(outcomes()).toEqual([
      expect.objectContaining({
        kind: 'failed',
        error: expect.objectContaining({ kind: 'forbidden' }),
      }),
    ]);
    expect(await openLoans()).toBe(before);
  });

  test('an accepted command is gated as at acceptance: by the transport its receipt records', async () => {
    await lendBook(runtime, 'Ulysses');
    await askCloseAll(runtime, 'tr-2', testOperator('olive'));
    spy.completions.length = 0;
    await enqueue({
      run: { action: 'loans.closeAll', input, commandId: 'tr-2' },
      principal: olive,
      causation: { commandId: 'tr-2' },
    });
    expect(await runtime.drainJobs()).toBe(1);
    expect(outcomes()).toEqual([{ kind: 'succeeded' }]);
    expect(await receiptStatus('tr-2')).toBe('completed');
  });
});
