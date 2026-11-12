import type { Carrier } from '@keelwerk/core';
import type { HostContext } from './host-context.ts';

/** Lets the deployment's carrier enrichers, in order, name a scope key before the scope is resolved. */
export function enrichCarrier(host: HostContext, carrier: Carrier): Carrier {
  for (const enricher of host.deps.enrichers ?? []) {
    const scopeKey = enricher.enrich(carrier);
    if (scopeKey !== null) {
      return { ...carrier, scopeKey };
    }
  }
  return carrier;
}
