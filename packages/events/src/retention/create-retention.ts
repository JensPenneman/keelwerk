import type { RetentionRun, RuntimeServiceContext, UnitGuard } from '@keelwerk/core';
import {
  createControlRetention,
  defaultFeedHorizon,
  durationMs,
  errors,
  guardUnits,
  newUuidV7,
} from '@keelwerk/core';
import { createConsumerLease } from '../consumers/create-consumer-lease.ts';
import type { InsideUnit } from './inside-unit.ts';
import { retainScope } from './retain-scope.ts';
import { RetentionHalted } from './retention-halted.ts';
import type { RetentionOptions } from './retention-options.ts';
import { retentionScopes } from './retention-scopes.ts';
import type { RetentionWorker } from './retention-worker.ts';

const defaultIntervalMs = 3_600_000;
const defaultBatchSize = 1000;
const defaultPageSize = 100;
const defaultMaxBatchesPerPass = 100;
/** The lease that lets one process run a pass; renewed each third of its length between batches. */
const leaseMs = 300_000;
const leaseName = 'events.retention';
const clockTime = /^([01]\d|2[0-3]):([0-5]\d)$/;

function integerWithin(name: string, value: number, least: number, greatest: number): number {
  if (!Number.isInteger(value) || value < least || value > greatest) {
    throw errors.validation(`${name} is a whole number from ${least} to ${greatest}`);
  }
  return value;
}

/** Minutes since midnight of an 'HH:MM' text. */
function minutesOf(name: string, text: string): number {
  const found = clockTime.exec(text);
  if (found === null) throw errors.validation(`${name} is a time of day as HH:MM`);
  return Number(found[1]) * 60 + Number(found[2]);
}

/** A duration text the stores can count back from now; `validation` for any other text. */
function durationOf(name: string, text: string, least = 0): string {
  const length = durationMs(text);
  if (length < 0) throw errors.validation(`${name} is not a duration`);
  if (length < least) {
    throw errors.validation(`${name} is at least ${defaultFeedHorizon}, the feed horizon`);
  }
  return text;
}

/**
 * The worker behind `retention()` (section 14.7.1), with the test seam `insideUnit`, which the
 * public options do not carry: it runs inside every writing unit before its purge and a throw
 * fails that unit. Every `intervalMs`, inside its window, the worker visits the deployment scope
 * and each backend and tenant served here, archived tenants and backends included, and in units of one scope
 * and at most `batchSize` rows each deletes, in this order, the finished receipts whose window has
 * passed (failed ones too: this ends the fingerprint a failure leaves; a receipt of a sync mutation
 * stays until its client has acknowledged it), the change records of receipts older than the feed
 * horizon (a stream's newest record stays while its receipt exists, no chained event is touched and
 * no record of any other stream type is purged, the entities of the kernel and its modules
 * included), the job history older than seven days, the stream ticket rows a day past their expiry
 * and the records of streams that declare a retention. A scope that removed something or failed
 * gets one row in `kw_retention_runs` for the namespace that served it. A unit that fails ends only
 * its buffer: it is logged and the scope goes on with the next buffer, and the pass with the next
 * scope. Held tenants are visited like the others: the worker stops only when the service signal
 * aborts (the process stops or leaves service) or `stop` is called.
 * A pass runs on a lease in the control store, so one process runs it at a time (a process that
 * does not get the lease skips the pass), renewed between batches; each buffer of a scope runs at
 * most `maxBatchesPerPass` batches and a scheduled pass ends, the buffer in hand undrained, when
 * its window closes, so a backlog (the first pass after an upgrade) is spread over passes and the
 * next pass takes it up again. Every statement is idempotent, so two passes at once (a lost lease)
 * remove each row once.
 */
export function createRetention(
  options: RetentionOptions,
  insideUnit?: InsideUnit,
): RetentionWorker {
  const intervalMs = integerWithin(
    'intervalMs',
    options.intervalMs ?? defaultIntervalMs,
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const batchSize = integerWithin('batchSize', options.batchSize ?? defaultBatchSize, 1, 100_000);
  const pageSize = integerWithin('pageSize', options.pageSize ?? defaultPageSize, 1, 100_000);
  const maxBatches = integerWithin(
    'maxBatchesPerPass',
    options.maxBatchesPerPass ?? defaultMaxBatchesPerPass,
    1,
    1_000_000,
  );
  const rules = {
    transientRecords: durationOf(
      'transientRecords',
      options.transientRecords ?? defaultFeedHorizon,
      durationMs(defaultFeedHorizon),
    ),
    jobHistory: durationOf('jobHistory', options.jobHistory ?? 'P7D'),
    streamTickets: durationOf('streamTickets', options.streamTickets ?? 'P1D'),
  };
  const window =
    options.window === undefined
      ? undefined
      : {
          start: minutesOf('window.start', options.window.start),
          end: minutesOf('window.end', options.window.end),
        };
  if (window !== undefined && window.start === window.end) {
    throw errors.validation('window.start and window.end differ: an empty window never runs');
  }
  /** Names this worker's holds of the lease; a new one for every worker. */
  const owner = newUuidV7();
  let context: RuntimeServiceContext | undefined;
  let stopping = false;
  /** Ends the wait for the next scheduled pass. */
  const waiting = new AbortController();
  let chain: Promise<unknown> = Promise.resolve();
  const abandoned = Promise.withResolvers<never>();
  abandoned.promise.catch(() => undefined);
  const running = new Set<Promise<unknown>>();

  /**
   * Holds the worker's units. It runs inside every unit, so work abandoned at the stop deadline
   * fails the unit, which rolls back; no unit begins once the worker stopped.
   */
  const guard: UnitGuard = (work) => {
    if (stopping) return Promise.reject(new RetentionHalted());
    const promise = work();
    running.add(promise);
    const done = (): void => {
      running.delete(promise);
    };
    promise.then(done, done);
    return Promise.race([promise, abandoned.promise]);
  };

  const insideWindow = (now: Temporal.Instant): boolean => {
    if (window === undefined) return true;
    const zoned = now.toZonedDateTimeISO('UTC');
    const minute = zoned.hour * 60 + zoned.minute;
    return window.start <= window.end
      ? minute >= window.start && minute < window.end
      : minute >= window.start || minute < window.end;
  };

  /**
   * One pass over every scope served here; the runs it recorded. It runs on the worker's lease in
   * the control store, so one process runs a pass at a time: a process that does not get the lease
   * skips the pass. A scheduled pass (`scheduled`) ends, the buffer in hand undrained, when its
   * window closes; so does any pass when it loses its lease. Each buffer of a scope runs at most
   * `maxBatchesPerPass` batches; what is left waits for the next pass.
   */
  const doPass = async (
    ctx: RuntimeServiceContext,
    scheduled: boolean,
  ): Promise<readonly RetentionRun[]> => {
    const now = ctx.clock.now();
    const recorded: RetentionRun[] = [];
    // The lease runs through the guard too: once the worker stops, not even its renewal begins.
    const guarded = guardUnits(ctx.control.adapter, guard);
    const control = createControlRetention(guarded, ctx.control.namespace);
    const lease = createConsumerLease({
      consumer: leaseName,
      source: {
        namespace: ctx.control.namespace,
        handle: { adapter: guarded },
        registry: ctx.control.registry,
      },
      owner,
      leaseMs,
      clock: ctx.clock,
      log: ctx.log,
    });
    if (stopping) throw new RetentionHalted();
    if (!(await lease.acquire())) {
      ctx.log.info('another process holds the retention lease; this pass is skipped');
      return recorded;
    }
    let over = false;
    const mayContinue = async (): Promise<boolean> => {
      if (over || stopping) return false;
      const at = ctx.clock.now();
      const open =
        (!scheduled || insideWindow(at)) &&
        (Temporal.Instant.compare(at, lease.dueAt()) < 0 || (await lease.renew()));
      if (!open) over = true;
      return open;
    };
    try {
      for await (const scope of retentionScopes(ctx, pageSize)) {
        if (stopping) throw new RetentionHalted();
        if (!(await mayContinue())) break;
        const scopeId = scope.tenantId ?? scope.backendId;
        try {
          const { run, failures } = await retainScope({
            scope,
            now,
            clock: ctx.clock,
            rules,
            batchSize,
            maxBatches,
            mayContinue,
            guard,
            ...(insideUnit === undefined ? {} : { insideUnit }),
          });
          // Logged before the run is recorded: a control store that fails to take the run must not
          // hide the failure of the buffer.
          for (const failure of failures) {
            ctx.log.error('the retention of a buffer failed; the pass goes on', {
              scopeId,
              buffer: failure.buffer,
              ...(failure.stream === undefined ? {} : { stream: failure.stream }),
              cause: failure.error,
            });
          }
          if (run !== undefined) {
            await control.record(run);
            recorded.push(run);
          }
        } catch (error) {
          if (error instanceof RetentionHalted) throw error;
          ctx.log.error('the retention of a scope failed; the pass goes on', {
            scopeId,
            cause: error,
          });
        }
      }
    } finally {
      // After a stop nothing may begin, and the lease runs out by itself.
      if (!stopping) await lease.release();
    }
    return recorded;
  };

  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work);
    chain = next.catch(() => undefined);
    return next;
  };

  const scheduledPass = (ctx: RuntimeServiceContext): Promise<unknown> =>
    insideWindow(ctx.clock.now()) ? doPass(ctx, true) : Promise.resolve();

  const logFailure = (ctx: RuntimeServiceContext, error: unknown): void => {
    if (error instanceof RetentionHalted || stopping || ctx.signal.aborted) return;
    ctx.log.error('the retention pass failed', { cause: error });
  };

  /** One scheduled pass every `intervalMs` on the runtime's timers, until the worker stops. */
  const schedule = async (ctx: RuntimeServiceContext): Promise<void> => {
    while (!stopping) {
      const next = ctx.clock.now().add({ milliseconds: intervalMs });
      if (!(await ctx.timers.sleepUntil(next, waiting.signal))) return;
      await serial(() => scheduledPass(ctx)).catch((error: unknown) => logFailure(ctx, error));
    }
  };

  /** The process stops or leaves service: no unit begins, and the one in flight is ended. */
  const halt = (): void => {
    stopping = true;
    waiting.abort();
    abandoned.reject(new RetentionHalted());
  };

  return {
    id: 'events.retention',
    roles: ['work'],
    kind: 'eventWorker',
    provides: [],
    runs: ['retention'],
    start: async (start) => {
      context = start;
      if (start.signal.aborted) halt();
      else start.signal.addEventListener('abort', halt, { once: true });
      void serial(() => scheduledPass(start)).catch((error: unknown) => logFailure(start, error));
      void schedule(start);
    },
    stop: async (deadline) => {
      stopping = true;
      waiting.abort();
      if (context !== undefined) {
        // Gives the pass in flight until the deadline on the runtime's timers, then abandons it.
        const settled = new AbortController();
        const due = context.timers.sleepUntil(deadline, settled.signal);
        await Promise.race([chain.catch(() => undefined), due]);
        settled.abort();
      }
      abandoned.reject(new RetentionHalted());
    },
    settled: async () => {
      while (running.size > 0) await Promise.allSettled([...running]);
    },
    pass: async () => {
      const ctx = context;
      if (ctx === undefined) throw errors.internal('The retention worker has not started.');
      return serial(() => doPass(ctx, false));
    },
  };
}
