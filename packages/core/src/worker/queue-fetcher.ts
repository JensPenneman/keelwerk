import { isKeelwerkError } from '../errors/is-keelwerk-error.ts';
import { coreError } from '../http/core-error.ts';
import type { Job } from '../jobs/job.ts';
import type { WorkerOptions } from '../jobs/worker-options.ts';
import type { StoredJob } from '../storage/stored-job.ts';
import type { KernelQueueOptions } from './create-kernel-queue.ts';
import { defaultHeartbeatSeconds } from './default-heartbeat-seconds.ts';
import type { FetcherHooks } from './fetcher-hooks.ts';
import type { HeldJob } from './held-job.ts';
import { jobOutcomeOfError } from './job-outcome-of-error.ts';
import type { QueueSource } from './queue-source.ts';
import { settleJobAttempt } from './settle-job-attempt.ts';
import type { SourceReadiness } from './source-readiness.ts';
import { takeBatch } from './take-batch.ts';
import { workerSlots } from './worker-slots.ts';

/** The poll that backs up the wake-ups, in milliseconds, and the jitter around it. */
const pollMs = 1000;
const pollJitter = 0.2;
/** The lease a take asks for: three of the default heartbeats (D3). */
const takeLeaseMs = 30_000;
const maxRetakes = 3;
const pacingMs = 25;

/** What a kernel queue drives for each queue it works. */
export interface QueueFetcher {
  /** Something may be waiting: the next tick sweeps. */
  wake(): void;
  /** Sweeps when a wake is pending or the poll is due. Settles when the sweep ends. */
  tick(now: Temporal.Instant): Promise<void>;
  /**
   * Stops taking and waits for the attempts still running until `deadline` (wall clock), then
   * aborts the ones left with a shutdown reason and answers how many there were; their leases
   * expire (D6). A later call with a deadline that has passed ends the waits of the earlier ones.
   */
  drain(deadline: Temporal.Instant): Promise<number>;
  readonly idle: boolean;
}

/**
 * The fetcher of one queue (9.5.6, D1): a sweep promotes due jobs and takes batches for the free
 * slots from every ready namespace in turn, again and again until a take finds nothing; a take that
 * skipped locked lanes is retaken after a short jittered pause, at most three times in a row. A
 * wake that arrives during a sweep is not lost: the sweep repeats once when it ends. An attempt
 * whose handler rejects is completed by the error taxonomy in a short unit of the job's scope,
 * which also fails the job's own accepted receipt when the job gives up (`settleJobAttempt`).
 */
export function queueFetcher(input: {
  readonly queue: string;
  readonly handler: (job: Job) => Promise<void>;
  readonly options: WorkerOptions;
  readonly kernel: KernelQueueOptions;
  readonly held: Map<string, HeldJob>;
  readonly readiness: SourceReadiness;
  readonly hooks: FetcherHooks;
}): QueueFetcher {
  const { queue, handler, options, kernel, held, readiness, hooks } = input;
  const { clock, log, worker, sources } = kernel;
  const random = kernel.random ?? Math.random;
  const slots = workerSlots(options.slots);
  const running = new Set<Promise<void>>();
  const mine = new Set<HeldJob>();
  const expiries = new Set<() => void>();
  const shutdown = coreError('core.unavailable', {
    message: 'The worker stopped before the attempt finished.',
  });
  let wakePending = true;
  let sweeping: Promise<void> | undefined;
  let draining = false;
  let saturated = false;
  let nextPollAt: Temporal.Instant | undefined;
  let rotation = 0;

  const completeFailed = async (entry: HeldJob, error: unknown): Promise<void> => {
    const { stored } = entry.job;
    const reason: unknown = entry.abort.signal.aborted ? entry.abort.signal.reason : undefined;
    if (reason === shutdown) return;
    if (isKeelwerkError(reason) && reason.code === 'core.job_lease_lost') return;
    const cause = entry.abort.signal.aborted && !isKeelwerkError(error) ? reason : error;
    const outcome = jobOutcomeOfError(cause, stored, clock.now(), random);
    if (outcome === undefined) return;
    try {
      await settleJobAttempt(
        { source: entry.source, worker, writer: kernel.writer, clock },
        stored,
        outcome,
      );
    } catch (failure) {
      log.warn('a failed attempt could not be completed', {
        queue,
        job: stored.id,
        cause: failure,
      });
    }
  };

  const start = (stored: StoredJob, source: QueueSource): void => {
    const now = clock.now();
    const abort = new AbortController();
    const heartbeatMs = (stored.heartbeatSeconds ?? defaultHeartbeatSeconds) * 1000;
    const key = `${source.namespace.id}/${stored.id}`;
    const entry: HeldJob = {
      job: {
        stored,
        signal: abort.signal,
        heartbeat: () => {
          entry.renewedAt = Temporal.Instant.fromEpochMilliseconds(0);
          hooks.wake();
        },
      },
      source,
      abort,
      heartbeatMs,
      leaseMs: 3 * heartbeatMs,
      expiresAt:
        stored.expireInSeconds === undefined
          ? undefined
          : now.add({ milliseconds: stored.expireInSeconds * 1000 }),
      renewedAt:
        heartbeatMs === defaultHeartbeatSeconds * 1000
          ? now
          : now.subtract({ milliseconds: heartbeatMs }),
    };
    held.set(key, entry);
    mine.add(entry);
    hooks.took(entry.job, source);
    const attempt = (async () => {
      try {
        await handler(entry.job);
      } catch (error) {
        await completeFailed(entry, error);
      } finally {
        held.delete(key);
        mine.delete(entry);
        slots.release();
        hooks.settled();
        if (saturated) {
          wakePending = true;
          hooks.wake();
        }
      }
    })();
    running.add(attempt);
    void attempt.finally(() => running.delete(attempt));
  };

  const sweep = async (): Promise<void> => {
    let retakes = 0;
    for (;;) {
      if (draining) return;
      saturated = slots.free() === 0;
      if (saturated) return;
      let took = false;
      let skipped = false;
      const first = rotation;
      rotation += 1;
      for (let i = 0; i < sources.length && slots.free() > 0 && !draining; i += 1) {
        const source = sources[(first + i) % sources.length];
        if (source === undefined || !(await readiness.ready(source))) continue;
        const free = slots.free();
        const batch = await takeBatch(source, queue, worker, {
          limit: free,
          lanes: kernel.takeLanes?.[queue] ?? free,
          capabilitySets: options.capabilitySets,
          maxRevision: options.revision,
          leaseMs: takeLeaseMs,
        });
        slots.hold(batch.jobs.length);
        for (const stored of batch.jobs) start(stored, source);
        took ||= batch.jobs.length > 0;
        skipped ||= batch.skippedLanes > 0;
      }
      if (took) {
        retakes = 0;
        continue;
      }
      if (!skipped || retakes >= maxRetakes || slots.free() === 0) return;
      retakes += 1;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.floor(random() * pacingMs)));
    }
  };

  return {
    wake: () => {
      wakePending = true;
    },
    tick: async (now) => {
      if (draining || sweeping !== undefined) return;
      const pollDue = nextPollAt === undefined || Temporal.Instant.compare(now, nextPollAt) >= 0;
      if (!wakePending && !pollDue) return;
      const gate = Promise.withResolvers<void>();
      sweeping = gate.promise;
      try {
        do {
          wakePending = false;
          nextPollAt = now.add({
            milliseconds: Math.round(pollMs * (1 - pollJitter + 2 * pollJitter * random())),
          });
          await sweep();
        } while (wakePending && !draining);
      } catch (error) {
        log.error('a sweep of the queue failed', { queue, cause: error });
      } finally {
        sweeping = undefined;
        gate.resolve();
        hooks.changed();
      }
    },
    drain: async (deadline) => {
      draining = true;
      hooks.changed();
      const remaining = Math.max(
        0,
        deadline.epochMilliseconds - Temporal.Now.instant().epochMilliseconds,
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = Promise.withResolvers<void>();
      expiries.add(expired.resolve);
      if (remaining === 0) {
        for (const expire of expiries) expire();
      } else {
        timer = setTimeout(expired.resolve, remaining);
        timer.unref();
      }
      const finished = (async () => {
        while (sweeping !== undefined || running.size > 0) {
          await Promise.allSettled([...(sweeping === undefined ? [] : [sweeping]), ...running]);
        }
      })();
      try {
        await Promise.race([finished, expired.promise]);
      } finally {
        clearTimeout(timer);
        expiries.delete(expired.resolve);
      }
      const left = running.size;
      for (const entry of mine) {
        if (!entry.abort.signal.aborted) entry.abort.abort(shutdown);
      }
      return left;
    },
    get idle() {
      return draining || (sweeping === undefined && !wakePending);
    },
  };
}
