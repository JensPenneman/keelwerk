import { errors } from '../errors/errors.ts';
import type { InvocationSession } from '../invoker/invocation-session.ts';
import type { Registry } from '../registry/registry.ts';
import type { ConcurrencyLeases } from './concurrency-leases.ts';
import type { QuotaLimits } from './quota-limits.ts';

/**
 * The slot of one open stream or socket under `core.liveConnections` (12.2, 15.4.10), for the HTTP
 * host: counted for the session's tenant, or its backend, across the deployment, none in the
 * deployment scope. Answers the release, which the caller gives back once when the connection ends;
 * past the limit: `rate_limited` `core.concurrency_limited`. The host's own bounds per process are
 * its own and are taken first.
 */
export function createConnectionSlot(input: {
  readonly leases: ConcurrencyLeases;
  readonly quotas: QuotaLimits;
  readonly registryOf: (appId: string) => Pick<Registry, 'quotas'>;
}): (session: InvocationSession) => Promise<() => void> {
  const { leases, quotas, registryOf } = input;
  return async (session) => {
    const { scope } = session;
    if (scope.level === 'deployment') return () => undefined;
    const dimension = 'core.liveConnections';
    const limit = (await quotas.fresh()).limitOf(registryOf(session.app), scope, dimension);
    if (limit.kind !== 'count') throw errors.internal(`The quota "${dimension}" is not a count.`);
    return leases.take({
      kind: 'connections',
      scopeId: scope.level === 'tenant' ? scope.tenantId : scope.backendId,
      dimension,
      limit: limit.value,
    });
  };
}
