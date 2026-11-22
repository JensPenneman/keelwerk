import type { ControlQuotas, QuotaRow } from '../control/control-quotas.ts';
import { errors } from '../errors/errors.ts';
import { targetingMostOpenReads } from '../flags/targeting-most-open-reads.ts';
import { targetingReadTimeoutMs } from '../flags/targeting-read-timeout-ms.ts';
import { targetingRefreshMs } from '../flags/targeting-refresh-ms.ts';
import { targetingResubscribeMaxMs } from '../flags/targeting-resubscribe-max-ms.ts';
import { targetingResubscribeMs } from '../flags/targeting-resubscribe-ms.ts';
import type { Clock } from '../kernel/clock.ts';
import type { Logger } from '../observability/logger.ts';
import type { DeploymentDefinition } from '../runtime/deployment-definition.ts';
import { withinSignal } from '../schedules/within-signal.ts';
import type { Scope } from '../storage/scope.ts';
import type { QueueLimits } from './queue-limits.ts';
import { queueMemberBounds } from './queue-member-bounds.ts';
import { queueQuotaEntry } from './queue-quota-entry.ts';
import type { QuotaLimits } from './quota-limits.ts';
import { resolveLimits } from './resolve-limits.ts';

/** The most rows a load names in its debug record (those new or changed since the load before). */
const loadedRowsLogged = 50;

/** What the cache is built from. */
export interface QuotaCacheOptions {
  readonly quotas: ControlQuotas;
  /** The quota values of every backend, by backend id and dimension (`readBackendQuotas`). */
  readonly backendQuotas: () => Promise<ReadonlyMap<string, ReadonlyMap<string, string>>>;
  readonly queues: DeploymentDefinition['queues'];
  readonly clock: Clock;
  readonly log: Logger;
  readonly signal: AbortSignal;
}

/**
 * The quota rows and the backends' configured values in memory, refreshed when the control namespace's feed wakes and, with the feed
 * down or behind, by age: a lowered quota is served for at most `targetingRefreshMs` plus one read
 * of the control store. Both are read together and swapped together, or not at all. Until a load
 * succeeds the declared defaults serve; after it, rows and values that can no longer be read keep
 * serving for good, because falling back to the defaults could raise a limit an operator lowered.
 * Nothing runs before the first `fresh()`.
 */
export function createQuotaCache(options: QuotaCacheOptions): QuotaLimits {
  const { quotas, queues, clock, log } = options;
  let rows: ReadonlyMap<string, QuotaRow> = new Map();
  let backendQuotas: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map();
  let loaded = false;
  let loadedAt = 0;
  let failedAt: number | null = null;
  let inFlight: Promise<void> | undefined;
  let again = false;
  /** Reads handed to the store that have not settled, also those the cache stopped waiting for. */
  let openReads = 0;
  let following = false;
  const reported = new Set<string>();

  const now = (): number => clock.now().epochMilliseconds;

  const skipped = (row: QuotaRow, error: unknown): void => {
    const mark = `${row.id}:${row.version}`;
    if (reported.has(mark)) return;
    reported.add(mark);
    log.error('a stored quota row cannot be used; the row is ignored', {
      row: row.id,
      version: row.version,
      cause: error,
    });
  };

  const skippedValue = (backendId: string, dimension: string, error: unknown): void => {
    const mark = `${backendId}:${dimension}:${backendQuotas.get(backendId)?.get(dimension)}`;
    if (reported.has(mark)) return;
    reported.add(mark);
    log.error('a configured quota limit of a backend does not parse; the value is ignored', {
      backend: backendId,
      dimension,
      cause: error,
    });
  };

  /**
   * One read of the rows and of the backends' values, started together and counted until both
   * settle, however late.
   */
  const read = (): Promise<{
    readonly stored: readonly QuotaRow[];
    readonly configured: ReadonlyMap<string, ReadonlyMap<string, string>>;
  }> => {
    openReads += 1;
    const pair = [(async () => quotas.rows())(), (async () => options.backendQuotas())()] as const;
    void Promise.allSettled(pair).then(() => {
      openReads -= 1;
    });
    return Promise.all(pair).then(([stored, configured]) => ({ stored, configured }));
  };

  const attempt = async (): Promise<void> => {
    // Reads that timed out are still running in the adapter: no new one while two are open.
    if (openReads >= targetingMostOpenReads) return;
    const started = now();
    try {
      const { stored, configured } = await withinSignal(
        read(),
        AbortSignal.timeout(targetingReadTimeoutMs),
      );
      const next = new Map<string, QuotaRow>();
      for (const row of stored) {
        if (row.tenantId === null) {
          skipped(row, errors.internal('A core.quota row names no tenant.'));
        } else {
          next.set(row.slot, row);
        }
      }
      const changed = [...next.values()]
        .filter((row) => rows.get(row.slot)?.version !== row.version)
        .slice(0, loadedRowsLogged)
        .map(({ id, version }) => ({ id, version }));
      rows = next;
      backendQuotas = configured;
      loaded = true;
      loadedAt = started;
      failedAt = null;
      log.debug('the quota rows were loaded', { rows: next.size, changed });
    } catch (error) {
      failedAt = now();
      log.error('the quota rows could not be loaded; the last rows keep serving', {
        cause: error,
      });
    }
  };

  /** One load at a time; a wake during a load reruns it once afterwards. Never rejects. */
  const load = (fromWake: boolean): Promise<void> => {
    if (inFlight !== undefined) {
      if (fromWake) again = true;
      return inFlight;
    }
    // The marker is cleared in the step of the loop's last check, so no wake lands between them.
    const run = (async (): Promise<void> => {
      try {
        do {
          again = false;
          await attempt();
        } while (again);
      } finally {
        inFlight = undefined;
      }
    })();
    inFlight = run;
    return run;
  };

  /** Resolves after `ms`, or when `signal` aborts. */
  const pause = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal.addEventListener('abort', done);
    });

  /**
   * Follows the feed until `signal` aborts. A feed that fails or ends is subscribed again after a
   * wait (the first wait doubles with each failure up to `targetingResubscribeMaxMs`, and starts
   * over once a wake came or the subscription lived that long), and the rows are loaded once for
   * what the gap may have missed.
   */
  const follow = async (signal: AbortSignal): Promise<void> => {
    let wait = targetingResubscribeMs;
    for (let resubscribed = false; !signal.aborted; resubscribed = true) {
      if (resubscribed) void load(true);
      const subscribedAt = now();
      try {
        for await (const _wake of quotas.changes(signal)) {
          wait = targetingResubscribeMs;
          void load(true);
        }
        if (!signal.aborted) log.error('the quota change feed ended; it is subscribed again');
      } catch (error) {
        if (!signal.aborted) {
          log.error('the quota change feed failed; it is subscribed again', { cause: error });
        }
      }
      if (now() - subscribedAt >= targetingResubscribeMaxMs) wait = targetingResubscribeMs;
      await pause(wait, signal);
      wait = Math.min(wait * 2, targetingResubscribeMaxMs);
    }
  };

  /** Awaits a load, but never longer than the read bound. */
  const awaitLoad = async (pending: Promise<void>): Promise<void> => {
    try {
      await withinSignal(pending, AbortSignal.timeout(targetingReadTimeoutMs));
    } catch {
      // The load is still running or has failed and logged; the caller goes on.
    }
  };

  const queueMember = (scope: Scope, queue: string, member: keyof QueueLimits): number => {
    const limit = resolveLimits({
      entry: queueQuotaEntry(queue, member, queues),
      scope,
      rows,
      backendQuotas,
      skipped,
      skippedValue,
    });
    if (limit.kind === 'rate') throw errors.internal(`The queue limit ${member} is a rate.`);
    if (member === 'queued') return limit.value;
    // A stored row or configured value outside what the queue lanes can hold is clamped, never passed on.
    return Math.min(
      Math.max(
        limit.value,
        member === 'weight' ? queueMemberBounds.minWeight : queueMemberBounds.minCap,
      ),
      queueMemberBounds.max,
    );
  };

  return {
    limitOf: (registry, scope, ref) => {
      const entry = registry.quotas.get(ref);
      if (entry === undefined) throw errors.internal(`The registry declares no quota ${ref}.`);
      return resolveLimits({ entry, scope, rows, backendQuotas, skipped, skippedValue });
    },
    queueOf: (scope, queue) => ({
      running: queueMember(scope, queue, 'running'),
      queued: queueMember(scope, queue, 'queued'),
      weight: queueMember(scope, queue, 'weight'),
    }),
    fresh: async () => {
      if (!following) {
        following = true;
        void follow(options.signal);
      }
      if (!loaded) {
        if (inFlight === undefined && failedAt !== null && now() - failedAt < targetingRefreshMs)
          return;
        await awaitLoad(load(false));
        return;
      }
      if (now() - loadedAt < targetingRefreshMs) return;
      if (inFlight !== undefined) return;
      if (failedAt !== null && now() - failedAt < targetingRefreshMs) return;
      await awaitLoad(load(false));
    },
  };
}
