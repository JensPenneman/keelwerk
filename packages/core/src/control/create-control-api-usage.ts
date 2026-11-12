import { createUsageBuffer } from '../api-versions/usage-buffer.ts';
import { utcDayOf } from '../api-versions/utc-day-of.ts';
import { errors } from '../errors/errors.ts';
import type { Clock } from '../kernel/clock.ts';
import type { ApiUsageStore } from '../storage/api-usage-store.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { Unit } from '../storage/unit.ts';
import type { ControlApiUsage } from './control-api-usage.ts';

const chunkSize = 1000;

function storeOf(unit: Unit): ApiUsageStore {
  if (unit.apiUsage === undefined)
    throw errors.internal('The control store has no API usage table.');
  return unit.apiUsage;
}

/** The usage accessors of one process over the control adapter. */
export function createControlApiUsage(input: {
  readonly adapter: DataAdapter;
  readonly namespace: NamespaceRef;
  readonly clock: Clock;
  readonly deploymentId: string;
}): ControlApiUsage {
  const { adapter, namespace, clock, deploymentId } = input;
  const buffer = createUsageBuffer();
  const deployment = { level: 'deployment' } as const;
  return {
    record: ({ scope, apiVersion, transport, item }) => {
      const ids =
        scope.level === 'tenant'
          ? { backendId: scope.backendId, tenantId: scope.tenantId }
          : scope.level === 'backend'
            ? { backendId: scope.backendId, tenantId: scope.backendId }
            : { backendId: deploymentId, tenantId: deploymentId };
      buffer.add({ day: utcDayOf(clock.now()), ...ids, apiVersion, transport, item });
    },
    flush: async () => {
      const counts = buffer.drain();
      if (counts.length === 0) return 0;
      try {
        await adapter.unit(namespace, deployment, async (unit) => {
          const store = storeOf(unit);
          for (let start = 0; start < counts.length; start += chunkSize) {
            await store.add(counts.slice(start, start + chunkSize));
          }
        });
      } catch (error) {
        buffer.restore(counts);
        throw error;
      }
      return counts.length;
    },
    read: (query) =>
      adapter.unit(namespace, deployment, async (unit) => storeOf(unit).totals(query), {
        readOnly: true,
      }),
  };
}
