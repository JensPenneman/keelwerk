import type { FlagResolution } from '../contexts/flag-resolution.ts';
import type { ControlFlags } from '../control/control-flags.ts';
import type { Clock } from '../kernel/clock.ts';
import type { Logger } from '../observability/logger.ts';
import { checkFlagValues } from './check-flag-values.ts';
import { compileFlagRow } from './compile-flag-row.ts';
import type { CompiledFlagRow } from './compiled-flag-row.ts';
import { defaultFlagResolution } from './default-flag-resolution.ts';
import { evaluateTargeting } from './evaluate-targeting.ts';
import type { FlagContext } from './flag-context.ts';
import { flagKeyPattern } from './flag-key-pattern.ts';
import type { FlagProvider } from './flag-provider.ts';
import { flagSlotOf } from './flag-slot-of.ts';
import type { FlagSpec } from './flag-spec.ts';
import { targetingMostOpenReads } from './targeting-most-open-reads.ts';
import { targetingReadTimeoutMs } from './targeting-read-timeout-ms.ts';
import { targetingRefreshMs } from './targeting-refresh-ms.ts';
import { targetingResubscribeMaxMs } from './targeting-resubscribe-max-ms.ts';
import { targetingResubscribeMs } from './targeting-resubscribe-ms.ts';
import { targetingStaleMs } from './targeting-stale-ms.ts';

const providerId = 'core.targeting';

/** What the cache is built from. */
export interface TargetingCacheOptions {
  readonly flags: ControlFlags;
  readonly clock: Clock;
  readonly log: Logger;
  readonly signal: AbortSignal;
  /** Overrides the bounds of the read and of the wait before a new subscription; tests only. */
  readonly timing?: { readonly readMs?: number; readonly resubscribeMs?: number };
}

/** The in-memory targeting of `core.flag` rows (20.3, 20.4). */
export interface TargetingCache {
  /**
   * `core.targeting`, synchronous. With no rows loaded it passes the flag on. It reads the row of
   * (key, backend) and else the deployment-wide row (a deployment-scope context reads the latter
   * only); none passes the flag on. A row last loaded `targetingStaleMs` ago or longer answers
   * the declared default with STALE. A row that does not compile, or whose values the flag's
   * declaration refuses, answers the declared default with ERROR/PARSE_ERROR: an error of that
   * key only. `start(signal)` follows the feed until `signal` or the options' signal aborts and
   * settles after the first load.
   */
  readonly provider: FlagProvider;
  /**
   * Called before each snapshot; starts following the feed at its first call. Never loaded: awaits
   * the load (every caller). Loaded: awaits a reload when the rows are `targetingRefreshMs` old,
   * unless a load is in flight (then it does not wait) or the last attempt failed less than
   * `targetingRefreshMs` ago. Never waits longer than `targetingReadTimeoutMs`: a read that has not
   * answered by then counts as failed, so the snapshot goes on with the rows it has (none: the
   * chain passes the flag on) and a later call loads again. Never rejects: a failed load keeps the
   * rows and logs at error level.
   */
  fresh(): Promise<void>;
}

/**
 * Serves targeting from memory, refreshed when the control namespace's feed wakes and, with the
 * feed down or behind, by age: a flag turned off is served as on for at most `targetingRefreshMs`
 * plus one read of the control store. With the store unreadable the last rows serve for
 * `targetingStaleMs`, then every flag with targeting answers its default with STALE.
 */
export function createTargetingCache(options: TargetingCacheOptions): TargetingCache {
  const { flags, clock, log } = options;
  const readMs = options.timing?.readMs ?? targetingReadTimeoutMs;
  const resubscribeMs = options.timing?.resubscribeMs ?? targetingResubscribeMs;
  let rows: ReadonlyMap<string, CompiledFlagRow> | null = null;
  let invalid: ReadonlyMap<string, { readonly id: string; readonly version: number }> = new Map();
  let loadedAt = 0;
  /**
   * The outcome of `checkFlagValues` per declaration, slot and row version; replaced with `rows`.
   * Keyed on the declaration because one deployment-wide row is read against every app's own spec.
   */
  let fits: WeakMap<FlagSpec, Map<string, unknown>> = new WeakMap();
  let failedAt: number | null = null;
  let inFlight: Promise<void> | undefined;
  let again = false;
  /** Reads handed to the store that have not settled, also those the cache stopped waiting for. */
  let openReads = 0;
  let following = false;
  const reported = new Set<string>();

  const now = (): number => clock.now().epochMilliseconds;

  const reportOnce = (id: string, version: number, message: string, cause: unknown): void => {
    const mark = `${id}:${version}`;
    if (reported.has(mark)) return;
    reported.add(mark);
    log.error(message, { row: id, version, cause });
  };

  /** `work` or, after `ms`, a rejection; the loser is dropped and never an unhandled rejection. */
  const within = <T>(work: Promise<T>, ms: number): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
    });
    work.catch(() => undefined);
    return Promise.race([work, expired]).finally(() => clearTimeout(timer));
  };

  /** One read of the rows, counted until it settles, however late. */
  const read = (): Promise<Awaited<ReturnType<ControlFlags['rows']>>> => {
    openReads += 1;
    return (async () => flags.rows())().finally(() => {
      openReads -= 1;
    });
  };

  const attempt = async (): Promise<void> => {
    // Reads that timed out are still running in the adapter: no new one while two are open.
    if (openReads >= targetingMostOpenReads) return;
    const started = now();
    try {
      const stored = await within(read(), readMs);
      const compiled = new Map<string, CompiledFlagRow>();
      const refused = new Map<string, { readonly id: string; readonly version: number }>();
      for (const row of stored) {
        if (!flagKeyPattern.test(row.key)) {
          reportOnce(
            row.id,
            row.version,
            'a stored flag row has a key no flag can have; the row is ignored',
            row.key,
          );
          continue;
        }
        const slot = flagSlotOf(row.key, row.backendId);
        try {
          compiled.set(slot, compileFlagRow(row));
        } catch (error) {
          refused.set(slot, { id: row.id, version: row.version });
          reportOnce(
            row.id,
            row.version,
            'a stored flag targeting is invalid; its flag serves the declared default',
            error,
          );
        }
      }
      rows = compiled;
      fits = new WeakMap();
      invalid = refused;
      loadedAt = started;
      failedAt = null;
    } catch (error) {
      failedAt = now();
      log.error('the flag targeting could not be loaded; the last rows keep serving', {
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
    const run = (async (): Promise<void> => {
      do {
        again = false;
        await attempt();
      } while (again);
    })().finally(() => {
      inFlight = undefined;
    });
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
    let wait = resubscribeMs;
    for (let resubscribed = false; !signal.aborted; resubscribed = true) {
      if (resubscribed) void load(true);
      const subscribedAt = now();
      try {
        for await (const _wake of flags.changes(signal)) {
          wait = resubscribeMs;
          void load(true);
        }
        if (!signal.aborted) log.error('the flag change feed ended; it is subscribed again');
      } catch (error) {
        if (!signal.aborted) {
          log.error('the flag change feed failed; it is subscribed again', { cause: error });
        }
      }
      if (now() - subscribedAt >= targetingResubscribeMaxMs) wait = resubscribeMs;
      await pause(wait, signal);
      wait = Math.min(wait * 2, targetingResubscribeMaxMs);
    }
  };

  /** Awaits a load, but never longer than the read bound: the snapshot goes on without it. */
  const awaitLoad = async (load: Promise<void>): Promise<void> => {
    try {
      await within(load, readMs);
    } catch {
      // The load is still running or has failed and logged; the caller goes on.
    }
  };

  const startFollowing = (signal: AbortSignal): void => {
    if (following) return;
    following = true;
    void follow(signal);
  };

  const resolve = <T>(flag: FlagSpec<T>, context: FlagContext): FlagResolution<T> | undefined => {
    if (rows === null) return undefined;
    const backendId = context.scope.level === 'deployment' ? null : context.scope.backendId;
    const slots =
      backendId === null
        ? [flagSlotOf(flag.key, null)]
        : [flagSlotOf(flag.key, backendId), flagSlotOf(flag.key, null)];
    for (const slot of slots) {
      const refused = invalid.get(slot);
      if (refused !== undefined) {
        return defaultFlagResolution(flag, { errorCode: 'PARSE_ERROR', provider: providerId });
      }
      const row = rows.get(slot);
      if (row === undefined) continue;
      if (now() - loadedAt >= targetingStaleMs) {
        return {
          ...defaultFlagResolution(flag),
          reason: 'STALE',
          provider: providerId,
          ruleVersion: row.version,
        };
      }
      const mark = `${slot}:${row.version}`;
      let outcomes = fits.get(flag);
      if (outcomes === undefined) {
        outcomes = new Map();
        fits.set(flag, outcomes);
      }
      if (!outcomes.has(mark)) {
        try {
          checkFlagValues(flag, row);
          outcomes.set(mark, null);
        } catch (error) {
          outcomes.set(mark, error);
          reportOnce(
            row.id,
            row.version,
            'a stored flag targeting does not fit the flag declaration; the declared default was served',
            error,
          );
        }
      }
      if (outcomes.get(mark) !== null) {
        return {
          ...defaultFlagResolution(flag, { errorCode: 'PARSE_ERROR', provider: providerId }),
          ruleVersion: row.version,
        };
      }
      return evaluateTargeting(flag, row, context);
    }
    return undefined;
  };

  return {
    provider: {
      id: providerId,
      sync: true,
      start: async (signal) => {
        startFollowing(AbortSignal.any([signal, options.signal]));
        await awaitLoad(load(false));
      },
      resolve,
    },
    fresh: async () => {
      startFollowing(options.signal);
      if (rows === null) {
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
