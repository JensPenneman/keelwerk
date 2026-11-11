import type { Logger } from '@keelwerk/core';

/** How long handing the lease over may take after the stop deadline has passed. */
const releaseGraceMs = 1000;

/** What a runner's stop hands over with. */
export interface HandOverInput {
  readonly consumer: string;
  readonly namespace: string;
  /** Settles when the runner's work in flight has ended. */
  readonly idle: Promise<unknown>;
  /** Work the runner's deadlines abandoned and that has not settled yet: while any is left, the lease is not handed over. */
  readonly abandoned: ReadonlySet<unknown>;
  /** Hands the lease over after the work already queued. */
  readonly release: () => Promise<void>;
  readonly deadline: Temporal.Instant;
  readonly log: Logger;
}

/**
 * The end of a runner (15.2.3): waits for its work in flight until the deadline, then hands the lease
 * over. Work that has not ended by the deadline, a `consume` that never settles, keeps the lease: a
 * handover would let a second process run `consume` beside it, so the lease is left to expire. So does
 * work a batch deadline abandoned earlier: the runner's queue went on at that deadline, but the work
 * still runs and still makes its calls until it settles.
 */
export async function handOverLease(input: HandOverInput): Promise<void> {
  const { consumer, namespace, log } = input;
  let giveUp: ReturnType<typeof setTimeout> | undefined;
  const after = (ms: number): Promise<false> =>
    new Promise<false>((resolve) => {
      giveUp = setTimeout(() => resolve(false), ms);
    });
  const left = Math.max(0, input.deadline.epochMilliseconds - Date.now());
  const idle = await Promise.race([input.idle.then(() => true), after(left)]);
  clearTimeout(giveUp);
  if (!idle) {
    log.warn('a consumer was still working at the stop deadline; its lease is left to expire', {
      consumer,
      namespace,
    });
    return;
  }
  if (input.abandoned.size > 0) {
    log.warn('a consumer has work that outlived its deadline; its lease is left to expire', {
      consumer,
      namespace,
    });
    return;
  }
  // The handover itself gets a moment even when the deadline has passed.
  const released = await Promise.race([
    input.release().then(() => true),
    after(Math.max(left, releaseGraceMs)),
  ]);
  clearTimeout(giveUp);
  if (!released) {
    log.warn('a consumer lease was not handed over in time and is left to expire', {
      consumer,
      namespace,
    });
  }
}
