import type { ErasureRecord, RuntimeServiceContext, UnitGuard } from '@keelwerk/core';
import { erasureKey, errors } from '@keelwerk/core';
import { ErasureHalted } from './erasure-halted.ts';
import type { ErasureOptions } from './erasure-options.ts';
import { erasureTarget } from './erasure-target.ts';
import type { ErasureWorker } from './erasure-worker.ts';
import { isErasureFinished } from './is-erasure-finished.ts';
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
 * erasure records of the control ledger that have no completion at their tenant's current epoch
 * (`control.ledger.unfinished`, paged; a restore made `connect` bump the epoch and so brings every
 * completed erasure of that tenant back here, 14.7.6), which finishes each of them; then it follows
 * `control.ledger.since(head)` every `pollMs` for new records and retries what failed. The start pass
 * reads no sink: the union with the sinks was made at `connect`, before any worker started. A
 * boot costs one read of the unfinished records, however many erasures were ever made. Every identity
 * here is `erasureKey` (tenant, command id and subject): a command id is unique in one scope only.
 * Stopping halts between units; a unit still running at the deadline is ended, so abandoned work
 * writes nothing, and the record is finished by the next start pass.
 */
export function erasure(options: ErasureOptions = {}): ErasureWorker {
  const pollMs = integerAtLeast('pollMs', options.pollMs ?? defaultPollMs, 1);
  const pageSize = integerAtLeast('pageSize', options.pageSize ?? defaultPageSize, 1);
  let context: RuntimeServiceContext | undefined;
  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSeq = 0n;
  let chain: Promise<unknown> = Promise.resolve();
  const finished = new Set<string>();
  /** The records this process has logged as unfinished: a standing condition is logged once per record, doctor shows it after that. */
  const logged = new Set<string>();
  const retry = new Map<string, { readonly record: ErasureRecord; readonly seq: bigint }>();
  /** The scope and key id pairs, and scope, key id and command triples, this process has seen the control ledger and every sink take a tombstone for. */
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
    seq: bigint,
  ): Promise<boolean> => {
    const key = erasureKey(record);
    if (finished.has(key)) return false;
    try {
      const found = await erasureTarget(ctx, record);
      if ('unserved' in found) {
        // A tenant of a placement this process does not open, or whose backend it does not open, is
        // another process's: as before, it is left to that process. A tenant nobody knows is not
        // done: it stays in the retry set.
        if ((await ctx.archivedDirectory.tenant(record.tenantId)) !== undefined) {
          ctx.log.warn(
            found.unserved === 'backend'
              ? 'an erasure record names a tenant whose backend this process does not serve'
              : 'an erasure record names a tenant this process does not serve',
            { commandId: record.commandId },
          );
          finished.add(key);
          return true;
        }
        if (!logged.has(key)) {
          logged.add(key);
          ctx.log.warn('an erasure record names a tenant nobody knows; it is tried again', {
            commandId: record.commandId,
          });
        }
        retry.set(key, { record, seq });
        return false;
      }
      if (!(await isErasureFinished(ctx, found, record, seq))) {
        await runErasure(ctx, record, found, {
          pageSize,
          tombstoned,
          ...(options.afterStep === undefined ? {} : { afterStep: options.afterStep }),
          ...(options.insideStep === undefined ? {} : { insideStep: options.insideStep }),
          guard,
        });
      }
      finished.add(key);
      retry.delete(key);
      logged.delete(key);
      return true;
    } catch (error) {
      if (!(error instanceof ErasureHalted)) {
        retry.set(key, { record, seq });
        if (!logged.has(key)) {
          logged.add(key);
          ctx.log.error('an erasure could not be finished; it is tried again', {
            commandId: record.commandId,
            cause: error,
          });
        }
      }
      return false;
    }
  };

  /** One pass: finishes each erasure record that has no completion at its tenant's epoch, page by page. */
  const doPass = async (ctx: RuntimeServiceContext): Promise<number> => {
    let count = 0;
    let after = 0n;
    for (;;) {
      const page = await ctx.control.ledger.unfinished({
        epochs: ctx.control.epochs(),
        after,
        limit: ledgerPage,
      });
      // The first read's head is where the poll starts: whatever is appended later it reads itself.
      if (after === 0n && page.head > lastSeq) lastSeq = page.head;
      for (const { record, seq } of page.erasures) {
        if (stopping) return count;
        if (await finish(ctx, record, seq)) count += 1;
      }
      const last = page.erasures.at(-1);
      if (last === undefined || page.erasures.length < ledgerPage) return count;
      after = last.seq;
    }
  };

  /**
   * The erasure records appended since the last read, then what failed before. It reads every page
   * up to the head and only then finishes the records it found; the cursor moves once, after the
   * whole read succeeded (reading a page again is harmless). Whether a record is finished is asked of
   * the ledger by one indexed lookup of its completions.
   */
  const doPoll = async (ctx: RuntimeServiceContext): Promise<number> => {
    let count = 0;
    let after = lastSeq;
    const found: { readonly record: ErasureRecord; readonly seq: bigint }[] = [];
    for (;;) {
      const page = await ctx.control.ledger.since(after, ledgerPage);
      const last = page.at(-1);
      if (last === undefined) break;
      after = last.seq;
      for (const { seq, record } of page) {
        if (record.type === 'erasure') found.push({ record, seq });
      }
    }
    lastSeq = after;
    for (const { record, seq } of found) {
      if (!stopping && (await finish(ctx, record, seq))) count += 1;
    }
    for (const { record, seq } of [...retry.values()]) {
      if (!stopping && (await finish(ctx, record, seq))) count += 1;
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

  /** The process stops or leaves service: no unit begins, and the one in flight is ended. */
  const halt = (): void => {
    stopping = true;
    if (timer !== undefined) clearTimeout(timer);
    abandoned.reject(new ErasureHalted());
  };

  return {
    id: 'events.erasure',
    roles: ['work'],
    kind: 'eventWorker',
    provides: [],
    runs: ['erasure'],
    start: async (start) => {
      context = start;
      if (start.signal.aborted) halt();
      else start.signal.addEventListener('abort', halt, { once: true });
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
