import type { Logger } from '@keelwerk/core';
import { consumers, type ErasureOptions, erasure, reactionDispatcher } from '@keelwerk/events';
import { createLocalClient } from '../../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../../src/harness/test-operator.ts';
import { testPrincipal } from '../../../src/harness/test-principal.ts';
import type { TestRuntime } from '../../../src/harness/test-runtime.ts';
import { erasureDumpApp } from './erasure-probe-module.ts';

let current: TestRuntime<typeof erasureDumpApp> | undefined;

export const rulesMarkerEmail = 'rules.marker@example.test';
export const operatorCarrier = { transport: 'test', local: { inProcess: true } } as const;

/** Stops the runtime the last `bootErasureRules` started; the tests call it after each case. */
export async function stopBooted(): Promise<void> {
  await current?.stop();
  current = undefined;
}

/** A runtime of the probe app with the erasure worker, one person (the subject) and clients for an operator and a user. */
export async function bootErasureRules(
  adapter: 'memory' | 'pglite' = 'memory',
  options: {
    readonly frozenClock?: boolean;
    readonly app?: typeof erasureDumpApp;
    readonly logger?: Logger;
    /** The options of the erasure worker (the test seams of its steps). */
    readonly erasure?: ErasureOptions;
  } = {},
) {
  // A frozen clock keeps a job that waits for its retry waiting, however slow the machine is.
  const frozen = Temporal.Now.instant();
  const worker = erasure({ pollMs: 3_600_000, ...options.erasure });
  const runtime = await startTestRuntime(options.app ?? erasureDumpApp, {
    adapter,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.frozenClock === true ? { clock: { now: () => frozen } } : {}),
    operators: true,
    workers: true,
    eventWorkers: [
      consumers({ consumers: [reactionDispatcher()], runs: ['asyncReactions'] }),
      worker,
    ],
  });
  current = runtime;
  const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
  const user = createLocalClient(runtime, { principal: testPrincipal('ada'), tenant: 'acme' });
  const enrolled = await operator.invoke('probe.enrol', { name: 'Ada', email: rulesMarkerEmail });
  const subject = String((enrolled as { personId: string }).personId);
  return { runtime, worker, operator, user, subject };
}

/** The records of the control ledger. */
export const ledgerOf = (runtime: TestRuntime<typeof erasureDumpApp>) =>
  runtime.control.adapter.unit(
    runtime.control.namespace,
    { level: 'deployment' },
    (unit) => unit.ledger?.since(0n, 100) ?? Promise.resolve([]),
    { readOnly: true },
  );
