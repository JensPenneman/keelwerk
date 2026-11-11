import { afterAll, describe, expect, test } from 'vitest';
import { conformanceApp } from '../../src/fixtures/index.ts';
import { acmeScope, jobOf, lines, startWatched, statsOf } from './support/worker-kit.ts';

/** The conformance app with a principal resolver that cannot re-resolve its references: it has no `fromRef`. */
const bare: typeof conformanceApp = {
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
              id: 'bare.keys',
              describe: () => ({ scheme: 'apiKey' }),
              // biome-ignore lint/correctness/useYield: a resolver is a generator by contract; this one asks for nothing
              *resolve() {
                return null;
              },
            },
          },
        ],
      ],
    ]),
  },
};

const log = lines();
const { runtime, spy } = await startWatched({ workers: true, app: bare, logger: log.logger });
afterAll(() => runtime.stop());

async function enqueue(over: Parameters<typeof jobOf>[1]) {
  await runtime.adapter.unit(runtime.namespace, acmeScope(runtime), (unit) =>
    unit.jobs.enqueue(jobOf(runtime, over)),
  );
}

describe('the principal of a job is re-resolved when it runs (S-122)', () => {
  test('a reference no resolver can re-resolve fails unauthenticated at attempt 1, without a retry', async () => {
    await enqueue({
      queue: 'commands',
      run: { action: 'loans.closeAll', input: { borrower: 'bea' }, commandId: 'p-2' },
      principal: { resolver: 'ghost.resolver', principalId: 'nobody' },
    });
    expect(await runtime.drainJobs()).toBeGreaterThanOrEqual(1);
    const failed = spy.completions.filter((entry) => entry.outcome.kind === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.attempt.attempt).toBe(1);
    expect(failed[0]?.outcome).toMatchObject({ error: { kind: 'unauthenticated' } });
    expect((await statsOf(runtime, 'commands'))?.nextDueAt).toBeNull();
  });

  test('a resolver without fromRef cannot re-resolve its references either', async () => {
    spy.completions.length = 0;
    await enqueue({
      queue: 'commands',
      run: { action: 'loans.closeAll', input: { borrower: 'bea' }, commandId: 'p-3' },
      principal: { resolver: 'bare.keys', principalId: 'key-1' },
    });
    await runtime.drainJobs();
    expect(spy.completions).toHaveLength(1);
    expect(spy.completions[0]?.outcome).toMatchObject({
      kind: 'failed',
      error: { kind: 'unauthenticated' },
    });
    expect(spy.completions[0]?.attempt.attempt).toBe(1);
    expect(log.warnings).toContainEqual(expect.stringContaining("'bare.keys'"));
  });

  test('a job with a deadLetter ends dead, not failed', async () => {
    spy.completions.length = 0;
    await enqueue({
      queue: 'commands',
      run: { action: 'loans.closeAll', input: { borrower: 'bea' } },
      principal: { resolver: 'ghost.resolver', principalId: 'nobody' },
      deadLetter: 'commands-dead',
    });
    await runtime.drainJobs();
    expect(spy.completions.map((entry) => entry.outcome.kind)).toEqual(['dead']);
  });

  test('a core.module reference runs the module action as <module>.system', async () => {
    spy.completions.length = 0;
    await enqueue({
      queue: 'commands',
      run: { action: 'loans.openDesk', input: { desk: 'north' }, commandId: 'p-4' },
      principal: { resolver: 'core.module', principalId: 'loans.system' },
    });
    await runtime.drainJobs();
    expect(spy.completions.map((entry) => entry.outcome.kind)).toEqual(['succeeded']);
    const receipt = await runtime.adapter.unit(runtime.namespace, acmeScope(runtime), (unit) =>
      unit.receipts.get('p-4'),
    );
    expect(receipt).toMatchObject({
      status: 'completed',
      principalResolver: 'core.module',
      principalId: 'loans.system',
    });
  });
});
