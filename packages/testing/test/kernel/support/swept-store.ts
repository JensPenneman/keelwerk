import type { Clock, DataAdapterFactory, Registry, Unit } from '@keelwerk/core';
import { memoryAdapter } from '@keelwerk/data';

/**
 * Any adapter factory, with `swept` called when a unit that expired leases has committed: the last
 * unit of a pass of the lease keeper, so a case that moves the clock and fires the keeper's timer
 * knows the pass is over without waiting for a time. `unit`, when given, turns each unit into the
 * one the callback gets (a case holds an enqueue there) before the sweep is watched.
 */
export function sweptStore(
  base: DataAdapterFactory,
  input: { readonly swept: () => void; readonly unit?: (unit: Unit) => Unit },
): DataAdapterFactory {
  return {
    ...base,
    create: (placement, env) => {
      const adapter = base.create(placement, env);
      return {
        ...adapter,
        unit: async (namespace, scope, fn, options) => {
          let sweeping = false;
          const result = await adapter.unit(
            namespace,
            scope,
            (inner) => {
              const unit = input.unit?.(inner) ?? inner;
              return fn({
                ...unit,
                ...(unit.leases === undefined
                  ? {}
                  : {
                      leases: {
                        ...unit.leases,
                        expire: (kind, limit) => {
                          sweeping = true;
                          return unit.leases?.expire(kind, limit) ?? Promise.resolve([]);
                        },
                      },
                    }),
              });
            },
            options,
          );
          if (sweeping) input.swept();
          return result;
        },
      };
    },
  };
}

/** The in-memory adapter on the case's clock, whose sweeps are reported (`sweptStore`). */
export function sweptMemoryStore(input: {
  readonly registry: Pick<Registry, 'entities'>;
  readonly clock: Clock;
  readonly swept: () => void;
}): DataAdapterFactory {
  return sweptStore(
    memoryAdapter({
      clock: input.clock,
      entities: (ref) => input.registry.entities.get(ref)?.descriptor,
    }),
    { swept: input.swept },
  );
}
