import type { LiveKernel, LiveView, Position, StorageRow, Unit } from '@keelwerk/core';
import { errors, type KeelwerkError } from '@keelwerk/core';
import { askEarlier } from './ask-earlier.ts';
import type { BatchEarlier } from './batch-earlier.ts';
import { guardedPass } from './guarded-pass.ts';
import { loadPostImages } from './load-post-images.ts';
import { logCodeOf } from './log-code-of.ts';
import type { PassState } from './pass-state.ts';
import { planGroupKey } from './plan-group-key.ts';
import { planVerdicts } from './plan-verdicts.ts';
import { readPassEvents } from './read-pass-events.ts';
import type { ReaderBatch } from './reader-batch.ts';
import type { ReaderEntry } from './reader-entry.ts';
import type { ReaderListener } from './reader-listener.ts';
import type { ResolvedHubLimits } from './resolve-hub-limits.ts';

/** A pass that fails this many times in a row ends every listener of the scope. */
const failuresAllowed = 3;

/** What every refused attach tells the caller: nothing of the bound that applied or of anyone else's load. */
const refusal = 'Live updates are not available now.';

/** What one scope's reader is built from. */
export interface ScopeReaderInput {
  /** The kernel of the first listener: it names the scope and gives the pass its units. */
  readonly kernel: LiveKernel;
  readonly limits: ResolvedHubLimits;
  /** Registers a wake-up of the scope; answers how to unregister. */
  readonly onWake: (wake: () => void) => () => void;
  /** The reader has stopped: its owner forgets it. */
  readonly onStop: () => void;
}

/** The reader of one scope (15.2.5, 15.4.9). */
export interface ScopeReader {
  /** Adds a listener and triggers a pass; the answer removes it. */
  attach(kernel: LiveKernel, listener: ReaderListener): () => void;
  readonly size: number;
  /**
   * The hub is closing: every listener still attached is ended through `end()`, the timer and the
   * wake-up stop, and the pass in flight is aborted. Nothing is delivered afterwards.
   */
  close(): void;
  /** Resolves when the pass loop has ended and every unit the reader opened has settled. */
  settled(): Promise<void>;
}

/**
 * One scope's loop (15.2.5, 15.4.9, D2). It starts with its first listener and stops with its last.
 * A pass runs in one read-only unit that is raced against a deadline: it reads the head, joins the
 * listeners that attached since the last pass, reads the events after its position up to the head,
 * loads the post-images once, evaluates every distinct plan once, lets the listeners with a partial
 * set name the streams they cannot decide (D6), asks each plan group once what the plan selected at
 * the start of the batch for the union of those streams (never once for each listener), and only
 * after the unit closed hands the batch to every listener, synchronously and without awaiting any
 * of them. Passes never overlap; a wake-up during a pass asks for another. A pass past its deadline
 * delivers nothing; its late rejection is caught and logged once; three failed passes in a row end
 * every listener with `unavailable`. A reader serves the subscriptions of one tenant, so a tenant's
 * load and failures stay its own.
 */
export function createScopeReader(input: ScopeReaderInput): ScopeReader {
  const { limits } = input;
  const { log, scopeId } = input.kernel;
  const entries: ReaderEntry[] = [];
  let position: Position | undefined;
  let running = false;
  let again = false;
  let started = false;
  let stopped = false;
  let closed = false;
  let failures = 0;
  /** The head the last read saw: a batch that ends below it leaves more to read at once. */
  let lastHead: Position = 0n;
  let timer: ReturnType<typeof setInterval> | undefined;
  let unwake: (() => void) | undefined;
  let loop: Promise<void> = Promise.resolve();
  /** The pass in flight (closing aborts it) and the units the reader opened that have not settled, those of abandoned passes included. */
  const state: PassState = { current: undefined, units: new Set<Promise<void>>() };

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) clearInterval(timer);
    unwake?.();
    input.onStop();
  };

  const endReaderEntry = (entry: ReaderEntry, error: KeelwerkError): void => {
    entry.active = false;
    try {
      entry.listener.fail(error);
    } catch (cause) {
      log.warn('a live listener failed while it was told to end', {
        scope: scopeId,
        cause: logCodeOf(cause),
      });
    }
  };

  const failAll = (error: KeelwerkError): void => {
    for (const entry of entries.splice(0)) endReaderEntry(entry, error);
    stop();
  };

  /** The work of one pass inside its unit. */
  const read = async (
    unit: Unit,
    expired: () => void,
    carried: readonly ReaderEntry[],
    joining: readonly ReaderEntry[],
  ): Promise<ReaderBatch> => {
    const head = (await unit.events.head()) ?? 0n;
    expired();
    position ??= head;
    const from = position;
    lastHead = head;
    for (const entry of joining) {
      entry.joined = true;
      try {
        entry.listener.join(head);
      } catch (cause) {
        log.warn('a live listener failed while it joined', {
          scope: scopeId,
          cause: logCodeOf(cause),
        });
      }
    }
    const kernels = new Map<string, LiveKernel>();
    const views = new Map<ReaderEntry, LiveView>();
    let viewless = false;
    for (const entry of [...carried, ...joining]) {
      const { view } = entry.listener;
      if (view === undefined) viewless = true;
      else {
        kernels.set(entry.kernel.entity, entry.kernel);
        views.set(entry, view);
      }
    }
    const { events, to } = await readPassEvents({
      unit,
      expired,
      from,
      head,
      batchSize: limits.batchSize,
      streamTypes: viewless ? undefined : [...kernels.keys()],
    });
    const changed = new Map<string, Set<string>>();
    for (const event of events) {
      if (!kernels.has(event.stream.type)) continue;
      const ids = changed.get(event.stream.type) ?? new Set<string>();
      ids.add(event.stream.id);
      changed.set(event.stream.type, ids);
    }
    const rows = new Map<string, Map<string, StorageRow | undefined>>();
    for (const [entity, ids] of changed) {
      const kernel = kernels.get(entity);
      if (kernel === undefined) continue;
      const loaded = await loadPostImages(unit, kernel.descriptor, [...ids]);
      expired();
      rows.set(entity, new Map([...ids].map((id) => [id, loaded.get(id)])));
    }
    const verdicts = await planVerdicts(
      unit,
      expired,
      carried.flatMap((entry) => {
        const view = views.get(entry);
        return view === undefined ? [] : [view];
      }),
      rows,
    );
    const earlier = new Map<string, BatchEarlier>();
    const batch: ReaderBatch = { from, to, events, rows, verdicts, earlier };
    if (events.length > 0) {
      await askEarlier({ unit, expired, carried, views, batch, earlier, limits, log, scopeId });
    }
    return batch;
  };

  const pass = async (): Promise<void> => {
    const carried = entries.filter((entry) => entry.joined);
    const joining = entries.filter((entry) => !entry.joined);
    const [first] = [...carried, ...joining];
    if (first === undefined) return;
    try {
      const batch = await guardedPass({
        kernel: first.kernel,
        limits,
        log,
        scopeId,
        listeners: () => entries.length,
        state,
        work: (unit, expired) => read(unit, expired, carried, joining),
      });
      if (closed) return;
      position = batch.to;
      failures = 0;
      if (batch.to < lastHead) again = true;
      if (batch.events.length === 0) return;
      for (const entry of carried) {
        if (!entry.active) continue;
        try {
          entry.listener.deliver(batch);
        } catch (cause) {
          log.warn('a live listener threw while it was given a batch', {
            scope: scopeId,
            code: logCodeOf(cause),
          });
        }
      }
    } catch (error) {
      if (closed) return;
      failures += 1;
      log.warn('a live reader pass failed', {
        scope: scopeId,
        code: logCodeOf(error),
        failures,
        listeners: entries.length,
      });
      if (failures >= failuresAllowed) {
        failAll(errors.unavailable('The live stream is not available now.'));
      }
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    loop = (async () => {
      try {
        do {
          again = false;
          await pass();
        } while (again && !stopped && entries.length > 0);
      } finally {
        running = false;
      }
    })();
  };

  const refuse = (bound: string, count: number, limit: number): KeelwerkError => {
    log.warn('a live subscription was refused', { scope: scopeId, bound, count, limit });
    return errors.unavailable(refusal);
  };

  return {
    attach: (kernel, listener) => {
      if (stopped) throw errors.unavailable(refusal);
      if (entries.length >= limits.maxSubscribersPerScope) {
        throw refuse('subscribers of the scope', entries.length, limits.maxSubscribersPerScope);
      }
      const group = listener.view === undefined ? undefined : planGroupKey(listener.view);
      if (group !== undefined && !entries.some((entry) => entry.group === group)) {
        const distinct = new Set(entries.flatMap((entry) => entry.group ?? []));
        if (distinct.size >= limits.maxPlanGroupsPerScope) {
          throw refuse('plan groups of the scope', distinct.size, limits.maxPlanGroupsPerScope);
        }
      }
      const entry: ReaderEntry = { listener, kernel, group, joined: false, active: true };
      entries.push(entry);
      if (!started) {
        started = true;
        unwake = input.onWake(schedule);
        timer = setInterval(schedule, limits.pollMs);
        timer.unref();
      }
      schedule();
      return () => {
        if (!entry.active) return;
        entry.active = false;
        const at = entries.indexOf(entry);
        if (at >= 0) entries.splice(at, 1);
        if (entries.length === 0) stop();
      };
    },
    get size() {
      return entries.length;
    },
    close: () => {
      if (closed) return;
      closed = true;
      const ending = entries.splice(0);
      stop();
      state.current?.abort();
      for (const entry of ending) {
        entry.active = false;
        try {
          entry.listener.end();
        } catch (cause) {
          log.warn('a live listener failed while it was told to end', {
            scope: scopeId,
            cause: logCodeOf(cause),
          });
        }
      }
    },
    settled: async () => {
      await loop;
      while (state.units.size > 0) await Promise.all([...state.units]);
    },
  };
}
