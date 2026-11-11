import type { Clock, InvocationSession, KeelwerkError, Logger } from '@keelwerk/core';
import { vi } from 'vitest';
import type { LiveSubscription } from '../../src/hub/live-subscription.ts';

export const quietLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => quietLogger,
} as unknown as Logger;

export const startedAt = Temporal.Instant.from('2026-11-11T12:00:00Z');

/** A clock the test moves. */
export function movingClock(): { readonly clock: Clock; to(seconds: number): void } {
  let at = startedAt;
  return {
    clock: { now: () => at },
    to: (seconds) => {
      at = startedAt.add({ seconds });
    },
  };
}

/** A subscription whose session answers what the test says, and that records what happened to it. */
export function subscriptionOf(
  over: { expiresAt?: Temporal.Instant; reopen?: () => Promise<unknown> } = {},
) {
  const events: string[] = [];
  const fresh = {
    revalidate: async () => ({ ok: true, value: fresh }),
  } as unknown as InvocationSession;
  const session = {
    ...(over.expiresAt === undefined ? {} : { expiresAt: over.expiresAt }),
    revalidate: async () => {
      events.push('revalidate');
      return (
        over.reopen === undefined ? { ok: true, value: fresh } : await over.reopen()
      ) as never;
    },
  } as unknown as InvocationSession;
  const subscription: LiveSubscription = {
    session,
    renew: async () => {
      events.push('renew');
    },
    fail: (error: KeelwerkError) => {
      events.push(`fail:${error.kind}`);
    },
  };
  return { subscription, events };
}

/** Lets every promise that is ready run, without moving any timer. */
export const settleTimers = () => vi.advanceTimersByTimeAsync(0);
