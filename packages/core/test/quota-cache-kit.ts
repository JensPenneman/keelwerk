import type { ControlQuotas, QuotaRow } from '../src/control/control-quotas.ts';
import type { Logger } from '../src/observability/logger.ts';
import { createQuotaCache, type QuotaCache } from '../src/quotas/create-quota-cache.ts';
import { quotaSlotOf } from '../src/quotas/quota-slot-of.ts';
import type { QuotaView } from '../src/quotas/quota-view.ts';
import type { QuotaEntry } from '../src/registry/quota-entry.ts';
import type { Registry } from '../src/registry/registry.ts';
import type { DeploymentDefinition } from '../src/runtime/deployment-definition.ts';
import type { Scope } from '../src/storage/scope.ts';

export const notesQuota: QuotaEntry = {
  ref: 'notes.rows',
  module: 'notes',
  name: 'rows',
  kind: 'count',
  default: 50,
  level: 'tenant',
};
export const registryOf = (...entries: readonly QuotaEntry[]): Pick<Registry, 'quotas'> => ({
  quotas: new Map(entries.map((entry) => [entry.ref, entry])),
});
export const quotaTenantScope: Scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' };

/** The values of a backend reader: backend id, then dimension, then limit text. */
export type BackendValues = ReadonlyMap<string, ReadonlyMap<string, string>>;

/** The configured values of backend `b1`. */
export function backendValuesOf(values: Readonly<Record<string, string>>): BackendValues {
  return new Map([['b1', new Map(Object.entries(values))]]);
}

/** A stored quota row of backend `b1`; the row of tenant `t1` unless `tenantId` says another. */
export function storedQuotaRow(
  dimension: string,
  limit: string | null,
  extra: { readonly tenantId?: string; readonly version?: number } = {},
): QuotaRow {
  const tenantId = extra.tenantId ?? 't1';
  const slot = quotaSlotOf(dimension, 'b1', tenantId);
  return {
    id: `qta-${slot}`,
    slot,
    dimension,
    backendId: 'b1',
    tenantId,
    limit,
    version: extra.version ?? 1,
  };
}

export function quotaRig(
  initial: readonly QuotaRow[],
  queues: DeploymentDefinition['queues'] = undefined,
  initialBackend: BackendValues = new Map(),
) {
  let now = Date.parse('2026-11-19T08:00:00Z');
  let stored = initial;
  let storedBackend = initialBackend;
  let failing = false;
  let failingBackend = false;
  let loads = 0;
  let backendLoads = 0;
  let hold = false;
  let release: (() => void) | undefined;
  let releaseBackend: (() => void) | undefined;
  let waiter: (() => void) | undefined;
  let queuedWakes = 0;
  /** What a subscription to the feed does: wait for wakes, fail at once, or give one wake and end. */
  let feed: 'wait' | 'fail' | 'wake-then-end' = 'wait';
  let subscribes = 0;
  const errors: string[] = [];
  const debugged: { readonly message: string; readonly fields: unknown }[] = [];
  const log: Logger = {
    debug: (message, fields) => {
      debugged.push({ message, fields });
    },
    info: () => undefined,
    warn: () => undefined,
    error: (message) => {
      errors.push(message);
    },
    child: () => log,
  };
  const controlQuotas: ControlQuotas = {
    rows: async () => {
      loads++;
      if (hold) await new Promise<void>((resolve) => (release = resolve));
      if (failing) throw new Error('control store down');
      return stored;
    },
    changes: (signal) => ({
      [Symbol.asyncIterator]: async function* () {
        subscribes++;
        if (feed === 'fail') throw new Error('the feed is down');
        if (feed === 'wake-then-end') {
          yield 'wake';
          return;
        }
        const stop = (): void => waiter?.();
        signal.addEventListener('abort', stop);
        while (!signal.aborted) {
          if (queuedWakes === 0) await new Promise<void>((resolve) => (waiter = resolve));
          if (signal.aborted) return;
          queuedWakes -= 1;
          yield 'wake';
        }
      },
    }),
  };
  const controller = new AbortController();
  const real = createQuotaCache({
    quotas: controlQuotas,
    backendQuotas: async () => {
      backendLoads++;
      if (hold) await new Promise<void>((resolve) => (releaseBackend = resolve));
      if (failingBackend) throw new Error('backend configurations unreadable');
      return storedBackend;
    },
    queues,
    clock: { now: () => Temporal.Instant.fromEpochMilliseconds(now) },
    log,
    signal: controller.signal,
    // A factor of 1 on every pause of the feed: the jitter of `backgroundRetryMs` does not decide a case.
    random: () => 0.5,
  });
  // The cache hands out its view through `fresh()` only; the rig keeps the newest one so a case can
  // read the limits after it asked, as code in a unit does.
  let latest: QuotaView | undefined;
  const viewed = (): QuotaView => {
    if (latest === undefined) throw new Error('the case read a limit before it asked fresh()');
    return latest;
  };
  const cache: QuotaCache & QuotaView = {
    fresh: async () => {
      latest = await real.fresh();
      return latest;
    },
    firstLoad: () => real.firstLoad(),
    limitOf: (registry, scope, ref) => viewed().limitOf(registry, scope, ref),
    queueOf: (scope, queue) => viewed().queueOf(scope, queue),
  };
  return {
    cache,
    errors,
    debugged,
    loads: () => loads,
    subscribes: () => subscribes,
    feed: (value: 'wait' | 'fail' | 'wake-then-end') => {
      feed = value;
    },
    backendLoads: () => backendLoads,
    advance: (ms: number) => {
      now += ms;
    },
    set: (rows: readonly QuotaRow[]) => {
      stored = rows;
    },
    setBackend: (values: BackendValues) => {
      storedBackend = values;
    },
    fail: (value: boolean) => {
      failing = value;
    },
    failBackend: (value: boolean) => {
      failingBackend = value;
    },
    wake: () => {
      queuedWakes += 1;
      waiter?.();
    },
    hold: (value: boolean) => {
      hold = value;
    },
    release: () => {
      release?.();
      releaseBackend?.();
    },
    stop: () => controller.abort(),
  };
}
