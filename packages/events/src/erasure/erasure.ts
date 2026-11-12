import type {
  ErasureCompletedRecord,
  ErasureRecord,
  RuntimeServiceContext,
  UnitGuard,
} from '@keelwerk/core';
import { erasureKey, errors } from '@keelwerk/core';
import { createCompletions } from './create-completions.ts';
import { ErasureHalted } from './erasure-halted.ts';
import type { ErasureOptions } from './erasure-options.ts';
import { erasureTarget } from './erasure-target.ts';
import type { ErasureWorker } from './erasure-worker.ts';
import { isErasureFinished } from './is-erasure-finished.ts';
import { readErasureLedger } from './read-erasure-ledger.ts';
import { runErasure } from './run-erasure.ts';

const defaultPollMs = 1000;
const defaultPageSize = 100;
const ledgerPage = 500;

function integerAtLeast(name: string, value: number, least: number): number {
  if (!Number.isInteger(value) || value < least) {
    throw errors.validation(`${name} is a whole number of at least ${least}`);
  }
  return value;
}

/**
 * The event worker that runs erasures (`runs: ['erasure']`, section 14.7.5): a start pass over the
 * whole union of the control ledger and the sinks, which finishes every record that has no
 * completion in the control ledger (a completion that stands after the record, of the tenant's
 * current epoch, with no key of the subject destroyed after it: a restore rewinds the placement and
 * the erasure is run again, 14.7.6); then it follows `control.ledger.since(last seq)` every
 * `pollMs` and retries what failed. A pass reads the control ledger once, however many erasures
 * there are. Every identity here is `erasureKey` (tenant, command id and subject): a command id is
 * unique in one scope only. Stopping halts between units; a unit still running at the deadline is ended,
 * so abandoned work writes nothing, and the record is finished by the next start pass.
 */
export function erasure(options: ErasureOptions = {}): ErasureWorker {
  const pollMs = integerAtLeast('pollMs', options.pollMs ?? defaultPollMs, 1);
  const pageSize = integerAtLeast('pageSize', options.pageSize ?? defaultPageSize, 1);
  let context: RuntimeServiceContext | undefined;
  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSeq = 0n;
  let chain: Promise<unknown> = Promise.resolve();
  /** The completions of the control ledger, fed by every pass and every poll page, kept for the worker's life. */
  const completions = createCompletions();
  const finished = new Set<string>();
  const retry = new Map<string, ErasureRecord>();
  /** The key ids the control ledger holds a tombstone for: read at the start, kept up by the poll. */
  const tombstoned = new Set<string>();
  const abandoned = Promise.withResolvers<never>();
  abandoned.promise.catch(() => undefined);

  const running = new Set<Promise<unknown>>();

  /**
   * Holds the worker's units. It runs inside every unit, so work abandoned at the stop deadline
   * fails the unit, which rolls back; no unit begins once the worker stopped.
   */
  const guard: UnitGuard = (work) => {
    if (stopping) return Promise.reject(new ErasureHalted());
    const promise = work();
    running.add(promise);
    const done = (): void => {
      running.delete(promise);
    };
    promise.then(done, done);
    return Promise.race([promise, abandoned.promise]);
  };

  /** Finishes one record; answers whether it is finished here. */
  const finish = async (
    ctx: RuntimeServiceContext,
    record: ErasureRecord,
    completed: readonly ErasureCompletedRecord[],
  ): Promise<boolean> => {
    const key = erasureKey(record);
    if (finished.has(key)) return false;
    try {
      const found = await erasureTarget(ctx, record);
      if (
        found === undefined ||
        !(await isErasureFinished(ctx, found, record, completed, options.epochOf))
      ) {
        await runErasure(ctx, record, {
          pageSize,
          tombstoned,
          ...(options.afterStep === undefined ? {} : { afterStep: options.afterStep }),
          ...(options.insideStep === undefined ? {} : { insideStep: options.insideStep }),
          ...(options.epochOf === undefined ? {} : { epochOf: options.epochOf }),
          guard,
        });
      }
      finished.add(key);
      retry.delete(key);
      return true;
    } catch (error) {
      if (!(error instanceof ErasureHalted)) {
        retry.set(key, record);
        ctx.log.error('an erasure could not be finished; it is tried again', {
          commandId: record.commandId,
          cause: error,
        });
      }
      return false;
    }
  };

  /** One pass: reads the control ledger once, then finishes each record that has no completion. */
  const doPass = async (ctx: RuntimeServiceContext): Promise<number> => {
    const ledger = await readErasureLedger(ctx, completions);
    for (const keyId of ledger.tombstoned) tombstoned.add(keyId);
    if (ledger.lastSeq > lastSeq) lastSeq = ledger.lastSeq;
    let count = 0;
    for (const record of ledger.records) {
      if (stopping) break;
      if (await finish(ctx, record, completions.of(record))) count += 1;
    }
    return count;
  };

  /**
   * The records appended since the last read, then what failed before. It reads every page up to
   * the head and feeds the completions and the tombstones first, and only then finishes the
   * erasure records it found: a record and its completion may stand on different pages (more than
   * a page apart, or the start pass failed before it read them), and an erasure must never run
   * again for a completion that lies a page later. The cursor moves only when the whole read
   * succeeded; reading a page again is harmless.
   */
  const doPoll = async (ctx: RuntimeServiceContext): Promise<number> => {
    let count = 0;
    let after = lastSeq;
    const found: ErasureRecord[] = [];
    for (;;) {
      const page = await ctx.control.ledger.since(after, ledgerPage);
      const last = page.at(-1);
      if (last === undefined) break;
      after = last.seq;
      for (const { record } of page) {
        completions.observe(record);
        if (record.type === 'keyTombstone') tombstoned.add(record.keyId);
        if (record.type === 'erasure') found.push(record);
      }
    }
    lastSeq = after;
    for (const record of found) {
      if (!stopping && (await finish(ctx, record, completions.of(record)))) count += 1;
    }
    for (const record of [...retry.values()]) {
      if (!stopping && (await finish(ctx, record, completions.of(record)))) count += 1;
    }
    return count;
  };

  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work);
    chain = next.catch(() => undefined);
    return next;
  };

  const schedule = (ctx: RuntimeServiceContext): void => {
    if (stopping) return;
    timer = setTimeout(() => {
      serial(() => doPoll(ctx))
        .catch((error: unknown) => {
          ctx.log.error('the erasure worker could not read the ledger', { cause: error });
        })
        .finally(() => schedule(ctx));
    }, pollMs);
    timer.unref();
  };

  return {
    id: 'events.erasure',
    roles: ['work'],
    kind: 'eventWorker',
    provides: [],
    runs: ['erasure'],
    start: async (start) => {
      context = start;
      await serial(() => doPass(start)).catch((error: unknown) => {
        start.log.error('the erasure start pass failed', { cause: error });
      });
      schedule(start);
    },
    stop: async (deadline) => {
      stopping = true;
      if (timer !== undefined) clearTimeout(timer);
      const left = Math.max(0, deadline.epochMilliseconds - Date.now());
      let giveUp: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        chain.catch(() => undefined),
        new Promise<void>((resolve) => {
          giveUp = setTimeout(resolve, left);
        }),
      ]);
      clearTimeout(giveUp);
      abandoned.reject(new ErasureHalted());
    },
    settled: async () => {
      while (running.size > 0) await Promise.allSettled([...running]);
    },
    pass: async () => {
      const ctx = context;
      if (ctx === undefined) throw errors.internal('The erasure worker has not started.');
      return serial(() => doPass(ctx));
    },
  };
}
