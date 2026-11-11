import type { ControlFlags, FlagTargetingRow } from '../src/control/control-flags.ts';
import type { FlagContext } from '../src/flags/flag-context.ts';
import type { FlagSpec } from '../src/flags/flag-spec.ts';
import type { FlagTargeting } from '../src/flags/flag-targeting.ts';
import { createTargetingCache } from '../src/flags/targeting-cache.ts';
import type { Logger } from '../src/observability/logger.ts';

export const checkoutFlag: FlagSpec<boolean> = {
  key: 'shop.checkout',
  kind: 'boolean',
  level: 'tenant',
  default: false,
  purpose: 'release',
};
export const targetingOn: FlagTargeting = {
  enabled: true,
  rules: [],
  fallthrough: { value: true },
};
export const targetingOff: FlagTargeting = {
  enabled: false,
  rules: [],
  fallthrough: { value: true },
};

export function tenantContext(backendId = 'b1'): FlagContext {
  return {
    scope: { level: 'tenant', backendId, tenantId: 't1' },
    principal: { kind: 'user', id: 'u1', roles: [] },
    attributes: {},
    targetingKey: 't1',
  };
}

export function storedFlagRow(
  targeting: unknown,
  extra: Partial<FlagTargetingRow> = {},
): FlagTargetingRow {
  return { id: 'flg-1', key: 'shop.checkout', backendId: null, version: 1, targeting, ...extra };
}

export function targetingRig(
  initial: readonly FlagTargetingRow[],
  timing: { readonly readMs?: number; readonly resubscribeMs?: number } = {},
) {
  let now = Date.parse('2026-11-11T08:00:00Z');
  let stored = initial;
  let failing = false;
  let loads = 0;
  let wake: (() => void) | undefined;
  let release: (() => void) | undefined;
  let hold = false;
  let subscriptions = 0;
  let feedFailures = 0;
  const errors: string[] = [];
  const log: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (message) => {
      errors.push(message);
    },
    child: () => log,
  };
  const flags: ControlFlags = {
    rows: async () => {
      loads++;
      if (hold) await new Promise<void>((resolve) => (release = resolve));
      if (failing) throw new Error('control store down');
      return stored;
    },
    row: async (id) => stored.find((candidate) => candidate.id === id),
    changes: (signal) => ({
      [Symbol.asyncIterator]: async function* () {
        subscriptions++;
        if (feedFailures > 0) {
          feedFailures--;
          throw new Error('feed reconnect failed');
        }
        while (!signal.aborted) {
          await new Promise<void>((resolve) => (wake = resolve));
          yield 'wake';
        }
      },
    }),
  };
  const controller = new AbortController();
  const cache = createTargetingCache({
    flags,
    clock: { now: () => Temporal.Instant.fromEpochMilliseconds(now) },
    log,
    signal: controller.signal,
    timing,
  });
  return {
    cache,
    errors,
    loads: () => loads,
    subscriptions: () => subscriptions,
    failFeed: (times: number) => {
      feedFailures = times;
    },
    advance: (ms: number) => {
      now += ms;
    },
    set: (rows: readonly FlagTargetingRow[]) => {
      stored = rows;
    },
    fail: (value: boolean) => {
      failing = value;
    },
    wake: () => wake?.(),
    hold: (value: boolean) => {
      hold = value;
    },
    release: () => release?.(),
    stop: () => controller.abort(),
  };
}

export const readCheckout = (cache: ReturnType<typeof targetingRig>['cache'], backendId?: string) =>
  cache.provider.resolve(checkoutFlag, tenantContext(backendId));
