import type { QuotaLimit, QuotaLimits } from '@keelwerk/core';
import { tenantId } from './invoker-kit.ts';

/** Quotas whose rates give the tenant `capacities` by ref (100 where none is named) and every other scope 100. */
export const tenantOnly = (capacities: Readonly<Record<string, number>>): QuotaLimits => ({
  limitOf: (_registry, scope, ref): QuotaLimit => {
    const own = scope.level === 'tenant' && scope.tenantId === tenantId;
    const capacity = own ? (capacities[ref] ?? 100) : 100;
    return { kind: 'rate', capacity, refillPerSecond: 0.001 };
  },
  queueOf: () => ({ running: 4, queued: 10_000, weight: 1 }),
  fresh: () => Promise.resolve(),
});
