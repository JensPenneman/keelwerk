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
import { releaseAttempts } from './release-attempts.ts';
import { settleExhaustedJob } from './settle-exhausted-job.ts';
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
/** How long a drain waits (wall clock) for aborted handlers before it releases (D4). */
const releaseGraceMs = 1000;

/** What a kernel queue drives for each queue it works. */
export interface QueueFetcher {
  readonly queue: string;
  /**
   * Something may be waiting: the next tick sweeps at least `namespaceId` (every namespace when the
   * poll is due or a wake without one is pending), or every namespace without one.
   */
  wake(namespaceId?: string): void;
  /** Sweeps when a wake is pending or the poll is due. Settles when the sweep ends. */
  tick(now: Temporal.Instant): Promise<void>;
  /**
   * Stops taking and waits for the attempts still running until `deadline` (wall clock), then
   * aborts the ones left with a shutdown reason, gives their handlers a short grace to settle (an
   * effect attempt closes its start record, a late commit lands) and releases what is still running
   * in the store: back to available, the attempt not counted (21.6 step 4). A release that fails is
   * logged and the leases expire as before. A take in flight when the drain begins has its batch
   * released too, once the take answers (never started); the drain waits for that take and its
   * release even when `deadline` has passed (one take and one release unit more). Once begun, a
   * drain is final: the fetcher takes nothing again, also after a take that promoted jobs. The jobs
   * that last take promoted, and the attempts it released, are another worker's to take: the commit
   * of the take unit records the queue as readied for the promoted jobs (`JobStore.promote`), the
   * release unit's own commit for the released attempts (`JobStore.release`), and
   * `createKernelQueue`'s `wakeQueues` wakes that worker's fetcher of the queue when the change
   * feed delivers it. A feed that only polls delivers none, so they wait for that worker's next
   * poll. Answers how many attempts were left at the deadline. A later call with a deadline that
   * has passed ends the waits of the earlier ones.
   */
  drain(deadline: Temporal.Instant): Promise<number>;
  readonly idle: boolean;
  /**
   * The clock's reading when the last sweep of every namespace began, while every sweep since then
   * ended in a round that took and promoted nothing, skipped no lane and found every source ready.
   * Unknown (undefined) after any other end, a drain included.
   */
  readonly seenAt: Temporal.Instant | undefined;
}

/**
 * The fetcher of one queue (9.5.6, D1): a sweep promotes due jobs and takes batches for the free
 * slots from every ready namespace in turn, again and again until a take finds nothing; a take that
 * promoted jobs is work too, because a store may count them only when its unit commits, and a take
 * that skipped locked lanes is retaken after a short jittered pause, at most three times in a row. A
 * wake that names a namespace sweeps that namespace; the poll and a wake that names none sweep them
 * all. A wake that arrives during a sweep is not lost: the sweep repeats once when it ends. An attempt
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
  const released = new WeakSet<HeldJob>();
  const shutdown = coreError('core.unavailable', {
    message: 'The worker stopped before the attempt finished.',
  });
  // What the next sweep covers: every namespace, or only those a wake named.
  let wakeEverywhere = true;
  const wakeNamespaces = new Set<string>();
  let sweeping: Promise<void> | undefined;
  let draining = false;
  let saturated = false;
  let nextPollAt: Temporal.Instant | undefined;
  let rotation = 0;
  let seenAt: Temporal.Instant | undefined;
  let releasing: Promise<void> = Promise.resolve();

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

  const unreleased = (error: unknown): void => {
    log.warn('attempts could not be released; their leases will expire', { queue, cause: error });
  };

  const releaseLeft = async (leftBehind: readonly HeldJob[]): Promise<void> => {
    let grace: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled([...running]),
        new Promise<void>((resolve) => {
          grace = setTimeout(resolve, releaseGraceMs);
          grace.unref();
        }),
      ]);
    } finally {
      clearTimeout(grace);
    }
    const released = await releaseAttempts(leftBehind, worker, unreleased);
    log.warn('attempts were still running at the deadline', {
      queue,
      attempts: leftBehind.length,
      released,
      leftToTheirLeases: leftBehind.length - released,
    });
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
          hooks.tick();
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
        if (stored.leasesExhausted === true) {
          // Ends here with its receipt and never runs; a unit that fails leaves it to its lease.
          await settleExhaustedJob({ source, worker, writer: kernel.writer, clock }, stored).catch(
            (failure: unknown) =>
              log.warn('a job whose leases were lost could not be ended', {
                queue,
                job: stored.id,
                cause: failure,
              }),
          );
        } else await handler(entry.job);
      } catch (error) {
        await completeFailed(entry, error);
      } finally {
        held.delete(key);
        mine.delete(entry);
        slots.release();
        // The fetcher's own wake comes before the settled hook, so the probe is not quiet between them.
        if (saturated) {
          wakeEverywhere = true;
          hooks.tick();
        }
        hooks.settled();
      }
    })();
    running.add(attempt);
    void attempt.finally(() => running.delete(attempt));
  };

  const wakePending = (): boolean => wakeEverywhere || wakeNamespaces.size > 0;

  const sweep = async (only: ReadonlySet<string> | undefined): Promise<boolean> => {
    const swept = only === undefined ? sources : sources.filter((s) => only.has(s.namespace.id));
    let retakes = 0;
    for (;;) {
      if (draining) return false;
      saturated = slots.free() === 0;
      if (saturated) return false;
      let took = false;
      let skipped = false;
      let unready = false;
      const first = rotation;
      rotation += 1;
      for (let i = 0; i < swept.length && slots.free() > 0 && !draining; i += 1) {
        const source = swept[(first + i) % swept.length];
        if (source === undefined || !(await readiness.ready(source))) {
          unready = true;
          continue;
        }
        const free = slots.free();
        const batch = await takeBatch(source, queue, worker, {
          limit: free,
          lanes: kernel.takeLanes?.[queue] ?? free,
          capabilitySets: options.capabilitySets,
          maxRevision: options.revision,
          leaseMs: takeLeaseMs,
        });
        // A drain that began while the take was in flight: nothing of the batch starts (no executor
        // runs after the gate closed or the process stopped) and its attempts are released before
        // the drain answers; a release that fails leaves them to their leases, as does a process
        // that stops before the take answers (D6).
        if (draining) {
          await releaseAttempts(
            batch.jobs.map((stored) => ({ source, job: { stored } })),
            worker,
            unreleased,
          );
          return false;
        }
        slots.hold(batch.jobs.length);
        for (const stored of batch.jobs) start(stored, source);
        took ||= batch.jobs.length > 0 || batch.promoted > 0;
        skipped ||= batch.skippedLanes > 0;
      }
      if (took) {
        retakes = 0;
        continue;
      }
      if (!skipped) return !unready;
      if (retakes >= maxRetakes) return false;
      retakes += 1;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.floor(random() * pacingMs)));
    }
  };

  return {
    queue,
    wake: (namespaceId) => {
      if (namespaceId === undefined) wakeEverywhere = true;
      else wakeNamespaces.add(namespaceId);
    },
    tick: async (now) => {
      if (draining || sweeping !== undefined) return;
      const pollDue = nextPollAt === undefined || Temporal.Instant.compare(now, nextPollAt) >= 0;
      if (!wakePending() && !pollDue) return;
      const gate = Promise.withResolvers<void>();
      sweeping = gate.promise;
      try {
        let polled = pollDue;
        do {
          // A poll covers every namespace, as a wake without a name does; a sweep of some namespaces
          // leaves the next poll where it is, so a busy namespace never defers the poll of the others.
          const only = wakeEverywhere || polled ? undefined : new Set(wakeNamespaces);
          polled = false;
          wakeEverywhere = false;
          wakeNamespaces.clear();
          if (only === undefined) {
            nextPollAt = now.add({
              milliseconds: Math.round(pollMs * (1 - pollJitter + 2 * pollJitter * random())),
            });
            seenAt = now;
          }
          if (!(await sweep(only))) seenAt = undefined;
        } while (wakePending() && !draining);
      } catch (error) {
        seenAt = undefined;
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
      const leftBehind = [...mine].filter((entry) => !released.has(entry));
      for (const entry of leftBehind) {
        released.add(entry);
        if (!entry.abort.signal.aborted) entry.abort.abort(shutdown);
      }
      if (leftBehind.length > 0) {
        // Set before the first await: a drain that finds the attempts claimed already waits for this one.
        releasing = Promise.all([releasing, releaseLeft(leftBehind)]).then(() => undefined);
      }
      // A take in flight is awaited even past the deadline: its batch is released inside the sweep
      // (one take and one release unit), and that release has ended when the drain answers.
      await Promise.all([releasing, sweeping]);
      return left;
    },
    get idle() {
      return draining || (sweeping === undefined && !wakePending());
    },
    get seenAt() {
      return seenAt;
    },
  };
}
