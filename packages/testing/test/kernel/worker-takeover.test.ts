import type { Principal, SubjectId } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { afterAll, describe, expect, test } from 'vitest';
import { conformanceApp } from '../../src/fixtures/index.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { acmeScope, askCloseAll, jobOf, lendBook, startWatched } from './support/worker-kit.ts';

const olive = { resolver: 'test.principal', principalId: 'olive' } as const;
const input = { borrower: 'bea' };

/** The principal `swap.keys` answers for any reference: someone else than the reference names. */
function other(scope: { readonly backend: string | null; readonly tenant: string | null }) {
  const principal: Principal = {
    kind: 'user',
    subject: 'mallory' as SubjectId,
    subjectRef: null,
    subjectAs: () => null,
    scope,
    claims: {},
    roles: [],
    memberships: [],
    via: 'swap.keys',
    ref: { resolver: 'swap.keys', principalId: 'mallory' },
  };
  return principal;
}

/** The conformance app with a resolver whose `fromRef` answers another principal. */
const swapped: typeof conformanceApp = {
  ...conformanceApp,
  registry: {
    ...conformanceApp.registry,
    fills: new Map([
      ...conformanceApp.registry.fills,
      [
        'core.principalResolvers',
        [
          ...(conformanceApp.registry.fills.get('core.principalResolvers') ?? []),
          {
            point: 'core.principalResolvers',
            module: 'core',
            bound: false,
            fill: {
              id: 'swap.keys',
              describe: () => ({ scheme: 'apiKey' }),
              // biome-ignore lint/correctness/useYield: a resolver is a generator by contract; this one asks for nothing
              *resolve() {
                return null;
              },
              // biome-ignore lint/correctness/useYield: a resolver is a generator by contract; this one asks for nothing
              *fromRef(_ref: unknown, ctx: { readonly scope: { readonly level: string } }) {
                const scope = ctx.scope as {
                  readonly level: string;
                  readonly backendId?: string;
                  readonly tenantId?: string;
                };
                return {
                  principal: other({
                    backend: scope.backendId ?? null,
                    tenant: scope.tenantId ?? null,
                  }),
                };
              },
            },
          },
        ],
      ],
    ]),
  },
};

// Only a queue nobody else names is worked: the commands an accepted request enqueues wait, and
// each job of these tests is put in `held` by hand, in the order the test needs.
const { runtime, spy } = await startWatched({ workers: { queues: ['held'] }, app: swapped });
afterAll(() => runtime.stop());

async function enqueue(over: Omit<Parameters<typeof jobOf>[1], 'queue'>) {
  await runtime.adapter.unit(runtime.namespace, acmeScope(runtime), (unit) =>
    unit.jobs.enqueue(jobOf(runtime, { queue: 'held', ...over })),
  );
}

async function receiptOf(commandId: string) {
  return runtime.adapter.unit(runtime.namespace, acmeScope(runtime), (unit) =>
    unit.receipts.get(commandId),
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

describe("a job takes over only its own submitter's accepted receipt", () => {
  test('a job that names another principal’s command id neither takes nor fails its receipt, and the owner’s job still completes it', async () => {
    await lendBook(runtime, 'Dune');
    // The thief's principal must resolve, or the job would fail before it reaches the receipt.
    await askCloseAll(runtime, 'tk-thief', testOperator('mallory'));
    expect((await askCloseAll(runtime, 'tk-1', testOperator('olive'))).ok).toBe(true);
    expect((await receiptOf('tk-1'))?.status).toBe('accepted');

    // A job of another principal, named after the accepted command: refused at the receipt.
    spy.completions.length = 0;
    await enqueue({
      run: { action: 'loans.closeAll', input, commandId: 'tk-1' },
      principal: { resolver: 'test.principal', principalId: 'mallory' },
      causation: { commandId: 'somebody-elses-decision' },
    });
    // A job of another principal that fails before it runs: it gives up and fails nothing of tk-1.
    await enqueue({
      run: { action: 'loans.closeAll', input, commandId: 'tk-1' },
      principal: { resolver: 'ghost.resolver', principalId: 'nobody' },
      causation: { commandId: 'tk-1' },
    });
    // The submitter's own principal, but a job that is not the accepted one (an enqueue names the
    // deciding command as its cause): its failure leaves the receipt alone too.
    await enqueue({
      run: { action: 'loans.closeAll', input: {}, commandId: 'tk-1' },
      principal: olive,
      causation: { commandId: 'a-decision' },
    });
    expect(await runtime.drainJobs()).toBe(3);
    expect(outcomes().map((outcome) => outcome.kind)).toEqual(['failed', 'failed', 'failed']);
    expect(outcomes()).toContainEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'core.idempotency_mismatch' }),
      }),
    );
    expect((await receiptOf('tk-1'))?.status).toBe('accepted');
    expect(await openLoans()).toBe(1);

    spy.completions.length = 0;
    await enqueue({
      run: { action: 'loans.closeAll', input, commandId: 'tk-1' },
      principal: olive,
      causation: { commandId: 'tk-1' },
    });
    expect(await runtime.drainJobs()).toBe(1);
    expect(outcomes()).toEqual([{ kind: 'succeeded' }]);
    expect(await receiptOf('tk-1')).toMatchObject({
      status: 'completed',
      principalId: 'olive',
      outcome: { ok: true },
    });
    expect(await openLoans()).toBe(0);
  });
});

describe('a handler that throws leaves a failed receipt its submitter can read', () => {
  test('the job completes failed and so does the receipt', async () => {
    await askCloseAll(runtime, 'th-1', testOperator('olive'));
    expect((await receiptOf('th-1'))?.status).toBe('accepted');
    runtime.revoke('olive');
    // The give-up unit of the job fails once, after it completed the receipt: the handler rejects.
    let crashed = false;
    spy.afterReceiptComplete = () => {
      if (crashed) return;
      crashed = true;
      throw errors.conflict('the give-up unit went down');
    };
    spy.completions.length = 0;
    await enqueue({
      run: { action: 'loans.closeAll', input, commandId: 'th-1' },
      principal: olive,
      causation: { commandId: 'th-1' },
    });
    expect(await runtime.drainJobs()).toBe(1);
    spy.afterReceiptComplete = undefined;
    expect(crashed).toBe(true);
    expect(outcomes().map((outcome) => outcome.kind)).toEqual(['failed']);
    expect(await receiptOf('th-1')).toMatchObject({
      status: 'failed',
      outcome: { ok: false, error: { kind: 'conflict' } },
    });
  });
});

describe('the principal a resolver answers is the one the job stored (S-122)', () => {
  test('a resolver that answers another principal fails the job unauthenticated and runs nothing', async () => {
    await lendBook(runtime, 'Emma');
    const before = await openLoans();
    spy.completions.length = 0;
    await enqueue({
      run: { action: 'loans.closeAll', input, commandId: 'sw-1' },
      principal: { resolver: 'swap.keys', principalId: 'ada' },
    });
    expect(await runtime.drainJobs()).toBe(1);
    expect(outcomes()).toEqual([
      expect.objectContaining({
        kind: 'failed',
        error: expect.objectContaining({ kind: 'unauthenticated' }),
      }),
    ]);
    expect(await openLoans()).toBe(before);
    expect(await receiptOf('sw-1')).toBeUndefined();
  });
});
