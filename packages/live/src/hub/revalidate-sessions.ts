import type { Clock, Logger } from '@keelwerk/core';
import { errors, KeelwerkError } from '@keelwerk/core';
import type { LiveSubscription } from './live-subscription.ts';
import { logCodeOf } from './log-code-of.ts';
import type { SessionRevalidator } from './session-revalidator.ts';

/**
 * Every `tickMs`, on the runtime's clock, revalidates each subscription whose session is due:
 * `expiresAt` has passed, or `intervalMs` have passed since its last check (the first check counts
 * from the moment the subscription was first seen). A revalidation reopens the session and decides
 * the subscription's own gate again (`session.revalidate()`, 16.3.4); the stream then ends with the
 * error it fails with (it fails closed: a reopen or a renewal that fails for any reason ends the
 * stream) or goes on with the fresh session. At most one revalidation per subscription runs at a
 * time; one asked for meanwhile runs once more after it (the run in flight may have read the session
 * before the change that asks), and any number asked for meanwhile share that one run. The timer runs
 * while subscriptions are attached; after `close` it is gone and a result that arrives later renews
 * nothing.
 */
export function revalidateSessions(input: {
  readonly clock: Clock;
  readonly log: Logger;
  readonly intervalMs: number;
  readonly tickMs: number;
  readonly subscriptions: () => readonly LiveSubscription[];
}): SessionRevalidator {
  const { clock, log } = input;
  /** When each subscription was last checked, or first seen, in milliseconds of the runtime's clock. */
  const checkedAt = new WeakMap<LiveSubscription, number>();
  const running = new Map<LiveSubscription, Promise<void>>();
  /** Subscriptions a run has ended with an error: a run queued behind it must not start again. */
  const failed = new WeakSet<LiveSubscription>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const nowMs = (): number => clock.now().epochMilliseconds;

  const ending = (error: unknown): KeelwerkError =>
    error instanceof KeelwerkError
      ? error
      : errors.unavailable('The live stream is not available now.');

  const run = async (subscription: LiveSubscription): Promise<void> => {
    try {
      const outcome = await subscription.session.revalidate();
      // The hub closed while the session was reopened: nothing is renewed and nothing is failed.
      if (closed) return;
      if (!outcome.ok) {
        failed.add(subscription);
        subscription.fail(outcome.error);
        return;
      }
      await subscription.renew(outcome.value);
    } catch (error) {
      if (closed) return;
      log.warn('a live session could not be revalidated', { code: logCodeOf(error) });
      failed.add(subscription);
      subscription.fail(ending(error));
    }
  };

  /** The one run queued behind the run in flight, for each subscription. */
  const queued = new Map<LiveSubscription, Promise<void>>();

  const start = (subscription: LiveSubscription): Promise<void> => {
    checkedAt.set(subscription, nowMs());
    const started = run(subscription).finally(() => {
      if (running.get(subscription) === started) running.delete(subscription);
      checkedAt.set(subscription, nowMs());
    });
    running.set(subscription, started);
    return started;
  };

  const revalidate = (subscription: LiveSubscription): Promise<void> => {
    if (closed) return Promise.resolve();
    const held = running.get(subscription);
    if (held === undefined) return start(subscription);
    // A run in flight may have read the session before the change that asks for this one: the
    // request waits for it and then gets a run of its own, so it always starts after its cause.
    const waiting = queued.get(subscription);
    if (waiting !== undefined) return waiting;
    const next = held.then(() => {
      queued.delete(subscription);
      return closed || failed.has(subscription) ? undefined : start(subscription);
    });
    queued.set(subscription, next);
    return next;
  };

  const due = (subscription: LiveSubscription, now: number): boolean => {
    const last = checkedAt.get(subscription);
    if (last === undefined) {
      checkedAt.set(subscription, now);
      return false;
    }
    const { expiresAt } = subscription.session;
    return (
      (expiresAt !== undefined && expiresAt.epochMilliseconds <= now) ||
      now - last >= input.intervalMs
    );
  };

  const tick = (): void => {
    if (closed) return;
    const now = nowMs();
    for (const subscription of input.subscriptions()) {
      if (!running.has(subscription) && due(subscription, now)) void revalidate(subscription);
    }
  };

  return {
    revalidate,
    attached: (count) => {
      if (closed) return;
      if (count > 0 && timer === undefined) {
        timer = setInterval(tick, input.tickMs);
        timer.unref();
      } else if (count === 0 && timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
    close: () => {
      closed = true;
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      running.clear();
      queued.clear();
    },
  };
}
