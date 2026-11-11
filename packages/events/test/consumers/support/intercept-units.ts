import type { NamespaceRef, QueueSource, StorageScope, Unit } from '@keelwerk/core';
import type { ConsumerKit } from './consumer-kit.ts';

/**
 * The kit's source with every unit the runner opens passing `before` first: the hook may append,
 * move the clock or throw, which rejects that unit before it starts. The hook sees the scope of the
 * unit (a namespace-scope unit's `reason` names what the runner is doing). `wrap` may hand the
 * runner's callback another view of the unit, for a test whose reads or writes must misbehave.
 */
export function interceptUnits(
  kit: ConsumerKit,
  before: (scope: StorageScope) => void | Promise<void>,
  wrap: (unit: Unit) => Unit = (unit) => unit,
): QueueSource {
  const sealed = kit.runtime.sealed;
  const adapter: typeof sealed = new Proxy(sealed, {
    get: (target, property) => {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      if (property !== 'unit') return value.bind(target);
      return async (
        namespace: NamespaceRef,
        scope: StorageScope,
        fn: (unit: Unit) => Promise<unknown>,
        ...rest: unknown[]
      ) => {
        await before(scope);
        return Reflect.apply(value, target, [
          namespace,
          scope,
          (unit: Unit) => fn(wrap(unit)),
          ...rest,
        ]);
      };
    },
  });
  return { ...kit.source, handle: { adapter } };
}
