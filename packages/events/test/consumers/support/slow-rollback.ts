import type { QueueSource } from '@keelwerk/core';
import type { ConsumerKit } from './consumer-kit.ts';

/**
 * The kit's source whose units answer a failure `ms` later than they do, as when the rollback
 * round trip is slow: work of the unit that is still running resumes before the caller sees the
 * rejection.
 */
export function slowRollback(kit: ConsumerKit, ms: number): QueueSource {
  const sealed = kit.runtime.sealed;
  const adapter: typeof sealed = new Proxy(sealed, {
    get: (target, property) => {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      if (property !== 'unit') return value.bind(target);
      return async (...args: unknown[]) => {
        try {
          return await Reflect.apply(value, target, args);
        } catch (error) {
          await new Promise((resolve) => setTimeout(resolve, ms));
          throw error;
        }
      };
    },
  });
  return { ...kit.source, handle: { adapter } };
}
