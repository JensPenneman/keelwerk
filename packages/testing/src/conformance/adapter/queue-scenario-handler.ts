import type { DataAdapter, Job, Scope, Unit } from '@keelwerk/core';
import { errors, isKeelwerkError } from '@keelwerk/core';
import { conformanceEntities } from '@keelwerk/data/conformance';
import type { ConformanceSubject } from './conformance-subject.ts';
import type { QueueScenarioRun } from './queue-scenario-run.ts';
import type { QueueScenarioStep } from './queue-scenario-step.ts';
import { rowAt } from './row-at.ts';

const { owner } = conformanceEntities;
const fence = new Error('the attempt was fenced');

const scopeIdOf = (scope: Scope): string => {
  switch (scope.level) {
    case 'tenant':
      return scope.tenantId;
    case 'backend':
      return scope.backendId;
    case 'deployment':
      return 'deployment';
  }
};

/** What the handlers of the workers of one kit share. */
export interface QueueScenarioHandlers {
  readonly subject: Pick<ConformanceSubject, 'namespace'>;
  /** Every attempt a handler began, in order. */
  readonly runs: QueueScenarioRun[];
  /** The handlers still running. */
  readonly handlers: Set<Promise<void>>;
  /** The gate of input `n`, which `hold` and `holdInUnit` steps wait at. */
  readonly gateOf: (n: number) => PromiseWithResolvers<void>;
  /** The scripted step of input `n` for its `attempt`th attempt. */
  readonly stepOf: (n: number, attempt: number) => QueueScenarioStep;
}

/**
 * The handler of a worker of the queue scenarios: one scripted attempt. It records the run, and
 * writes one `conf.owner` row named `<input>/<attempt>` in the unit that completes the attempt.
 */
export function queueScenarioHandler(
  { subject, runs, handlers, gateOf, stepOf }: QueueScenarioHandlers,
  workerId: string,
  adapter: DataAdapter,
): (job: Job) => Promise<void> {
  const attempt = async (job: Job): Promise<void> => {
    const { stored } = job;
    const input = 'input' in stored.run ? Number(stored.run.input) : -1;
    const number = stored.attempt.attempt;
    const run: QueueScenarioRun = {
      worker: workerId,
      input,
      attempt: number,
      token: stored.attempt,
      scopeId: scopeIdOf(stored.scope),
      end: 'running',
      abortReason: undefined,
    };
    runs.push(run);
    if (job.signal.aborted) run.abortReason = job.signal.reason;
    else
      job.signal.addEventListener(
        'abort',
        () => {
          run.abortReason = job.signal.reason;
        },
        { once: true },
      );
    const step = stepOf(input, number);
    if (step === 'fail') {
      run.end = 'failed';
      throw errors.unavailable('the scenario attempt failed');
    }
    if (step === 'hold') await gateOf(input).promise;
    const inside = step === 'holdInUnit';
    try {
      await adapter.unit(
        subject.namespace(),
        stored.scope,
        async (unit: Unit) => {
          await unit.rows.insert(owner, [
            rowAt(input * 100 + number, { name: `${input}/${number}` }),
          ]);
          if (inside) await gateOf(input).promise;
          if (!(await unit.jobs.complete(stored.attempt, workerId, { kind: 'succeeded' }))) {
            throw fence;
          }
        },
        { signal: job.signal },
      );
      run.end = 'completed';
    } catch (error) {
      const reason: unknown = job.signal.aborted ? job.signal.reason : undefined;
      if (error === fence) {
        run.end = 'fenced';
      } else if (
        isKeelwerkError(reason) &&
        (reason.code === 'core.job_lease_lost' || reason.code === 'core.unavailable')
      ) {
        run.end = inside ? 'dropped' : 'refused';
      } else {
        // An attempt past its expiry or a store failure: the fetcher judges it, so a timeout is retried.
        run.end = 'failed';
        throw reason ?? error;
      }
    }
  };
  return (job: Job): Promise<void> => {
    const running = attempt(job);
    handlers.add(running);
    void running.then(
      () => handlers.delete(running),
      () => handlers.delete(running),
    );
    return running;
  };
}
