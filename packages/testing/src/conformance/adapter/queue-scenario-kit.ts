import type {
  DataAdapter,
  JobAttempt,
  JobId,
  JobSpec,
  Scope,
  StorageScope,
  StoredJob,
  WorkClassStats,
} from '@keelwerk/core';
import { createKernelQueue, errors, hybridClock } from '@keelwerk/core';
import { conformanceEntities, conformanceScopes } from '@keelwerk/data/conformance';
import { vi } from 'vitest';
import { conformanceApp } from '../../fixtures/index.ts';
import { recordingLogger } from '../../harness/recording-logger.ts';
import type { ConformanceClock } from './conformance-clock.ts';
import type { ConformanceSubject } from './conformance-subject.ts';
import { queueScenarioHandler } from './queue-scenario-handler.ts';
import type { QueueScenarioRun } from './queue-scenario-run.ts';
import type { QueueScenarioStep } from './queue-scenario-step.ts';
import { queueScenarioSwept } from './queue-scenario-swept.ts';
import type { QueueScenarioWorker } from './queue-scenario-worker.ts';

const { tenantA } = conformanceScopes;
const { owner } = conformanceEntities;
const namespaceScope: StorageScope = { level: 'namespace', reason: 'conformance' };
const queueName = 'scenarios';

/** What the queue scenarios share (14.3.9, 14.10 case 10): workers over the target's adapter, scripted attempts, and reads. */
export interface QueueScenarioKit {
  clock(): ConformanceClock;
  /** A kernel queue with worker id `id` (default 4 slots) working queue `scenarios`, over the target's
   *  adapter wrapped for cut/heal and renewal counting; source capabilities `{ ...subject.capabilities(), sql: false }`. */
  worker(id: string, slots?: number, kernelClock?: ConformanceClock): Promise<QueueScenarioWorker>;
  /** A clock that starts at the target's reading and moves only by `advance`, to be given to `worker` as its kernel clock: nothing of that worker is due by the passing of time. */
  pinnedClock(): ConformanceClock;
  /** Queue `scenarios`, tenant A, action `scenario.run`, input `n`, principal { resolver: 'system', principalId: 'p' }, build revision 1. */
  job(n: number, over?: Partial<JobSpec>): JobSpec;
  /** `KernelQueue.enqueue` of a producer queue that never works, in one unit of `scope` (default tenant A). */
  enqueue(jobs: readonly JobSpec[], scope?: StorageScope): Promise<readonly JobId[]>;
  /** Steps of input n by attempt (index attempt - 1, the last repeats); default ['succeed']. */
  script(n: number, steps: readonly QueueScenarioStep[]): void;
  resume(n: number): void;
  /** vi.waitFor of `check`, waking every worker before each try; timeout 30 s, interval 25 ms. */
  until(check: () => boolean | Promise<boolean>): Promise<void>;
  /** Wakes every worker and waits until each has finished a sweep that began after the wake; for a case in which no attempt is held (a held attempt keeps a worker from being idle). Timeout 30 s. */
  swept(): Promise<void>;
  /** `until` without the wake: vi.waitFor of `check` and nothing else, so only what the stores announce can make it true. */
  reached(check: () => boolean | Promise<boolean>): Promise<void>;
  /** A renewal of the attempt of `run` asked of the store itself, as its worker (lease 30 s): the attempts whose lease still holds. */
  renew(run: QueueScenarioRun): Promise<readonly JobAttempt[]>;
  readonly runs: readonly QueueScenarioRun[];
  /** Committed owner row names `<n>/<attempt>`, sorted. */
  written(scope?: StorageScope): Promise<readonly string[]>;
  /** `jobs.stats('scenarios')[0]` in a namespace unit. */
  stats(): Promise<WorkClassStats | undefined>;
  /** A take of the store itself (worker 'probe', lease 60 s) after a promotion of the jobs that came due: for "nobody can get it" assertions. */
  probeTake(): Promise<readonly StoredJob[]>;
  /** Resumes every hold, drains every worker at Temporal.Now, waits for every handler. */
  close(): Promise<void>;
}

/**
 * The kit of the queue scenarios over the adapter of `subject`. Each worker is a kernel queue on its
 * own wrapper of the adapter, so a case can cut one worker's renewals; the attempts it hands out run
 * the scripted steps and write one `conf.owner` row named `<input>/<attempt>` in the unit that
 * completes them, which a lost lease or a drain rolls back.
 */
export function queueScenarioKit(subject: ConformanceSubject): QueueScenarioKit {
  const runs: QueueScenarioRun[] = [];
  const scripts = new Map<number, readonly QueueScenarioStep[]>();
  const gates = new Map<number, PromiseWithResolvers<void>>();
  const workers: QueueScenarioWorker[] = [];
  const handlers = new Set<Promise<void>>();
  let closing = false;
  let producer: ReturnType<typeof createKernelQueue> | undefined;
  const log = recordingLogger();
  const writer = {
    hybridClock: hybridClock('scenario-node'),
    build: { id: 'scenario', revision: 1 },
  };

  const clock = (): ConformanceClock => {
    if (subject.clock === undefined) throw new Error('the queue scenarios need a movable clock');
    return subject.clock;
  };
  const gateOf = (n: number): PromiseWithResolvers<void> => {
    const found = gates.get(n) ?? Promise.withResolvers<void>();
    gates.set(n, found);
    if (closing) found.resolve();
    return found;
  };
  const stepOf = (n: number, attempt: number): QueueScenarioStep => {
    const steps = scripts.get(n) ?? ['succeed'];
    return steps[Math.min(attempt, steps.length) - 1] ?? 'succeed';
  };
  const shared = { subject, runs, handlers, gateOf, stepOf };
  const sourceOf = (adapter: DataAdapter) => ({
    namespace: subject.namespace(),
    handle: { adapter, capabilities: { ...subject.capabilities(), sql: false as const } },
    registry: conformanceApp.registry,
  });
  const queueOver = (worker: string, adapter: DataAdapter, kernelClock = clock()) =>
    createKernelQueue({
      sources: [sourceOf(adapter)],
      worker,
      clock: kernelClock,
      log,
      writer,
      random: () => 0.999,
    });
  const worker = async (
    id: string,
    slots = 4,
    kernelClock?: ConformanceClock,
  ): Promise<QueueScenarioWorker> => {
    const base = subject.adapter();
    const state = { cut: false, renewals: 0 };
    const wrapped: DataAdapter = {
      ...base,
      unit: (namespace, scope, fn, options) =>
        base.unit(
          namespace,
          scope,
          (unit) =>
            fn({
              ...unit,
              jobs: {
                ...unit.jobs,
                heartbeat: async (attempts, holder, leaseMs) => {
                  if (state.cut) throw errors.unavailable('the worker cannot reach the store');
                  const held = await unit.jobs.heartbeat(attempts, holder, leaseMs);
                  state.renewals += held.length;
                  return held;
                },
              },
            }),
          options,
        ),
    };
    const queue = queueOver(id, wrapped, kernelClock);
    const handle = await queue.work(queueName, queueScenarioHandler(shared, id, base), {
      slots,
      capabilitySets: [''],
      revision: 1,
    });
    const started: QueueScenarioWorker = {
      id,
      queue,
      renewals: () => state.renewals,
      cut: () => {
        state.cut = true;
      },
      heal: () => {
        state.cut = false;
      },
      drain: (deadline) => handle.drain(deadline),
    };
    workers.push(started);
    return started;
  };

  const awaited = (check: () => boolean | Promise<boolean>): Promise<void> =>
    vi.waitFor(
      async () => {
        if (!(await check())) {
          const seen = runs.map((run) => `${run.worker}:${run.input}/${run.attempt}:${run.end}`);
          throw new Error(
            `the scenario has not reached the awaited state; runs: ${seen.join(' ')}`,
          );
        }
      },
      { timeout: 30_000, interval: 25 },
    );

  const enqueue = async (
    jobs: readonly JobSpec[],
    scope: StorageScope = tenantA,
  ): Promise<readonly JobId[]> => {
    producer ??= queueOver('producer', subject.adapter());
    const queue = producer;
    return subject.run(scope, async (unit) => {
      const ids: JobId[] = [];
      for (const job of jobs)
        ids.push(await queue.enqueue({ ...job, scope: scope as Scope }, unit));
      return ids;
    });
  };

  return {
    clock,
    worker,
    job: (n, over = {}) => ({
      queue: queueName,
      run: { action: 'scenario.run', input: n },
      scope: tenantA,
      principal: { resolver: 'system', principalId: 'p' },
      causation: {},
      build: { id: 'b1', revision: 1 },
      ...over,
    }),
    enqueue,
    script: (n, steps) => {
      scripts.set(n, steps);
    },
    resume: (n) => {
      gateOf(n).resolve();
    },
    until: (check) =>
      awaited(async () => {
        for (const each of workers) each.queue.probe.wake();
        return check();
      }),
    reached: (check) => awaited(check),
    pinnedClock: () => {
      let at = clock().now();
      return {
        now: () => at,
        advance: (milliseconds) => {
          at = at.add({ milliseconds });
        },
      };
    },
    swept: () => queueScenarioSwept(workers),
    renew: (run) =>
      subject.run(namespaceScope, (unit) => unit.jobs.heartbeat([run.token], run.worker, 30_000)),
    runs,
    written: async (scope = tenantA) => {
      const page = await subject.read(scope, (unit) => unit.rows.find(owner, {}));
      return page.rows.map((row) => String(row.name)).sort();
    },
    stats: async () => {
      const all = await subject.read(namespaceScope, (unit) => unit.jobs.stats(queueName));
      return all[0];
    },
    probeTake: async () =>
      subject.run(namespaceScope, async (unit) => {
        // A take promotes nothing; a scheduled job that came due is promoted first, as a sweep does.
        await unit.jobs.promote(queueName, 100);
        const taken = await unit.jobs.take(queueName, 'probe', {
          limit: 10,
          capabilitySets: [''],
          maxRevision: 100,
          leaseMs: 60_000,
        });
        return taken.jobs;
      }),
    close: async () => {
      closing = true;
      for (const gate of gates.values()) gate.resolve();
      await Promise.all(workers.map((each) => each.drain(Temporal.Now.instant())));
      await Promise.allSettled([...handlers]);
    },
  };
}
