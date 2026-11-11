import type { ControlStore } from '../control/control-store.ts';
import { errors } from '../errors/errors.ts';
import type { KeelwerkError } from '../errors/keelwerk-error.ts';
import { coreError } from '../http/core-error.ts';
import type { Job } from '../jobs/job.ts';
import type { Clock } from '../kernel/clock.ts';
import type { Logger } from '../observability/logger.ts';
import type { WorkClassStats } from '../storage/work-class-stats.ts';
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
/** The lane cap of a queue the kernel upserts; the runtime's queue limits replace it (WP-36). */
const laneCap = 4;

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
}

/**
 * The kernel queue (9.5.1, 14.3.9): enqueue and cancel go through `unit.jobs`; `work` starts one
 * fetcher for the queue. One ticker drives every fetcher and the attempts they hold (D1, D3): it
 * renews the leases that are due, one statement per namespace, aborts the attempts past
 * `expireInSeconds` with `core.timeout`, and sweeps the fetchers that have a wake pending. Wake-ups
 * come from the adapters' change feeds, from `probe.wake()`, from `Job.heartbeat()` and from a
 * freed slot; the wall timer only re-checks, at most once a second, and never starts before `work`.
 * The queue is stopped when every fetcher has drained.
 */
export function createKernelQueue(options: KernelQueueOptions): KernelQueue {
  const { sources, worker, clock, log } = options;
  const held = new Map<string, HeldJob>();
  const fetchers: QueueFetcher[] = [];
  const renewing = new Set<HeldJob>();
  const sourceOfJob = new WeakMap<Job, QueueSource>();
  const waiters: (() => void)[] = [];
  const readiness = sourceReadiness(clock, log);
  const stopped = new AbortController();
  const drained = new Set<QueueFetcher>();
  let settled = 0;
  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const quiet = (): boolean =>
    held.size === 0 && renewing.size === 0 && fetchers.every((fetcher) => fetcher.idle);
  const changed = (): void => {
    if (!quiet()) return;
    for (const resolve of waiters.splice(0)) resolve();
  };

  const tick = (): void => {
    const now = clock.now();
    const due = [...held.values()].filter(
      (entry) =>
        !renewing.has(entry) &&
        Temporal.Instant.compare(now, entry.renewedAt.add({ milliseconds: entry.heartbeatMs })) >=
          0,
    );
    if (due.length > 0) {
      for (const entry of due) renewing.add(entry);
      void renewLeases(due, worker, now, (error) => {
        log.warn('a lease renewal failed; the next tick asks again', { cause: error });
      })
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
      const dueAt = entry.renewedAt.add({ milliseconds: entry.heartbeatMs });
      const wait = dueAt.epochMilliseconds - now.epochMilliseconds;
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
  const wakeAll = (): void => {
    for (const fetcher of fetchers) fetcher.wake();
    if (started && !stopped.signal.aborted) tick();
  };

  const follow = (): void => {
    const adapters = new Map(sources.map((source) => [source.handle.adapter, [] as QueueSource[]]));
    for (const source of sources) adapters.get(source.handle.adapter)?.push(source);
    for (const [adapter, own] of adapters) {
      void (async () => {
        try {
          for await (const _ of adapter.feed.wake(
            own.map((source) => source.namespace),
            stopped.signal,
          )) {
            wakeAll();
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
      wakeAll();
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
    enqueue: (job, unit) =>
      unit.jobs.enqueue({
        ...job,
        kind: 'action' in job.run ? 'action' : 'effect',
        laneCap,
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
          wake: wakeAll,
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
    schedule: () => Promise.reject(unsupported('Schedules', 'WP-82')),
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
