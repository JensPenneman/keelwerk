import type { Clock, Logger, QueueSource, Unit } from '@keelwerk/core';
import type { ConsumerLease } from './consumer-lease.ts';

/**
 * The lease of a consumer in a namespace (15.2.3, D1) over namespace-scope units. It is renewed, or
 * acquired by a standby, every third of its length on the runtime clock, so a dead holder's lease
 * moves within its length plus a third. A failed call of the store counts as not holding: nothing
 * runs on a lease that could not be confirmed.
 */
export function createConsumerLease(input: {
  readonly consumer: string;
  readonly source: QueueSource;
  readonly owner: string;
  readonly leaseMs: number;
  readonly clock: Clock;
  readonly log: Logger;
}): ConsumerLease {
  const { consumer, source, owner, leaseMs, clock, log } = input;
  const third = Math.floor(leaseMs / 3);
  let held = false;
  let due = clock.now();
  const scope = { level: 'namespace', reason: 'consumer lease' } as const;
  const call = async (fn: (unit: Unit) => Promise<boolean>): Promise<boolean> => {
    try {
      return await source.handle.adapter.unit(source.namespace, scope, fn);
    } catch (error) {
      log.warn('a consumer lease could not be reached', {
        consumer,
        namespace: source.namespace.id,
        cause: error,
      });
      return false;
    }
  };
  const settle = (result: boolean): boolean => {
    held = result;
    due = clock.now().add({ milliseconds: third });
    return result;
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
