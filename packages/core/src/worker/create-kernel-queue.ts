import type { ControlStore } from '../control/control-store.ts';
import { errors } from '../errors/errors.ts';
import type { KeelwerkError } from '../errors/keelwerk-error.ts';
import { coreError } from '../http/core-error.ts';
import type { Job } from '../jobs/job.ts';
import type { Clock } from '../kernel/clock.ts';
import type { Logger } from '../observability/logger.ts';
import { laneLimitsOf } from '../quotas/lane-limits-of.ts';
import type { QuotaLimits } from '../quotas/quota-limits.ts';
import { backgroundRetryMs } from '../runtime/background-retry-ms.ts';
import type { WorkClassStats } from '../storage/work-class-stats.ts';
import { eventLoopTurn } from './event-loop-turn.ts';
import type { HeldJob } from './held-job.ts';
import { jobLeaseLost } from './job-lease-lost.ts';
import type { KernelQueue } from './kernel-queue.ts';
import type { QueueFetcher } from './queue-fetcher.ts';
import { queueFetcher } from './queue-fetcher.ts';
import type { QueueSource } from './queue-source.ts';
import { renewLeases } from './renew-leases.ts';
import { sourceReadiness } from './source-readiness.ts';

/** The tick never waits longer than this on the wall clock. */
const maxTickMs = 1000;

/** What the kernel queue is built from. */
export interface KernelQueueOptions {
  readonly sources: readonly QueueSource[];
  /** The fencing id: the process id. */
  readonly worker: string;
  readonly clock: Clock;
  readonly log: Logger;
  readonly writer: ControlStore['writer'];
  /** Default `Math.random`. */
  readonly random?: () => number;
  /** `queues.<q>.takeLanes`; default the batch size. */
  readonly takeLanes?: Readonly<Record<string, number>>;
  /** The queue limits of section 12.2 for the lanes of the jobs it enqueues; without them (as the runtime builds it for now) the default lane cap. */
  readonly quotas?: Pick<QuotaLimits, 'queueOf'>;
}

/**
 * The kernel queue (9.5.1, 14.3.9): enqueue and cancel go through `unit.jobs`; `work` starts one
 * fetcher for the queue. One ticker drives every fetcher and the attempts they hold (D1, D3): it
 * renews the leases that are due, one statement per namespace, aborts the attempts past
 * `expireInSeconds` with `core.timeout`, and sweeps the fetchers that have a wake pending. Wake-ups
 * come from the adapters' job feeds, which name the queues a commit made takeable (a wake-up that names
 * none sweeps every fetcher of its namespace), from `probe.wake()` (see `sweepUnseen`), from a slot
 * freed in a full fetcher (that fetcher only) and from `Job.heartbeat()` (a tick only; it wakes no
 * fetcher); the wall timer only re-checks, at most once a second, and never starts before `work`.
 * The queue is stopped when every fetcher has drained.
 */
export function createKernelQueue(options: KernelQueueOptions): KernelQueue {
  const { sources, worker, clock, log } = options;
  const held = new Map<string, HeldJob>();
  const fetchers: QueueFetcher[] = [];
  const renewing = new Set<HeldJob>();
  const sourceOfJob = new WeakMap<Job, QueueSource>();
  const waiters: (() => void)[] = [];
  const random = options.random ?? Math.random;
  const readiness = sourceReadiness(clock, log, undefined, random);
  const stopped = new AbortController();
  const drained = new Set<QueueFetcher>();
  let settled = 0;
  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const attended: (() => Promise<void>)[] = [];
  const attending = new Set<Promise<void>>();

  const quiet = (): boolean =>
    held.size === 0 &&
    renewing.size === 0 &&
    attending.size === 0 &&
    fetchers.every((fetcher) => fetcher.idle);
  const changed = (): void => {
    if (!quiet()) return;
    for (const resolve of waiters.splice(0)) resolve();
  };

  /**
   * When the entry's lease is next renewed: one heartbeat after the last renewal, later after a
   * failed one.
   */
  const renewalDueAt = (entry: HeldJob): Temporal.Instant => {
    const due = entry.renewedAt.add({ milliseconds: entry.heartbeatMs });
    return entry.renewRetryAt !== undefined && Temporal.Instant.compare(entry.renewRetryAt, due) > 0
      ? entry.renewRetryAt
      : due;
  };

  const tick = (): void => {
    const now = clock.now();
    const due = [...held.values()].filter(
      (entry) => !renewing.has(entry) && Temporal.Instant.compare(now, renewalDueAt(entry)) >= 0,
    );
    if (due.length > 0) {
      for (const entry of due) renewing.add(entry);
      void renewLeases(
        due,
        worker,
        now,
        (failures) => backgroundRetryMs(failures, random),
        (error) => {
          log.warn('a lease renewal failed; it is asked again after a pause', { cause: error });
        },
      )
        .then((lost) => {
          for (const entry of lost) entry.abort.abort(jobLeaseLost());
        })
        .finally(() => {
          for (const entry of due) renewing.delete(entry);
          changed();
        });
    }
    for (const entry of held.values()) {
      if (
        entry.expiresAt !== undefined &&
        Temporal.Instant.compare(now, entry.expiresAt) >= 0 &&
        !entry.abort.signal.aborted
      ) {
        entry.abort.abort(
          coreError('core.timeout', { message: 'The attempt exceeded expireInSeconds.' }),
        );
      }
    }
    for (const fetcher of fetchers) void fetcher.tick(now);
  };

  const nextDelayMs = (): number => {
    const now = clock.now();
    let delay = maxTickMs;
    for (const entry of held.values()) {
      // A renewal in flight is not due again until it ends: counting it would spin the tick.
      if (renewing.has(entry)) continue;
      const wait = renewalDueAt(entry).epochMilliseconds - now.epochMilliseconds;
      delay = Math.min(delay, Math.max(0, wait));
    }
    return delay;
  };
  const schedule = (): void => {
    if (stopped.signal.aborted) return;
    timer = setTimeout(() => {
      tick();
      schedule();
    }, nextDelayMs());
    timer.unref();
  };
  const tickNow = (): void => {
    if (started && !stopped.signal.aborted) tick();
  };
  // Every commit is this process's own and its feed notifies: a commit's wake-up names what it made
  // takeable, so a fetcher at rest needs no sweep until the clock moves.
  const announced = sources.every(
    (source) =>
      source.handle.capabilities?.processes === 'single' &&
      source.handle.adapter.feed.level !== 'poll',
  );
  /** The probe's sweep: every fetcher unless it came to rest at the clock's reading and wake-ups announce the rest. */
  const sweepUnseen = (): void => {
    const now = clock.now();
    for (const fetcher of fetchers) {
      const { seenAt } = fetcher;
      if (!announced || seenAt === undefined || Temporal.Instant.compare(now, seenAt) > 0) {
        fetcher.wake();
      }
    }
    tickNow();
  };
  /** A commit made jobs takeable in `queues` of `namespace`; without `queues` in every queue of it. */
  const wakeQueues = (namespace: string, queues: readonly string[] | undefined): void => {
    for (const fetcher of fetchers) {
      if (queues === undefined || queues.includes(fetcher.queue)) fetcher.wake(namespace);
    }
    tickNow();
  };

  const follow = (): void => {
    const adapters = new Map(sources.map((source) => [source.handle.adapter, [] as QueueSource[]]));
    for (const source of sources) adapters.get(source.handle.adapter)?.push(source);
    for (const [adapter, own] of adapters) {
      void (async () => {
        try {
          for await (const wake of adapter.feed.jobs(
            own.map((source) => source.namespace),
            stopped.signal,
          )) {
            wakeQueues(wake.namespace, wake.queues);
          }
        } catch (error) {
          if (!stopped.signal.aborted)
            log.error('the change feed of the workers failed', { cause: error });
        }
      })();
    }
  };

  const unsupported = (what: string, wp: string): KeelwerkError =>
    errors.not_implemented(`${what} of the kernel queue arrives with ${wp}.`);

  const probe = {
    wake: () => {
      readiness.recheck();
      tickNow();
      // The sweep comes after the attended runs have settled and one turn of the event loop has
      // delivered, on the in-process feeds, the wake-ups that commits pushed before this call; the
      // probe is not quiet until then.
      const runs = attended.map((run) =>
        run().catch((error: unknown) => {
          log.error('an attended run failed', { cause: error });
        }),
      );
      const choosing = Promise.all(runs).then(eventLoopTurn).then(sweepUnseen);
      attending.add(choosing);
      void choosing.finally(() => {
        attending.delete(choosing);
        changed();
      });
    },
    idle: () =>
      new Promise<void>((resolve) => {
        if (quiet()) resolve();
        else waiters.push(resolve);
      }),
    get settled() {
      return settled;
    },
  };

  return {
    probe,
    capabilities: {
      keys: true,
      groups: true,
      fifoPerKey: true,
      heartbeat: true,
      fairLanes: true,
      schedules: false,
    },
    sourceOf: (job) => {
      const source = sourceOfJob.get(job);
      if (source === undefined) throw errors.internal('The job was not taken by this queue.');
      return source;
    },
    attend: (run) => {
      attended.push(run);
    },
    enqueue: (job, unit) =>
      unit.jobs.enqueue({
        ...job,
        kind: 'action' in job.run ? 'action' : 'effect',
        ...laneLimitsOf(options.quotas?.queueOf(job.scope, job.queue)),
        createdAt: clock.now(),
      }),
    cancel: (queue, key, unit) => unit.jobs.cancel(queue, key),
    work: async (queue, handler, workerOptions) => {
      const fetcher = queueFetcher({
        queue,
        handler,
        options: workerOptions,
        kernel: options,
        held,
        readiness,
        hooks: {
          took: (job, source) => sourceOfJob.set(job, source),
          settled: () => {
            settled += 1;
            changed();
          },
          changed,
          tick: tickNow,
        },
      });
      fetchers.push(fetcher);
      if (!started) {
        started = true;
        follow();
        schedule();
      }
      tick();
      return {
        drain: async (deadline) => {
          const left = await fetcher.drain(deadline);
          drained.add(fetcher);
          if (drained.size === fetchers.length) {
            stopped.abort();
            clearTimeout(timer);
            changed();
          }
          return left;
        },
      };
    },
    schedule: () =>
      Promise.reject(
        errors.not_implemented(
          'Schedules are declared with defineSchedule; the kernel queue registers none at run time.',
        ),
      ),
    explain: () => Promise.reject(unsupported('Explaining a job', 'WP-83')),
    stats: async (selector) => {
      if (selector.backendId !== undefined) {
        throw unsupported('Statistics per backend', 'WP-83');
      }
      const perSource = await Promise.all(
        sources.map((source) =>
          source.handle.adapter.unit(
            source.namespace,
            { level: 'namespace', reason: 'stats' },
            (unit) => unit.jobs.stats(selector.queue),
            { readOnly: true },
          ),
        ),
      );
      return perSource.flat() satisfies readonly WorkClassStats[];
    },
  };
}
