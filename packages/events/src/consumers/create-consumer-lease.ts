import type { Clock, Logger, QueueSource, Unit } from '@keelwerk/core';
import { backgroundRetryMs } from '@keelwerk/core';
import type { ConsumerLease } from './consumer-lease.ts';

/**
 * The lease of a consumer in a namespace (15.2.3, D1) over namespace-scope units. It is renewed, or
 * acquired by a standby, every third of its length on the runtime clock, so a dead holder's lease
 * moves within its length plus a third. A failed call of the store counts as not holding: nothing
 * runs on a lease that could not be confirmed. The next call after a failed one comes after
 * `backgroundRetryMs` of the failures in a row, not after a third; a call that answers, with a
 * yes or a no, starts the count again.
 */
export function createConsumerLease(input: {
  readonly consumer: string;
  readonly source: QueueSource;
  readonly owner: string;
  readonly leaseMs: number;
  readonly clock: Clock;
  readonly log: Logger;
  /** Default `Math.random`; the draw of the jitter of `backgroundRetryMs`. */
  readonly random?: () => number;
}): ConsumerLease {
  const { consumer, source, owner, leaseMs, clock, log, random } = input;
  const third = Math.floor(leaseMs / 3);
  let held = false;
  /** The calls of the store that failed in a row. */
  let failures = 0;
  let due = clock.now();
  const scope = { level: 'namespace', reason: 'consumer lease' } as const;
  /** The answer of the store, or `undefined` when the call failed. */
  const call = async (fn: (unit: Unit) => Promise<boolean>): Promise<boolean | undefined> => {
    try {
      const answer = await source.handle.adapter.unit(source.namespace, scope, fn);
      failures = 0;
      return answer;
    } catch (error) {
      failures += 1;
      log.warn('a consumer lease could not be reached', {
        consumer,
        namespace: source.namespace.id,
        cause: error,
      });
      return undefined;
    }
  };
  const settle = (result: boolean | undefined): boolean => {
    held = result === true;
    const milliseconds = result === undefined ? backgroundRetryMs(failures, random) : third;
    due = clock.now().add({ milliseconds });
    return held;
  };
  return {
    acquire: async () =>
      settle(await call((unit) => unit.consumers.acquireLease(consumer, owner, leaseMs))),
    renew: async () =>
      settle(await call((unit) => unit.consumers.renewLease(consumer, owner, leaseMs))),
    release: async () => {
      held = false;
      await call((unit) => unit.consumers.renewLease(consumer, owner, 0));
    },
    holds: () => held,
    dueAt: () => due,
  };
}
