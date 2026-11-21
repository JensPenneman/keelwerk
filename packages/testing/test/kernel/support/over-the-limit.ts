import type { DataAdapter, Logger, NamespaceRef, Registry, Scope } from '@keelwerk/core';
import { expect } from 'vitest';
import { setQuota } from './quota-kit.ts';
import { type StoredRecords, storedRecords } from './stored-bytes.ts';

/** The limit of both dimensions of the tenant: 1 row and 1 byte, set with `core.quota.set`. */
const limits = { 'core.rows': '1', 'core.eventBytes': '1' } as const;

/**
 * The loads of the quota cache, seen through the logger the runtime of a case was started with
 * (`startTestRuntime({ logger })`): the cache logs each load with the rows that are new or changed.
 * `loaded` settles when a load has put that row at that version or later into the cache.
 */
export interface QuotaLoads {
  readonly logger: Logger;
  loaded(id: string, version: number): Promise<void>;
}

/** A logger for the runtime of a case that records which quota rows the cache has loaded. */
export function watchQuotaLoads(): QuotaLoads {
  const seen = new Map<string, number>();
  const waiting = new Set<{ id: string; version: number; done: () => void }>();
  const logger: Logger = {
    debug: (message, fields) => {
      if (message !== 'the quota rows were loaded') return;
      const changed = (fields?.changed ?? []) as readonly { id: string; version: number }[];
      for (const { id, version } of changed) seen.set(id, Math.max(version, seen.get(id) ?? 0));
      for (const waiter of waiting) {
        if ((seen.get(waiter.id) ?? 0) >= waiter.version) {
          waiting.delete(waiter);
          waiter.done();
        }
      }
    },
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
  };
  return {
    logger,
    loaded: (id, version) =>
      (seen.get(id) ?? 0) >= version
        ? Promise.resolve()
        : new Promise((done) => waiting.add({ id, version, done })),
  };
}

/** What the runtime of a case offers to put its tenant over the limits and read the store back. */
export interface OverTheLimit {
  readonly runtime: {
    readonly invoker: Parameters<typeof setQuota>[0]['invoker'];
    readonly adapter: DataAdapter;
    readonly namespace: NamespaceRef;
    readonly backendId: string;
    readonly app: { readonly registry: Registry };
  };
  readonly scope: Scope;
  /** The loads of the quota cache of the runtime, which was started with `loads.logger`. */
  readonly loads: QuotaLoads;
  /** A command of a caller that stores at least one record. */
  readonly grow: () => Promise<{
    readonly ok: boolean;
    readonly error?: { readonly code: string };
  }>;
}

/** Reads the tenant's counter and the same measure recomputed from the records it holds. */
export function readStore(over: OverTheLimit): Promise<StoredRecords> {
  const { runtime, scope } = over;
  return storedRecords(runtime.adapter, runtime.namespace, scope, runtime.app.registry);
}

/**
 * Puts the tenant over both limits the way an operator does: the counters of `core.rows` and
 * `core.eventBytes` hold what earlier commands stored (each above 1), and `core.quota.set` lowers
 * the limits of the tenant to 1, below them. Returns once the quota cache of the runtime has
 * loaded both rows (it logs each load, `watchQuotaLoads`), and then asserts that a caller's
 * command is refused: the cache serves the limits only after its own load, which the feed
 * starts in the background, so nothing here waits for a time to pass.
 */
export async function putOverTheLimits(over: OverTheLimit): Promise<void> {
  if (over.scope.level !== 'tenant') throw new Error('the limits are those of a tenant');
  const { tenantId } = over.scope;
  // A second command, so that both counters stand above the limit of 1 before it is set.
  expect((await over.grow()).ok).toBe(true);
  const before = await readStore(over);
  expect(before.counted).toBeGreaterThan(1n);
  expect(before.rows).toBeGreaterThan(1n);
  const loaded: Promise<void>[] = [];
  for (const [dimension, limit] of Object.entries(limits)) {
    const set = await setQuota(over.runtime, {
      dimension,
      backendId: over.runtime.backendId,
      tenantId,
      limit,
      reason: 'over the limit',
    });
    if (!set.ok) throw set.error;
    loaded.push(over.loads.loaded(set.value.id, set.value.version));
  }
  await Promise.all(loaded);
  expect((await over.grow()).error?.code).toBe('core.quota_exceeded');
}

/**
 * What a unit of the framework did over the limits: it committed, the counter stands above its
 * limit, and the records it stored are counted as the framework measures them (the counter equals
 * the measure recomputed from the store). Returns the bytes the unit added to the counter.
 */
export async function expectCountedAbove(
  over: OverTheLimit,
  before: StoredRecords,
): Promise<bigint> {
  const after = await readStore(over);
  expect(after.counted).toBeGreaterThan(1n);
  expect(after.counted).toBe(after.stored);
  expect(after.counted - before.counted).toBe(after.stored - before.stored);
  return after.counted - before.counted;
}
